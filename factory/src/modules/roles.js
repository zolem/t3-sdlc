// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { composeBrief, resolveRoleText } from '../lib/brief.js';
import { CONTRACTS } from '../lib/contracts.js';
import { findDispatch } from '../lib/pipeline.js';
import { ledger, loadRun, mutateRun } from '../lib/runs.js';
import { CONTENT_ROOT } from '../lib/store.js';

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'roles',
  description: 'Role briefs: how each agent should think and work, layered org → user → repo, plus the per-dispatch assignment.',
  functions: {
    brief: {
      signature: 'factory.roles.brief({ runId: string, dispatchId: string }): Promise<{ brief: string, hash: string }>',
      description: 'Your complete instructions for a dispatch: role guidance plus inputs, steps, output contract and call shapes. Call this first.',
      tags: ['instructions', 'prompt', 'start', 'assignment'],
      handler: ({ runId, dispatchId }, ctx) => {
        const run = loadRun(ctx.home, runId);
        const d = findDispatch(run, dispatchId);
        const { brief, hash, sources } = composeBrief({ run, dispatch: d, home: ctx.home, signatures: ctx.signatures || {} });
        mutateRun(ctx.home, runId, r => {
          const x = findDispatch(r, dispatchId);
          x.promptHash = hash;
          x.roleSources = sources.map(s => `${s.layer}${s.version ? `@${s.version}` : ''}`);
          x.briefedAt ??= new Date().toISOString();
          x.cwd = ctx.cwd;
        });
        ledger(ctx.home, runId, { event: 'dispatch.briefed', dispatchId, role: d.role, mode: d.mode, promptHash: hash, roleSources: sources.map(s => s.layer), cwd: ctx.cwd });
        return { brief, hash };
      },
    },
    list: {
      signature: 'factory.roles.list(): Promise<{ role: string, modes: string[], summary: string }[]>',
      description: 'Every role and mode the pipeline uses.',
      handler: () => Object.entries(CONTRACTS).map(([role, modes]) => ({ role, modes: Object.keys(modes), summary: Object.values(modes)[0].summary })),
    },
    show: {
      signature: 'factory.roles.show({ role: string, repo?: string }): Promise<{ text: string, sources: { layer, file, version, mode }[] }>',
      description: 'The resolved guidance for a role and which layers contributed (for reviewing and improving prompts).',
      tags: ['prompt', 'overlay', 'override'],
      handler: ({ role, repo }, ctx) => resolveRoleText({ role, home: ctx.home, repo: repo ? path.resolve(ctx.cwd, repo) : undefined }),
    },
    overlayPaths: {
      signature: 'factory.roles.overlayPaths({ role: string, repo?: string }): Promise<{ org: string, user: string, repo?: string }>',
      description: 'Where to put an overlay to change a role. Overlays append by default; start the file with "---\\nmode: replace\\n---" to replace.',
      handler: ({ role, repo }, ctx) => ({
        org: path.join(CONTENT_ROOT, 'roles', `${role}.md`),
        user: path.join(ctx.home, 'roles', `${role}.md`),
        ...(repo ? { repo: path.join(path.resolve(ctx.cwd, repo), '.orchestrate', 'roles', `${role}.md`) } : {}),
        exists: fs.existsSync(path.join(CONTENT_ROOT, 'roles', `${role}.md`)),
      }),
    },
  },
};
