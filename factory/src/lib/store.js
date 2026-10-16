// @ts-check
// Filesystem state shared by every factory process. Each harness spawns its own
// factory over stdio, so all coordination goes through files under
// ORCHESTRATE_HOME with atomic writes and a coarse per-run lock.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Org content (roles/, policy/). Overridable for tests and forks. */
export const CONTENT_ROOT = process.env.ORCHESTRATE_CONTENT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @param {string} home */
export function runsDir(home) {
  return path.join(home, 'runs');
}

/** @param {string} home @param {string} runId */
export function runDir(home, runId) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error(`Invalid runId "${runId}"`);
  return path.join(runsDir(home), runId);
}

/**
 * Resolve a path inside a run's files folder, refusing escapes.
 * @param {string} home @param {string} runId @param {string} rel
 */
export function runFile(home, runId, rel) {
  const base = path.join(runDir(home, runId), 'files');
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Path escapes run folder: ${rel}`);
  return full;
}

/** @param {string} file @param {string | Buffer} data */
export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** @param {string} file @param {unknown} fallback */
export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

/** @param {string} file @param {unknown} value */
export function writeJson(file, value) {
  writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

/** @param {string} file @param {object} entry */
export function appendJsonl(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

/** @param {string} file */
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const LOCK_STALE_MS = 30_000;

/**
 * Run `fn` while holding a directory lock. Locks older than LOCK_STALE_MS are
 * treated as abandoned by a crashed process.
 * @template T
 * @param {string} lockPath
 * @param {() => T} fn
 * @returns {T}
 */
export function withLock(lockPath, fn) {
  const deadline = Date.now() + 15_000;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) fs.rmSync(lockPath, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

/** @param {string} text */
export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function now() {
  return new Date().toISOString();
}

/** @param {string} text */
export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'feature';
}
