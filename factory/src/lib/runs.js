// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { appendJsonl, now, readJson, runDir, runFile, runsDir, withLock, writeAtomic, writeJson } from './store.js';

/** @param {string} home @param {string} runId */
export function runJsonPath(home, runId) {
  return path.join(runDir(home, runId), 'run.json');
}

/** @param {string} home @param {string} runId */
export function loadRun(home, runId) {
  const file = runJsonPath(home, runId);
  if (!fs.existsSync(file)) throw new Error(`Run "${runId}" not found under ${runsDir(home)}`);
  return readJson(file);
}

/**
 * Read-modify-write a run under its lock.
 * @template T
 * @param {string} home @param {string} runId @param {(run: any) => T} fn
 * @returns {T}
 */
export function mutateRun(home, runId, fn) {
  const dir = runDir(home, runId);
  return withLock(path.join(dir, '.lock'), () => {
    const run = loadRun(home, runId);
    const result = fn(run);
    run.updatedAt = now();
    writeJson(runJsonPath(home, runId), run);
    return result;
  });
}

/** @param {string} home @param {any} run */
export function createRunDir(home, run) {
  const dir = runDir(home, run.id);
  if (fs.existsSync(dir)) throw new Error(`Run ${run.id} already exists`);
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  writeJson(runJsonPath(home, run.id), run);
}

/** @param {string} home @param {string} runId @param {string} rel @param {string | Buffer} content */
export function writeRunFile(home, runId, rel, content) {
  writeAtomic(runFile(home, runId, rel), content);
}

/** @param {string} home @param {string} runId @param {string} rel */
export function readRunFile(home, runId, rel) {
  return fs.readFileSync(runFile(home, runId, rel), 'utf8');
}

/** @param {string} home @param {string} runId @param {string} rel */
export function runFileExists(home, runId, rel) {
  try {
    return fs.statSync(runFile(home, runId, rel)).size > 0;
  } catch {
    return false;
  }
}

/** @param {string} home @param {string} runId @param {string} [prefix] */
export function listRunFiles(home, runId, prefix = '') {
  const base = runFile(home, runId, '.');
  /** @type {{ path: string, bytes: number }[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push({ path: path.relative(base, full), bytes: fs.statSync(full).size });
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out.filter(f => f.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Append to the run ledger and the global ledger used for cross-run evals.
 * @param {string} home @param {string} runId @param {object} entry
 */
export function ledger(home, runId, entry) {
  const row = { ts: now(), runId, ...entry };
  appendJsonl(path.join(runDir(home, runId), 'ledger.jsonl'), row);
  appendJsonl(path.join(home, 'ledger.jsonl'), row);
}

/** @param {string} home */
export function listRuns(home) {
  const dir = runsDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(id => fs.existsSync(runJsonPath(home, id)))
    .map(id => {
      const r = readJson(runJsonPath(home, id));
      return { id, title: r.title, status: r.status, cursor: r.cursor, repo: r.repo?.root, createdAt: r.createdAt, updatedAt: r.updatedAt };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
