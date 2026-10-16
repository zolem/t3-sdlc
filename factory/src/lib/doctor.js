// @ts-check
// Preflight for a repo or workspace: can every stage of the flow run here?
// Each capability maps to a stage, has a level (required / recommended /
// optional) and, when not ok, a concrete fix. `verify` actually runs setup,
// the checks and app.up/down on the current HEAD.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTRACT_FILE, WORKSPACE_FILE, readContract, readWorkspace, repoEnvVar } from './repoContract.js';
import { resolveCommand } from './commands.js';
import { runChecks } from './checks.js';
import { dirtyPaths, git, repoRoot, commonRoot } from './git.js';
import * as app from './app.js';

/**
 * @typedef {'ok' | 'missing' | 'invalid' | 'unverified' | 'failed'} Status
 * @typedef {{ id: string, repo: string, stage: string, level: 'required' | 'recommended' | 'optional', status: Status, detail: string, fix?: string, skippable?: boolean }} Capability
 */

const STAGES = {
  contract: 'everything (how the factory runs this repo)',
  git: 'everything (worktrees, branches, PR stack)',
  checks: 'build: the deterministic gate every slice must pass before review',
  setup: 'fresh worktrees: installing dependencies before checks and app runs',
  'browser-validation': 'manual testing of user-facing slices and the whole feature in a real browser',
  publish: 'publishing the approved stack as draft PRs',
  'clean-tree': 'starting a run (it branches from your current commit)',
  'verify-checks': 'verify: every check actually run on your current commit',
  'verify-app': 'verify: app.up actually started and answered',
  workspace: 'multi-repo runs',
};

/** @param {string} root */
function detectSetup(root) {
  const has = (/** @type {string} */ f) => fs.existsSync(path.join(root, f));
  if (has('pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile';
  if (has('yarn.lock')) return 'yarn install --frozen-lockfile';
  if (has('bun.lockb') || has('bun.lock')) return 'bun install --frozen-lockfile';
  if (has('package-lock.json')) return 'npm ci';
  if (has('uv.lock')) return 'uv sync --frozen';
  if (has('poetry.lock')) return 'poetry install --no-interaction';
  if (has('Gemfile.lock')) return 'bundle install';
  if (has('go.mod')) return 'go mod download';
  if (has('Cargo.lock') || has('Cargo.toml')) return 'cargo fetch';
  if (has('package.json')) return 'npm install';
  if (has('pyproject.toml')) return 'pip install -e .';
  if (has('requirements.txt')) return 'pip install -r requirements.txt';
  if (has('Gemfile')) return 'bundle install';
  return null;
}

/** @param {string} root */
function pm(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/**
 * Propose a contract from what the repo already has. Never writes.
 * @param {string} root
 */
export function suggestContract(root) {
  const has = (/** @type {string} */ f) => fs.existsSync(path.join(root, f));
  const notes = [];
  /** @type {any} */
  const c = { $schema: 'https://github.com/zolem/t3-sdlc/blob/main/docs/factory.schema.json', version: 2 };
  const setup = detectSetup(root);
  if (setup) c.setup = setup;
  /** @type {{ id: string, run: string }[]} */
  const checks = [];
  let scripts = {};
  if (has('package.json')) {
    try {
      scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {};
    } catch {}
    const run = (/** @type {string} */ s) => `${pm(root)} run ${s}`;
    for (const [id, names] of /** @type {[string, string[]][]} */ ([['lint', ['lint']], ['typecheck', ['typecheck', 'type-check', 'tsc', 'check-types']], ['test', ['test', 'test:unit']]])) {
      const name = names.find(n => scripts[n]);
      if (name) checks.push({ id, run: id === 'test' && name === 'test' ? `${pm(root)} test` : run(name) });
    }
    const cov = ['coverage', 'test:coverage', 'test:cov'].find(n => scripts[n]);
    if (cov) checks.push({ id: 'coverage', run: `${run(cov)} && orchestrate check changed-lines coverage/lcov.info 80` });
    else notes.push('No coverage script found; add one that writes coverage/lcov.info to enable changed-line coverage.');
    const dev = ['dev', 'start', 'serve'].find(n => scripts[n]);
    if (dev) {
      c.app = { up: run(dev), env: { PORT: '{port}' }, url: 'http://localhost:{port}', ready: '/' };
      notes.push(`app.up guessed from the "${dev}" script. Confirm it honours PORT (or set "urlPattern"), and point "ready" at a cheap health URL.`);
    }
  }
  if (has('pyproject.toml') || has('setup.cfg') || has('pytest.ini')) {
    const text = has('pyproject.toml') ? fs.readFileSync(path.join(root, 'pyproject.toml'), 'utf8') : '';
    const runner = has('uv.lock') ? 'uv run ' : has('poetry.lock') ? 'poetry run ' : '';
    if (/ruff/.test(text)) checks.push({ id: 'lint', run: `${runner}ruff check .` });
    if (/mypy/.test(text)) checks.push({ id: 'typecheck', run: `${runner}mypy .` });
    checks.push({ id: 'test', run: `${runner}pytest -q` });
  }
  if (has('go.mod')) checks.push({ id: 'vet', run: 'go vet ./...' }, { id: 'test', run: 'go test ./...' });
  if (has('Cargo.toml')) checks.push({ id: 'clippy', run: 'cargo clippy --all-targets -- -D warnings' }, { id: 'test', run: 'cargo test' });
  if (has('Makefile') && !checks.length) {
    const mk = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
    for (const t of ['lint', 'test']) if (new RegExp(`^${t}\\s*:`, 'm').test(mk)) checks.push({ id: t, run: `make ${t}` });
  }
  const migrationDir = ['migrations', 'db/migrations', 'prisma/migrations', 'src/migrations', 'alembic/versions'].find(d => has(d));
  checks.push({ id: 'secrets', run: 'orchestrate check secrets' }, { id: 'hygiene', run: 'orchestrate check hygiene' });
  if (has('package.json')) checks.push({ id: 'lockfile', run: 'orchestrate check lockfile' });
  if (migrationDir) {
    checks.push({ id: 'migrations', run: `orchestrate check migrations '${migrationDir}/**'` });
    notes.push(`Found ${migrationDir}/; the migrations check blocks edits to existing migrations. Add --require-down if you use .up/.down file pairs.`);
  }
  checks.push({ id: 'traceability', run: 'orchestrate check traceability' });
  c.checks = checks;
  if (!checks.some(x => !x.run.startsWith('orchestrate'))) notes.push('No lint/test commands were detected. Add your real test command; the gate is only as good as the checks it runs.');
  return { contract: c, notes };
}

/** @param {string} root */
function githubOrigin(root) {
  const url = git(root, ['remote', 'get-url', 'origin'], { allowFail: true });
  return url && /github\.com[:/]/.test(url) ? url : null;
}

function ghAuthed() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ name: string, root: string, primary: boolean }} repo
 * @param {{ verify?: boolean, forStart?: boolean, workspaceApp?: any }} opts
 * @returns {Promise<Capability[]>}
 */
async function doctorRepo(repo, { verify, forStart, workspaceApp }) {
  /** @type {Capability[]} */
  const caps = [];
  const add = (/** @type {Omit<Capability, 'repo' | 'stage'>} */ c) => caps.push({ repo: repo.name, stage: STAGES[/** @type {keyof typeof STAGES} */ (c.id)] || c.id, ...c });

  if (!fs.existsSync(repo.root)) {
    add({ id: 'git', level: 'required', status: 'missing', detail: `${repo.root} does not exist`, fix: `Clone the repo there or fix its path in ${WORKSPACE_FILE}.` });
    return caps;
  }
  const top = git(repo.root, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (!top) {
    add({ id: 'git', level: 'required', status: 'missing', detail: `${repo.root} is not a git repository`, fix: 'Run `git init` and make a first commit.' });
    return caps;
  }
  if (!git(repo.root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true })) {
    add({ id: 'git', level: 'required', status: 'missing', detail: 'the repository has no commits', fix: 'Make a first commit.' });
    return caps;
  }
  add({ id: 'git', level: 'required', status: 'ok', detail: `git repo on ${git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }) || 'detached HEAD'}` });

  if (forStart) {
    const dirty = dirtyPaths(repo.root, ['.orchestrate/']);
    add(dirty.length
      ? { id: 'clean-tree', level: 'required', status: 'invalid', detail: `uncommitted changes: ${dirty.slice(0, 6).join(', ')}${dirty.length > 6 ? ', …' : ''}`, fix: 'Commit or stash them (or start with allowDirty if you are sure).' }
      : { id: 'clean-tree', level: 'required', status: 'ok', detail: 'working tree clean' });
  }

  const { contract, errors, warnings } = readContract(repo.root);
  const suggestion = () => JSON.stringify(suggestContract(repo.root).contract, null, 2);
  if (!contract && !errors.length) {
    add({ id: 'contract', level: 'required', status: 'missing', detail: `no ${CONTRACT_FILE}`, fix: `Create ${CONTRACT_FILE}. Run the setup skill, or start from this suggestion:\n${suggestion()}` });
    return caps;
  }
  if (errors.length) {
    add({ id: 'contract', level: 'required', status: 'invalid', detail: errors.join('; '), fix: `Fix ${CONTRACT_FILE} (see docs/repo-setup.md).` });
    return caps;
  }
  add({ id: 'contract', level: 'required', status: 'ok', detail: warnings.length ? `valid, with warnings: ${warnings.join('; ')}` : `valid ${CONTRACT_FILE}` });

  const cmd = (/** @type {string} */ id, /** @type {string} */ line) => {
    const r = resolveCommand(line, repo.root);
    return { r, text: `${id}: \`${line}\` → ${r.how}` };
  };

  // checks (the gate)
  const checks = contract.checks || [];
  if (!checks.length) {
    add({ id: 'checks', level: 'required', status: 'missing', detail: 'no checks listed, so nothing would stop broken code', fix: `Add at least your test command to "checks", e.g. { "id": "test", "run": "npm test" }.` });
  } else {
    const resolved = checks.map((/** @type {any} */ c) => cmd(c.id, c.run));
    const bad = resolved.filter((/** @type {any} */ x) => x.r.ok === false);
    const realChecks = checks.filter((/** @type {any} */ c) => !/^orchestrate check /.test(c.run));
    if (bad.length) add({ id: 'checks', level: 'required', status: 'invalid', detail: bad.map((/** @type {any} */ x) => x.text).join('\n'), fix: 'Make each listed command exist (add the script/target or fix the command) or remove it.' });
    else if (!realChecks.length) add({ id: 'checks', level: 'required', status: 'invalid', detail: 'only built-in checks are listed; nothing runs your tests', fix: 'Add your test (and ideally lint/typecheck) command to "checks".' });
    else add({ id: 'checks', level: 'required', status: resolved.some((/** @type {any} */ x) => x.r.ok === null) ? 'unverified' : 'ok', detail: resolved.map((/** @type {any} */ x) => x.text).join('\n') });
  }

  // setup
  const detected = detectSetup(repo.root);
  if (contract.setup) {
    const { r, text } = cmd('setup', contract.setup);
    add({ id: 'setup', level: 'recommended', status: r.ok === false ? 'invalid' : r.ok === null ? 'unverified' : 'ok', detail: text, fix: r.ok === false ? 'Fix the setup command.' : undefined });
  } else if (detected) {
    add({ id: 'setup', level: 'recommended', status: 'missing', detail: 'dependencies are declared but there is no setup command, so fresh worktrees will fail to build', fix: `Add "setup": "${detected || '<install command>'}".` });
  } else {
    add({ id: 'setup', level: 'recommended', status: 'ok', detail: 'no dependency manifest detected; no setup needed' });
  }

  // browser validation (primary repo or workspace app)
  const appDef = repo.primary ? workspaceApp || contract.app : null;
  if (repo.primary) {
    if (!appDef) {
      add({ id: 'browser-validation', level: 'optional', skippable: true, status: 'missing', detail: 'no "app" in the contract, so user-facing slices are only code-reviewed, never exercised in a browser', fix: 'Add "app": { "up": "<command that serves the app>", "env": { "PORT": "{port}" }, "url": "http://localhost:{port}", "ready": "/health" }. Any command works (dev server, docker compose, remote preview) as long as it serves a URL.' });
    } else {
      const { r, text } = cmd('app.up', appDef.up);
      add({ id: 'browser-validation', level: 'optional', skippable: true, status: r.ok === false ? 'invalid' : r.ok === null ? 'unverified' : 'ok', detail: text + (appDef.ready ? `; ready check ${appDef.ready}` : '; no "ready" path, so the root URL is polled'), fix: r.ok === false ? 'Fix app.up.' : undefined });
    }
  }

  // publish
  const origin = githubOrigin(repo.root);
  if (!origin) add({ id: 'publish', level: 'optional', skippable: true, status: 'missing', detail: 'no GitHub "origin" remote, so publishing writes a dry-run plan instead of PRs', fix: 'git remote add origin git@github.com:<org>/<repo>.git' });
  else if (!ghAuthed()) add({ id: 'publish', level: 'optional', skippable: true, status: 'invalid', detail: '`gh` is not installed or not authenticated', fix: 'brew install gh && gh auth login' });
  else add({ id: 'publish', level: 'optional', status: 'ok', detail: `draft PRs to ${origin}` });

  if (verify) await verifyRepo(repo, contract, appDef, add);
  return caps;
}

/**
 * Actually run setup, checks and app.up/down on HEAD.
 * @param {{ name: string, root: string, primary: boolean }} repo @param {any} contract @param {any} appDef
 * @param {(c: Omit<Capability, 'repo' | 'stage'>) => void} add
 */
async function verifyRepo(repo, contract, appDef, add) {
  if (dirtyPaths(repo.root).length) {
    add({ id: 'verify', level: 'recommended', status: 'unverified', detail: 'skipped running checks: the working tree has uncommitted changes', fix: 'Commit or stash, then re-run with verify.' });
    return;
  }
  const head = git(repo.root, ['rev-parse', 'HEAD']);
  const res = await runChecks({ cwd: repo.root, base: head, contract });
  const failed = res.checks.filter(c => !c.ok);
  add({
    id: 'verify-checks', level: 'required', status: failed.length ? 'failed' : 'ok',
    detail: res.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.id} (${Math.round((c.ms || 0) / 1000)}s): ${String(c.summary).split('\n')[0]}`).join('\n'),
    fix: failed.length ? `These must pass on your base commit, or every slice will fail too:\n${failed.map(c => `${c.id}: ${(c.output || c.summary).toString().slice(-800)}`).join('\n\n')}` : undefined,
  });
  if (appDef) {
    const logFile = path.join(repo.root, '.git', 'orchestrate-doctor-app.log');
    try {
      const info = await app.up({ cwd: repo.root, app: appDef, logFile });
      await app.down({ pid: info.pid, cwd: repo.root, app: appDef });
      add({ id: 'verify-app', level: 'optional', status: 'ok', detail: `app came up at ${info.url} and was stopped` });
    } catch (err) {
      add({ id: 'verify-app', level: 'optional', skippable: true, status: 'failed', detail: err instanceof Error ? err.message.slice(0, 1500) : String(err), fix: 'Fix app.up so it serves the URL (see the log), or skip browser validation.' });
    }
  }
}

/**
 * Doctor a repo and, if it has a workspace file, every repo in the workspace.
 * @param {{ cwd: string, verify?: boolean, forStart?: boolean, skip?: string[] }} opts
 */
export async function doctor({ cwd, verify = false, forStart = false, skip = [] }) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
  const primaryRoot = top ? commonRoot(repoRoot(cwd)) : path.resolve(cwd);
  const ws = readWorkspace(primaryRoot);
  /** @type {Capability[]} */
  const capabilities = [];
  for (const e of ws.errors) capabilities.push({ id: 'workspace', repo: '(workspace)', stage: 'multi-repo runs', level: 'required', status: 'invalid', detail: e, fix: `Fix ${WORKSPACE_FILE}.` });
  for (const repo of ws.repos) capabilities.push(...(await doctorRepo(repo, { verify, forStart, workspaceApp: ws.app })));

  const blocking = capabilities.filter(c => c.level === 'required' && c.status !== 'ok' && c.status !== 'unverified');
  const needsDecision = capabilities.filter(c => c.level !== 'required' && c.status !== 'ok' && c.status !== 'unverified' && c.skippable && !skip.includes(c.id));
  const recommended = capabilities.filter(c => c.level === 'recommended' && c.status !== 'ok' && c.status !== 'unverified');
  const enabled = {
    browserValidation: capabilities.some(c => c.id === 'browser-validation' && c.status !== 'missing' && c.status !== 'invalid') && !skip.includes('browser-validation') && !capabilities.some(c => c.id === 'verify-app' && c.status === 'failed'),
    publish: capabilities.filter(c => c.id === 'publish').every(c => c.status === 'ok') && !skip.includes('publish'),
  };
  return {
    ok: blocking.length === 0,
    ready: blocking.length === 0 && needsDecision.length === 0,
    workspace: { name: ws.name, file: ws.file, repos: ws.repos.map(r => ({ ...r, env: repoEnvVar(r.name) })), app: Boolean(ws.app) },
    enabled,
    blocking: blocking.map(c => c.id),
    needsDecision: needsDecision.map(c => c.id),
    recommended: recommended.map(c => c.id),
    capabilities,
    report: renderReport(capabilities, ws.repos.length > 1),
  };
}

const LEVEL_ICON = { required: '', recommended: ' (recommended)', optional: ' (optional)' };

/** @param {Capability[]} caps @param {boolean} multi */
export function renderReport(caps, multi) {
  const lines = [];
  for (const c of caps) {
    const icon = c.status === 'ok' ? '✅' : c.status === 'unverified' ? '🟡' : c.level === 'required' ? '❌' : c.level === 'recommended' ? '⚠️' : '➖';
    lines.push(`${icon} ${multi ? `[${c.repo}] ` : ''}**${c.id}**${LEVEL_ICON[c.level]} — ${c.stage}`);
    lines.push(...c.detail.split('\n').map(l => `   ${l}`));
    if (c.status !== 'ok' && c.fix) lines.push(...`To support this: ${c.fix}`.split('\n').map(l => `   ${l}`));
  }
  return lines.join('\n');
}
