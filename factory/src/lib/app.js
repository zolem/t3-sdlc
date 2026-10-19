// @ts-check
// Generic "run the app" contract. A repo declares in .orchestrate/factory.json:
//   "app": { "up": "npm run dev", "env": { "PORT": "{port}" }, "url": "http://localhost:{port}",
//            "ready": "/health", "readyTimeoutSec": 60, "urlPattern": "optional regex with one group",
//            "down": "optional teardown command" }
// The factory allocates a port, starts the command detached, waits until ready,
// and returns the URL. Each app implements `up` however it needs (local dev
// server, container, remote preview) — the factory only runs the command.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sh } from './git.js';

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** @param {string} s @param {Record<string, string>} vars */
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

/**
 * @param {{ cwd: string, app: any, logFile: string, vars?: Record<string, string>, extraEnv?: Record<string, string> }} opts
 */
export async function up({ cwd, app, logFile, vars = {}, extraEnv = {} }) {
  if (!app?.up) throw new Error('This repo has no "app.up" command in .orchestrate/factory.json, so the app cannot be started for validation.');
  const port = String(await freePort());
  const v = { port, ...vars };
  const env = { ...extraEnv, ...Object.fromEntries(Object.entries(app.env || {}).map(([k, val]) => [k, fill(String(val), { ...extraEnv, ...v })])) };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a');
  const child = spawn('/bin/bash', ['-lc', fill(app.up, { ...extraEnv, ...v })], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  fs.closeSync(fd);

  const deadline = Date.now() + (app.readyTimeoutSec || 90) * 1000;
  let url = app.url ? fill(app.url, v) : null;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const log = fs.readFileSync(logFile, 'utf8').slice(-3000);
      throw new Error(`app.up exited with code ${child.exitCode} before becoming ready. Log tail:\n${log}`);
    }
    if (!url && app.urlPattern) {
      const m = fs.readFileSync(logFile, 'utf8').match(new RegExp(app.urlPattern));
      if (m) url = m[1];
    }
    if (url) {
      try {
        const res = await fetch(new URL(app.ready || '/', url), { signal: AbortSignal.timeout(3000) });
        if (res.status < 500) return { url, port: Number(port), pid: child.pid, logFile, env };
        lastErr = `HTTP ${res.status}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    await new Promise(r => setTimeout(r, 750));
  }
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  } catch {}
  throw new Error(`App did not become ready within ${app.readyTimeoutSec || 90}s (${lastErr || 'no URL yet'}). Log: ${logFile}`);
}

/** @param {{ pid?: number, cwd: string, app: any, vars?: Record<string, string> }} opts */
export async function down({ pid, cwd, app, vars = {} }) {
  const out = { killed: false, downCommand: null };
  if (pid) {
    try {
      process.kill(-pid, 'SIGTERM');
      out.killed = true;
    } catch {}
  }
  if (app?.down) {
    const res = await sh(fill(app.down, vars), { cwd, timeoutMs: 120_000 });
    // @ts-ignore
    out.downCommand = { code: res.code };
  }
  return out;
}
