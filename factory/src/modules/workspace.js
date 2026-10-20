// @ts-check
import { assertWorktree, dirtyPaths, git } from '../lib/git.js';
import { checkedOut } from '../lib/pipeline.js';
import { ledger, mutateRun, loadRun } from '../lib/runs.js';
import { repoEnvVar } from '../lib/repoContract.js';
import { repoForCwd, topRef } from '../lib/workspace.js';
import { envFor } from './orchestrator.js';

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'workspace',
  description: 'The repos a run spans, their threads, and the checkouts used for whole-feature checks.',
  functions: {
    info: {
      signature: 'factory.workspace.info({ runId: string }): Promise<{ name, repos: { name, root, primary, baseBranch, baseSha, env, threadId, phase, checkout }[], app: boolean }>',
      description: 'Repos in this run, which is primary, each repo thread and phase, and the ORCH_REPO_<NAME> env var each is exposed as to app commands.',
      tags: ['repos', 'multi-repo', 'threads'],
      handler: ({ runId }, ctx) => {
        const run = loadRun(ctx.home, runId);
        return {
          name: run.workspace?.name || null,
          repos: Object.values(run.repos).map((/** @type {any} */ r) => ({
            name: r.name, root: r.root, primary: r.primary, baseBranch: r.baseBranch, baseSha: r.baseSha, env: repoEnvVar(r.name),
            threadId: r.thread?.threadId || null, phase: run.repoState?.[r.name]?.phase || null, checkout: r.checkout || null,
          })),
          app: Boolean(run.workspace?.app),
        };
      },
    },
    prepare: {
      signature: 'factory.workspace.prepare({ runId: string, repo: string, cwd: string /* the repo thread\'s own worktree */ }): Promise<{ path, ref, sha }>',
      description: "Repo threads only. Points the thread's own worktree at the repo's finished stack (discarding uncommitted leftovers) so whole-feature review and validation run against it, then tells the foreman this milestone is done.",
      tags: ['checkout', 'milestone'],
      handler: ({ runId, repo, cwd }, ctx) => {
        const dir = cwd || ctx.cwd;
        assertWorktree(dir, 'workspace.prepare');
        const run = loadRun(ctx.home, runId);
        const own = repoForCwd(run, dir);
        if (!own || own.name !== repo) throw new Error(`${dir} is not a worktree of repo "${repo}"`);
        // The worktree belongs to the run; leftovers from a crashed step or from checks
        // that write untracked files are discarded (committed work lives on branches).
        const dirty = dirtyPaths(dir);
        if (dirty.length) {
          git(dir, ['reset', '--hard']);
          git(dir, ['clean', '-fd']);
          ledger(ctx.home, runId, { event: 'workspace.cleaned', repo, path: dir, paths: dirty.slice(0, 20) });
        }
        const ref = topRef(run, repo);
        git(dir, ['switch', '--detach', ref]);
        const sha = git(dir, ['rev-parse', 'HEAD']);
        mutateRun(ctx.home, runId, r => checkedOut(r, repo, { path: dir, sha }, envFor(ctx.home, runId)));
        ledger(ctx.home, runId, { event: 'workspace.prepare', repo, ref, sha, path: dir });
        return { path: dir, ref, sha, next: `Call factory.orchestrator.next({ runId: "${runId}", repo: "${repo}" }).` };
      },
    },
  },
};
