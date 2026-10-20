// @ts-check
// Serves a run's files (gate pages, cost report, screenshots) on localhost so the
// user's thread can open them in T3's preview with a link, instead of pasting a
// whole page through a model. One small detached server per run, reused.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runFile } from './store.js';

const MAIN = fileURLToPath(new URL('./serveMain.js', import.meta.url));

/** @param {number} ms */
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
  if (fs.existsSync(state)) {
    const s = JSON.parse(fs.readFileSync(state, 'utf8'));
    if (s.pid && alive(s.pid)) return `http://127.0.0.1:${s.port}`;
  }
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.rmSync(state, { force: true });
  const child = spawn(process.execPath, [MAIN, root, state], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 100 && !fs.existsSync(state); i++) sleep(50);
  if (!fs.existsSync(state)) throw new Error('Could not start the page server for this run');
  return `http://127.0.0.1:${JSON.parse(fs.readFileSync(state, 'utf8')).port}`;
}
