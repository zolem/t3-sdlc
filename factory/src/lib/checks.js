// @ts-check
// The deterministic gate. The factory runs exactly the commands a repo lists in
// .orchestrate/factory.json `checks`, on a committed HEAD, and records the result
// against that commit. Each command gets the run context in ORCH_* env vars and
// can call the built-in checks below as `orchestrate check <name>`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { FACTORY_BIN } from './paths.js';
import { addedLines, changedFiles, dirtyPaths, git, sh, sha } from './git.js';

const TAIL = 3000;

const SECRET_PATTERNS = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'OpenAI/Anthropic-style key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'generic credential assignment', re: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

const HYGIENE_PATTERNS = [
  { name: 'merge conflict marker', re: /^(?:<{7}|>{7}|={7})(?:\s|$)/ },
  { name: 'focused test (.only)', re: /\b(?:it|test|describe)\.only\s*\(|\bf(?:it|describe)\s*\(/ },
  { name: 'debugger statement', re: /^\s*debugger\s*;?\s*$/ },
];

export const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'go.sum', 'composer.lock'];
const MANIFESTS = { 'package.json': ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] };
export const TEST_FILE = /(^|\/)(test|tests|__tests__|spec|e2e)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|py)$|^test_.*\.py$/;

/** @param {string} text */
const tail = text => (text.length > TAIL ? `…${text.slice(-TAIL)}` : text);

/** @param {string} cwd @param {string} ref @param {string} file */
function showFile(cwd, ref, file) {
  return git(cwd, ['show', `${ref}:${file}`], { allowFail: true });
}

/** Lines added in base...head with their text. @param {string} cwd @param {string} base @param {string} head */
function addedText(cwd, base, head) {
  const out = git(cwd, ['diff', '-U0', '--no-color', `${base}...${head}`]);
  /** @type {{ file: string, line: number, text: string }[]} */
  const rows = [];
  let file = null;
  let ln = 0;
  for (const raw of out.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : null;
      continue;
    }
    const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      ln = Number(m[1]);
      continue;
    }
    if (file && raw.startsWith('+') && !raw.startsWith('+++')) {
      rows.push({ file, line: ln, text: raw.slice(1) });
      ln++;
    }
  }
  return rows;
}

/** Glob → RegExp for `*`, `**`, `?`. @param {string} glob */
export function globRe(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${re}$`);
}

/** @param {string} text @param {string} root */
function parseLcov(text, root) {
  /** @type {Record<string, { exec: Set<number>, hit: Set<number> }>} */
  const files = {};
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const p = line.slice(3).trim();
      const rel = path.isAbsolute(p) ? path.relative(root, p) : p;
      cur = files[rel] ??= { exec: new Set(), hit: new Set() };
    } else if (line.startsWith('DA:') && cur) {
      const [n, count] = line.slice(3).split(',').map(Number);
      cur.exec.add(n);
      if (count > 0) cur.hit.add(n);
    } else if (line === 'end_of_record') cur = null;
  }
  return files;
}

/**
 * @typedef {{ cwd: string, base: string, head: string, args: string[], testCases: string[] }} BuiltinCtx
 * @typedef {{ ok: boolean, summary: string, warn?: string }} BuiltinResult
 * @type {Record<string, { usage: string, description: string, run: (ctx: BuiltinCtx) => BuiltinResult }>}
 */
export const BUILTINS = {
  secrets: {
    usage: 'orchestrate check secrets',
    description: 'Fails when added lines look like credentials (cloud keys, tokens, private keys, hard-coded passwords).',
    run: ({ cwd, base, head }) => {
      const hits = [];
      for (const row of addedText(cwd, base, head)) for (const p of SECRET_PATTERNS) if (p.re.test(row.text)) hits.push(`${row.file}:${row.line} ${p.name}`);
      return { ok: hits.length === 0, summary: hits.length ? `Possible secrets in added lines:\n${hits.slice(0, 20).join('\n')}` : 'no secret patterns in added lines' };
    },
  },
  hygiene: {
    usage: 'orchestrate check hygiene',
    description: 'Fails on merge-conflict markers, focused tests (.only / fit / fdescribe) and debugger statements in added lines.',
    run: ({ cwd, base, head }) => {
      const hits = [];
      for (const row of addedText(cwd, base, head)) for (const p of HYGIENE_PATTERNS) if (p.re.test(row.text)) hits.push(`${row.file}:${row.line} ${p.name}`);
      return { ok: hits.length === 0, summary: hits.length ? hits.slice(0, 20).join('\n') : 'no conflict markers, focused tests, or debugger statements' };
    },
  },
  lockfile: {
    usage: 'orchestrate check lockfile',
    description: 'Fails when package.json dependency sections change without a lockfile change in the same package.',
    run: ({ cwd, base, head }) => {
      const files = changedFiles(cwd, base, head);
      const problems = [];
      for (const m of files.filter(f => path.basename(f.path) in MANIFESTS)) {
        const keys = MANIFESTS[/** @type {'package.json'} */ (path.basename(m.path))];
        const pick = (/** @type {string | null} */ t) => JSON.stringify(keys.map(k => JSON.parse(t || '{}')[k]));
        if (pick(showFile(cwd, base, m.path)) === pick(showFile(cwd, head, m.path))) continue;
        const dir = path.dirname(m.path);
        if (!files.some(f => LOCKFILES.includes(path.basename(f.path)) && [dir, '.'].includes(path.dirname(f.path)))) problems.push(`${m.path} changed dependencies but no lockfile changed`);
      }
      return { ok: problems.length === 0, summary: problems.length ? problems.join('\n') : 'dependency changes (if any) come with lockfile updates' };
    },
  },
  migrations: {
    usage: "orchestrate check migrations '<glob of migration files>' [--require-down]",
    description: 'Fails when an existing migration is edited or deleted, and (with --require-down) when a new `.up.` migration has no matching `.down.` file.',
    run: ({ cwd, base, head, args }) => {
      const glob = args.find(a => !a.startsWith('--'));
      if (!glob) return { ok: false, summary: 'usage: orchestrate check migrations <glob> [--require-down]' };
      const re = globRe(glob);
      const problems = [];
      for (const f of changedFiles(cwd, base, head)) {
        if (!re.test(f.path)) continue;
        if (f.status !== 'A') problems.push(`${f.path} is an existing migration that was ${f.status === 'D' ? 'deleted' : 'modified'}; add a new migration instead`);
        else if (args.includes('--require-down')) {
          const down = f.path.replace(/\.up\./, '.down.');
          if (down === f.path || showFile(cwd, head, down) === null) problems.push(`${f.path} has no matching down migration (${down})`);
        }
      }
      return { ok: problems.length === 0, summary: problems.length ? problems.join('\n') : 'migrations are additive and reversible' };
    },
  },
  traceability: {
    usage: 'orchestrate check traceability',
    description: 'Fails when a test-case id assigned to this slice (ORCH_TEST_CASES) is not mentioned by any changed test file.',
    run: ({ cwd, base, head, testCases }) => {
      if (!testCases.length) return { ok: true, summary: 'no automated test cases assigned (ORCH_TEST_CASES empty)' };
      const text = changedFiles(cwd, base, head).filter(f => f.status !== 'D' && TEST_FILE.test(f.path)).map(f => showFile(cwd, head, f.path) || '').join('\n');
      const missing = testCases.filter(tc => !text.includes(tc));
      return { ok: missing.length === 0, summary: missing.length ? `Assigned test cases with no changed test mentioning them: ${missing.join(', ')}` : `all ${testCases.length} assigned test case(s) referenced by changed tests` };
    },
  },
  'changed-lines': {
    usage: 'orchestrate check changed-lines <lcov path> [min %, default 80]',
    description: 'Coverage of executable added lines from an lcov report your coverage command produced. Added source files the report does not cover are listed as a warning.',
    run: ({ cwd, base, head, args }) => {
      const [lcovRel = 'coverage/lcov.info', minArg = '80'] = args;
      const lcovPath = path.resolve(cwd, lcovRel);
      if (!fs.existsSync(lcovPath)) return { ok: false, summary: `${lcovRel} not found; run your coverage command first (e.g. "npm run coverage && orchestrate check changed-lines ${lcovRel}")` };
      const lcov = parseLcov(fs.readFileSync(lcovPath, 'utf8'), cwd);
      let exec = 0;
      let hit = 0;
      const uncovered = [];
      const unmeasured = [];
      for (const [file, lines] of Object.entries(addedLines(cwd, base, head))) {
        if (TEST_FILE.test(file) || /\.(md|json|ya?ml|lock|css|html|svg|png|sql|txt)$/i.test(file)) continue;
        if (!lcov[file]) {
          unmeasured.push(file);
          continue;
        }
        for (const n of lines) {
          if (!lcov[file].exec.has(n)) continue;
          exec++;
          if (lcov[file].hit.has(n)) hit++;
          else uncovered.push(`${file}:${n}`);
        }
      }
      const min = Number(minArg);
      const pct = exec === 0 ? 100 : Math.round((hit / exec) * 1000) / 10;
      const warn = unmeasured.length ? `not in the coverage report (unmeasured): ${unmeasured.join(', ')}` : undefined;
      return {
        ok: pct >= min,
        summary: `changed-line coverage ${exec === 0 ? 'n/a' : `${pct}%`} (${hit}/${exec} executable added lines; minimum ${min}%)${uncovered.length ? `\nuncovered: ${uncovered.slice(0, 25).join(', ')}` : ''}${warn ? `\nwarning: ${warn}` : ''}`,
        warn,
      };
    },
  },
};

/**
 * Make sure dependencies match the lockfile in this checkout. Each worktree keeps
 * its own marker, so switching branches with different lockfiles re-installs.
 * @param {string} cwd @param {any} contract
 */
export async function ensureSetup(cwd, contract) {
  if (!contract?.setup) return null;
  const hash = crypto.createHash('sha256');
  for (const f of LOCKFILES) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) hash.update(f).update(fs.readFileSync(p));
  }
  const digest = hash.digest('hex');
  const marker = path.join(git(cwd, ['rev-parse', '--absolute-git-dir']), 'orchestrate-setup');
  const prev = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
  if (prev === digest) return { id: 'setup', ok: true, ms: 0, summary: 'dependencies already match the lockfile' };
  const res = await sh(contract.setup, { cwd, env: { PATH: `${FACTORY_BIN}:${process.env.PATH}` } });
  if (res.code === 0) fs.writeFileSync(marker, digest);
  return { id: 'setup', ok: res.code === 0, ms: res.ms, summary: res.code === 0 ? `ran \`${contract.setup}\`` : `\`${contract.setup}\` exited ${res.code}`, output: res.code === 0 ? undefined : tail(res.output) };
}

/**
 * Environment every check command receives.
 * @param {{ cwd: string, base: string, head: string, runId?: string, slice?: string | number, testCases?: string[] }} p
 */
export function checkEnv({ cwd, base, head, runId, slice, testCases = [] }) {
  const listFile = path.join(os.tmpdir(), `orch-changed-${process.pid}-${head.slice(0, 12)}.txt`);
  fs.writeFileSync(listFile, changedFiles(cwd, base, head).filter(f => f.status !== 'D').map(f => f.path).join('\n') + '\n');
  return {
    PATH: `${FACTORY_BIN}:${process.env.PATH}`,
    ORCH_BASE_SHA: base,
    ORCH_HEAD_SHA: head,
    ORCH_RUN_ID: runId || '',
    ORCH_SLICE: slice === undefined ? '' : String(slice),
    ORCH_TEST_CASES: testCases.join(','),
    ORCH_CHANGED_FILES: listFile,
  };
}

/**
 * Run the repo's check commands on committed HEAD.
 * @param {{ cwd: string, base: string, contract: any, testCases?: string[], only?: string[], runId?: string, slice?: string | number }} opts
 */
export async function runChecks({ cwd, base, contract, testCases = [], only, runId, slice }) {
  const head = sha(cwd);
  const dirty = dirtyPaths(cwd);
  if (dirty.length) {
    return { ok: false, sha: head, base, checks: [{ id: 'clean-tree', ok: false, ms: 0, summary: `Uncommitted changes: ${dirty.slice(0, 10).join(', ')}. Checks only run on committed HEAD; commit (or remove) them and run again.` }] };
  }
  /** @type {any[]} */
  const results = [];
  const setup = await ensureSetup(cwd, contract);
  if (setup) results.push(setup);
  if (setup && !setup.ok) return { ok: false, sha: head, base, checks: results };

  const env = checkEnv({ cwd, base, head, runId, slice, testCases });
  for (const c of contract?.checks || []) {
    if (only && !only.includes(c.id)) continue;
    const res = await sh(c.run, { cwd, env, timeoutMs: (c.timeoutSec || 1200) * 1000 });
    const ok = res.code === 0 && !res.timedOut;
    const warn = (res.output.match(/^warning: .+$/gm) || []).join('\n') || undefined;
    results.push({
      id: c.id, ok, ms: res.ms, warn,
      summary: ok ? `\`${c.run}\` passed` : res.timedOut ? `\`${c.run}\` timed out` : `\`${c.run}\` exited ${res.code}`,
      output: ok ? (c.run.includes('orchestrate check') ? tail(res.output.trim()) : undefined) : tail(res.output),
    });
  }
  try {
    fs.rmSync(env.ORCH_CHANGED_FILES, { force: true });
  } catch {}
  return { ok: results.every(r => r.ok), sha: head, base, checks: results };
}
