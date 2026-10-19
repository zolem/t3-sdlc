// @ts-check
import { execFileSync, spawn } from 'node:child_process';

/**
 * @param {string} cwd @param {string[]} args
 * @param {{ allowFail?: boolean, input?: string }} [opts]
 */
export function git(cwd, args, opts = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: opts.input, maxBuffer: 64 * 1024 * 1024 }).trimEnd();
  } catch (err) {
    if (opts.allowFail) return null;
    const e = /** @type {any} */ (err);
    throw new Error(`git ${args.join(' ')} failed: ${(e.stderr || e.message || '').toString().trim()}`);
  }
}

/** @param {string} cwd */
export function repoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

/** Main checkout root even when called from a linked worktree. @param {string} cwd */
export function commonRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return common.replace(/\/\.git\/?$/, '');
}

/** True when cwd is a linked worktree (not the repo's main checkout). @param {string} cwd */
export function isLinkedWorktree(cwd) {
  return git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']) !== git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
}

/** Refuse to move HEAD in someone's main checkout. @param {string} cwd @param {string} what */
export function assertWorktree(cwd, what) {
  if (!isLinkedWorktree(cwd)) throw new Error(`${what} changes which commit is checked out, so it only runs inside a linked worktree, never in the main checkout (${cwd}). Run it from your dispatch's worktree.`);
}

/** @param {string} cwd @param {string} [ref] */
export function sha(cwd, ref = 'HEAD') {
  return git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

/** @param {string} cwd @param {string} ref */
export function tryRef(cwd, ref) {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true }) || null;
}

/** @param {string} cwd */
export function currentBranch(cwd) {
  return git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }) || null;
}

/** Tracked or untracked changes, ignoring paths under `ignore`. @param {string} cwd @param {string[]} [ignore] */
export function dirtyPaths(cwd, ignore = []) {
  const out = git(cwd, ['status', '--porcelain', '--untracked-files=all']);
  return out.split('\n').filter(Boolean).map(l => l.slice(3)).filter(p => !ignore.some(i => p === i || p.startsWith(i)));
}

/** Map of branch → worktree path for branches currently checked out anywhere. @param {string} cwd */
export function checkedOutBranches(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  /** @type {Record<string, string>} */
  const map = {};
  let wt = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) wt = line.slice(9);
    if (line.startsWith('branch refs/heads/')) map[line.slice(18)] = wt;
  }
  return map;
}

/** @param {string} cwd @param {string} base @param {string} head */
export function commitsBetween(cwd, base, head) {
  const out = git(cwd, ['log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${base}..${head}`]);
  return out.split('\x1e').map(s => s.trim()).filter(Boolean).map(rec => {
    const [hash, subject, body] = rec.split('\x1f');
    return { sha: hash, subject, body: (body || '').trim() };
  });
}

/** @param {string} cwd @param {string} base @param {string} head */
export function diffStat(cwd, base, head) {
  return git(cwd, ['diff', '--stat', `${base}...${head}`]);
}

/** @param {string} cwd @param {string} base @param {string} head @param {number} [context] */
export function diff(cwd, base, head, context = 3) {
  return git(cwd, ['diff', `-U${context}`, `${base}...${head}`]);
}

/** Changed files with status letters. @param {string} cwd @param {string} base @param {string} head */
export function changedFiles(cwd, base, head) {
  const out = git(cwd, ['diff', '--name-status', `${base}...${head}`]);
  return out.split('\n').filter(Boolean).map(l => {
    const [status, ...rest] = l.split('\t');
    return { status: status[0], path: rest[rest.length - 1] };
  });
}

/**
 * Added line numbers per file from a zero-context diff.
 * @param {string} cwd @param {string} base @param {string} head
 * @returns {Record<string, number[]>}
 */
export function addedLines(cwd, base, head) {
  const out = git(cwd, ['diff', '-U0', '--no-color', `${base}...${head}`]);
  /** @type {Record<string, number[]>} */
  const map = {};
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      continue;
    }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m && file) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      (map[file] ??= []).push(...Array.from({ length: count }, (_, i) => start + i));
    }
  }
  return map;
}

/**
 * Removed or modified line ranges in `base` per file (what the change touches in old code).
 * @param {string} cwd @param {string} base @param {string} head
 * @returns {{ file: string, start: number, end: number }[]}
 */
export function touchedOldRanges(cwd, base, head) {
  const out = git(cwd, ['diff', '-U0', '--no-color', `${base}...${head}`]);
  const ranges = [];
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('--- ')) {
      file = line.startsWith('--- a/') ? line.slice(6) : null;
      continue;
    }
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (m && file) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count > 0) ranges.push({ file, start, end: start + count - 1 });
    }
  }
  return ranges;
}

/**
 * Run a shell command, capturing combined output (tail-limited).
 * @param {string} command @param {{ cwd: string, env?: Record<string, string>, timeoutMs?: number }} opts
 * @returns {Promise<{ code: number | null, output: string, ms: number, timedOut: boolean }>}
 */
export function sh(command, { cwd, env, timeoutMs = 20 * 60 * 1000 }) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn('/bin/bash', ['-lc', command], { cwd, env: { ...process.env, ...env, CI: '1', FORCE_COLOR: '0' } });
    let output = '';
    const cap = (/** @type {Buffer} */ b) => {
      output += b.toString();
      if (output.length > 400_000) output = output.slice(-200_000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, output, ms: Date.now() - started, timedOut });
    });
  });
}
