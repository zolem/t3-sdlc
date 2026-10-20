// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { listRunFiles, loadRun, readRunFile, runFileExists, writeRunFile, ledger } from '../lib/runs.js';
import { runDir, runFile } from '../lib/store.js';

/** @param {any} run */
export function runInfo(run) {
  return {
    id: run.id, title: run.title, tcPrefix: run.tcPrefix, status: run.status, cursor: run.cursor, blocked: run.blocked,
    repos: Object.values(run.repos || { [run.repo.name || 'repo']: run.repo }).map((/** @type {any} */ r) => ({ name: r.name, root: r.root, primary: r.primary, baseBranch: r.baseBranch, baseSha: r.baseSha })),
    capabilities: run.capabilities,
    foreman: run.foreman,
    repoState: run.repoState,
    slices: run.slices.map((/** @type {any} */ s) => ({ n: s.n, repo: s.repo, title: s.title, layer: s.layer, ui: s.ui, branch: s.branch, baseRef: s.baseRef, dependsOn: s.dependsOn, phase: s.phase, headSha: s.headSha, author: s.author })),
    docs: run.docs, feature: run.feature, prs: run.prs,
    gates: Object.fromEntries(Object.entries(run.gates).map(([k, v]) => [k, /** @type {any[]} */ (v).map(g => ({ round: g.round, status: g.status, notes: g.notes }))])),
  };
}

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'run',
  description: 'Per-run artifact store shared by every agent and worktree (requirements, plans, reports, screenshots).',
  functions: {
    read: {
      signature: 'factory.run.read({ runId: string, path: string }): Promise<string>',
      description: 'Read a run file (e.g. "requirements.md", "slices/01-x.md").',
      tags: ['file', 'artifact', 'input'],
      handler: ({ runId, path: rel }, ctx) => readRunFile(ctx.home, runId, rel),
    },
    write: {
      signature: 'factory.run.write({ runId: string, path: string, content: string }): Promise<{ path: string, bytes: number }>',
      description: 'Write (create or replace) a run file. Use for every artifact you produce.',
      tags: ['file', 'artifact', 'output', 'save'],
      handler: ({ runId, path: rel, content }, ctx) => {
        if (typeof content !== 'string') throw new Error('content must be a string');
        writeRunFile(ctx.home, runId, rel, content);
        return { path: rel, bytes: Buffer.byteLength(content) };
      },
    },
    list: {
      signature: 'factory.run.list({ runId: string, prefix?: string }): Promise<{ path: string, bytes: number }[]>',
      description: 'List run files, optionally under a prefix such as "screenshots/".',
      tags: ['file', 'ls'],
      handler: ({ runId, prefix }, ctx) => listRunFiles(ctx.home, runId, prefix),
    },
    attach: {
      signature: 'factory.run.attach({ runId: string, from: string /* absolute path */, as: string /* run path */ }): Promise<{ path: string, absolutePath: string }>',
      description: 'Copy a local file (screenshot, recording, log) into the run, e.g. a preview_snapshot screenshotPath.',
      tags: ['screenshot', 'evidence', 'copy', 'upload'],
      handler: ({ runId, from, as }, ctx) => {
        const src = path.resolve(ctx.cwd, from);
        if (!fs.existsSync(src)) throw new Error(`No such file: ${src}`);
        const dest = runFile(ctx.home, runId, as);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        ledger(ctx.home, runId, { event: 'run.attach', path: as, bytes: fs.statSync(dest).size });
        return { path: as, absolutePath: dest };
      },
    },
    export: {
      signature: 'factory.run.export({ runId: string, path: string, to: string /* path inside YOUR_CWD */ }): Promise<{ to: string }>',
      description: 'Copy a run file into your working tree (e.g. screenshots into docs).',
      tags: ['copy', 'docs', 'screenshot'],
      handler: ({ runId, path: rel, to }, ctx) => {
        const dest = path.resolve(ctx.cwd, to);
        if (!dest.startsWith(ctx.cwd + path.sep)) throw new Error('`to` must be inside your working directory');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(runFile(ctx.home, runId, rel), dest);
        return { to: path.relative(ctx.cwd, dest) };
      },
    },
    exists: {
      signature: 'factory.run.exists({ runId: string, path: string }): Promise<boolean>',
      description: 'Whether a non-empty run file exists.',
      handler: ({ runId, path: rel }, ctx) => runFileExists(ctx.home, runId, rel),
    },
    info: {
      signature: 'factory.run.info({ runId: string }): Promise<{ id, title, status, cursor, repo, slices, docs, feature, prs, gates, filesRoot }>',
      description: 'Run state: slices with branches and status, gates, PRs, and the absolute filesRoot of the run folder.',
      tags: ['status', 'state', 'slices'],
      handler: ({ runId }, ctx) => ({ ...runInfo(loadRun(ctx.home, runId)), filesRoot: path.join(runDir(ctx.home, runId), 'files') }),
    },
  },
};
