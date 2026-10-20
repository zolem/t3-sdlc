// @ts-check
import fs from 'node:fs';
import { down, up } from '../lib/app.js';
import { ensureSetup } from '../lib/checks.js';
import { ledger, loadRun, writeRunFile, readRunFile, runFileExists } from '../lib/runs.js';
import { runFile } from '../lib/store.js';
import { featureApp, findDispatch } from '../lib/pipeline.js';
import { primaryRepo } from '../lib/workspace.js';
import { repoEnvVar } from '../lib/repoContract.js';

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'app',
  description: "Start and stop the target app from a checkout using the repo's own app.up / app.down commands.",
  functions: {
    up: {
      signature: 'factory.app.up({ runId: string, dispatchId: string }): Promise<{ url: string, port: number, pid: number, logFile: string }>',
      description: "Install deps if needed, start the app on a free port, wait until it is ready, and return its URL. Serves the workspace (or primary) app from each repo thread's prepared checkout of its finished stack, passed as ORCH_REPO_<NAME>. One app per dispatch.",
      tags: ['start', 'server', 'preview', 'browser', 'manual test', 'vm'],
      handler: async ({ runId, dispatchId }, ctx) => {
        const run = loadRun(ctx.home, runId);
        findDispatch(run, dispatchId);
        /** @type {Record<string, string>} */
        const extraEnv = {};
        // The whole feature: every repo thread's prepared checkout of its finished stack.
        const appDef = featureApp(run);
        const missing = Object.values(run.repos).filter((/** @type {any} */ r) => run.repoState?.[r.name] && !r.checkout);
        if (missing.length) throw new Error(`Repos without a prepared checkout: ${missing.map((/** @type {any} */ r) => r.name).join(', ')}`);
        for (const r of Object.values(run.repos)) {
          const repo = /** @type {any} */ (r);
          const path = repo.checkout?.path || repo.root;
          extraEnv[repoEnvVar(repo.name)] = path;
          if (repo.checkout) {
            const setupRes = await ensureSetup(path, repo.contract);
            if (setupRes && !setupRes.ok) throw new Error(`Setup failed in ${repo.name}: ${setupRes.summary}\n${setupRes.output || ''}`);
          }
        }
        const dir = extraEnv[repoEnvVar(primaryRepo(run).name)];
        if (!appDef) throw new Error('Browser validation is not enabled for this run (no app in the contract or workspace, or the user skipped it).');
        const rel = `apps/${dispatchId}.json`;
        if (runFileExists(ctx.home, runId, rel)) {
          const prev = JSON.parse(readRunFile(ctx.home, runId, rel));
          try {
            process.kill(prev.pid, 0);
            return { ...prev, note: 'App already running for this dispatch.' };
          } catch {}
        }
        const logFile = runFile(ctx.home, runId, `apps/${dispatchId}.log`);
        const info = await up({ cwd: dir, app: appDef, logFile, vars: { runId, dispatchId }, extraEnv });
        writeRunFile(ctx.home, runId, rel, JSON.stringify({ ...info, cwd: dir, workspace: Boolean(run.workspace?.app), startedAt: new Date().toISOString() }, null, 2));
        ledger(ctx.home, runId, { event: 'app.up', dispatchId, url: info.url, pid: info.pid });
        return info;
      },
    },
    down: {
      signature: 'factory.app.down({ runId: string, dispatchId: string, cwd?: string }): Promise<{ killed: boolean }>',
      description: 'Stop the app started for this dispatch (and run app.down if the repo defines it).',
      tags: ['stop', 'cleanup'],
      handler: async ({ runId, dispatchId, cwd }, ctx) => {
        const run = loadRun(ctx.home, runId);
        const rel = `apps/${dispatchId}.json`;
        const info = runFileExists(ctx.home, runId, rel) ? JSON.parse(readRunFile(ctx.home, runId, rel)) : {};
        findDispatch(run, dispatchId);
        const appDef = featureApp(run);
        const res = await down({ pid: info.pid, cwd: cwd || info.cwd || ctx.cwd, app: appDef, vars: { runId, dispatchId, port: String(info.port || ''), ...(info.env || {}) } });
        if (info.pid) fs.rmSync(runFile(ctx.home, runId, rel), { force: true });
        ledger(ctx.home, runId, { event: 'app.down', dispatchId, ...res });
        return res;
      },
    },
    logs: {
      signature: 'factory.app.logs({ runId: string, dispatchId: string, tail?: number }): Promise<string>',
      description: 'Tail of the app log for a dispatch.',
      handler: ({ runId, dispatchId, tail = 4000 }, ctx) => {
        const file = runFile(ctx.home, runId, `apps/${dispatchId}.log`);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(-tail) : '';
      },
    },
  },
};
