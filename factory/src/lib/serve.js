// @ts-check
// Serves a run's files (gate pages, cost report, screenshots) on localhost so the
// user's thread can open them in T3's preview with a link, instead of pasting a
// whole page through a model. One small detached server per run, reused.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFile } from './store.js';

const MAIN = fileURLToPath(new URL('./serveMain.js', import.meta.url));

/** @param {number} ms */
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The recorded server is still ours: same pid, still running serveMain with our nonce. @param {any} s */
function ours(s) {
  if (!s?.pid || !s.nonce) return false;
  try {
    return execFileSync('ps', ['-p', String(s.pid), '-o', 'command='], { encoding: 'utf8' }).includes(s.nonce);
  } catch {
    return false;
  }
}

/** @param {string} file */
function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Base URL serving the run's files folder (…/files). Starts the server when needed.
 * With T3_SDLC_NO_SERVE set (tests), returns a file:// URL instead.
 * @param {string} home @param {string} runId
 */
export function runFilesUrl(home, runId) {
  const root = runFile(home, runId, '.');
  if (process.env.T3_SDLC_NO_SERVE) return `file://${root}`;
  const state = runFile(home, runId, 'apps/serve.json');
  const current = readState(state);
  if (ours(current)) return `http://127.0.0.1:${current.port}`;

  fs.mkdirSync(path.dirname(state), { recursive: true });
  const lock = `${state}.lock`;
  let fd = null;
  for (let i = 0; i < 60 && fd === null; i++) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch {
      // Someone else is starting it; a lock older than 10 s is left over from a crash.
      if (Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 10_000) fs.rmSync(lock, { force: true });
      sleep(50);
      const now = readState(state);
      if (ours(now)) return `http://127.0.0.1:${now.port}`;
    }
  }
  try {
    const again = readState(state);
    if (ours(again)) return `http://127.0.0.1:${again.port}`;
    fs.rmSync(state, { force: true });
    const nonce = crypto.randomBytes(8).toString('hex');
    spawn(process.execPath, [MAIN, root, state, nonce], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 100; i++) {
      const s = readState(state);
      if (s?.nonce === nonce) return `http://127.0.0.1:${s.port}`;
      sleep(50);
    }
    throw new Error('Could not start the page server for this run');
  } finally {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
