// @ts-check
import path from 'node:path';
import { comment, getIssue, issueToBrief, linearConfigured } from '../lib/linear.js';
import { readContract } from '../lib/repoContract.js';
import { doctor, suggestContract } from '../lib/doctor.js';
import { BUILTINS } from '../lib/checks.js';
import { repoRoot } from '../lib/git.js';

/** @type {import('../registry.js').ModuleDef} */
const linear = {
  name: 'linear',
  description: 'Linear tickets (API key stays in the factory; agents never see it).',
  functions: {
    issue: {
      signature: 'factory.linear.issue({ id: string /* e.g. "ABC-123" */ }): Promise<{ identifier, title, url, state, labels, description, comments, brief }>',
      description: 'Fetch a ticket with its comments, plus a ready-to-use brief.',
      tags: ['ticket', 'issue', 'intake'],
      handler: async ({ id }) => {
        const issue = await getIssue(id);
        return { ...issue, brief: issueToBrief(issue) };
      },
    },
    comment: {
      signature: 'factory.linear.comment({ id: string, body: string }): Promise<{ success: boolean }>',
      description: 'Post a comment on a ticket (orchestrator only: status updates and PR links).',
      tags: ['ticket', 'status', 'update'],
      handler: ({ id, body }) => comment(id, body),
    },
    configured: {
      signature: 'factory.linear.configured(): Promise<boolean>',
      description: 'Whether a Linear API key is available to the factory.',
      handler: () => linearConfigured(),
    },
  },
};

/** @type {import('../registry.js').ModuleDef} */
const repo = {
  name: 'repo',
  description: "A repo's contract with the factory (.orchestrate/factory.json): checking it, proposing it, reading it.",
  functions: {
    doctor: {
      signature: 'factory.repo.doctor({ repo?: string /* path, defaults to cwd */, verify?: boolean /* also run setup, checks and app.up on HEAD */ }): Promise<{ ok, ready, blocking: string[], needsDecision: string[], recommended: string[], enabled, workspace, capabilities: { id, repo, stage, level, status, detail, fix }[], report: string }>',
      description: 'Preflight: can every stage of the flow run in this repo (or workspace)? Lists each capability with its stage, whether it is required/recommended/optional, and the exact fix when it is missing. Same check /orchestrate runs before starting.',
      tags: ['preflight', 'setup', 'doctor', 'verify', 'contract', 'onboarding'],
      handler: ({ repo: dir, verify }, ctx) => doctor({ cwd: path.resolve(ctx.cwd, dir || '.'), verify: Boolean(verify) }),
    },
    suggest: {
      signature: 'factory.repo.suggest({ repo?: string }): Promise<{ contract: object, notes: string[], existing: object | null }>',
      description: 'Propose a .orchestrate/factory.json from what the repo already has (package scripts, Makefile, pyproject, go.mod, Cargo, migrations folder). Never writes.',
      tags: ['init', 'setup', 'contract', 'onboarding'],
      handler: ({ repo: dir }, ctx) => {
        const root = repoRoot(path.resolve(ctx.cwd, dir || '.'));
        return { ...suggestContract(root), existing: readContract(root).contract };
      },
    },
    contract: {
      signature: 'factory.repo.contract({ cwd?: string }): Promise<{ setup?, checks?, app?, docs? } | null>',
      description: 'The contract the repo declares, or null.',
      tags: ['config', 'checks', 'app'],
      handler: ({ cwd }, ctx) => readContract(repoRoot(path.resolve(ctx.cwd, cwd || '.'))).contract,
    },
    builtins: {
      signature: 'factory.repo.builtins(): Promise<{ name, usage, description }[]>',
      description: 'Built-in checks a contract can list as `orchestrate check <name>` commands.',
      tags: ['checks', 'secrets', 'coverage', 'migrations'],
      handler: () => Object.entries(BUILTINS).map(([name, b]) => ({ name, usage: b.usage, description: b.description })),
    },
  },
};

export default [linear, repo];
