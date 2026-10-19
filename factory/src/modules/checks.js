// @ts-check
import { runChecks } from '../lib/checks.js';
import { assertWorktree, dirtyPaths, git, repoRoot, tryRef } from '../lib/git.js';
import { findDispatch } from '../lib/pipeline.js';
import { loadContract } from '../lib/repoContract.js';
import { ledger, loadRun, readRunFile, runFileExists, writeRunFile } from '../lib/runs.js';
import { repoForCwd } from '../lib/workspace.js';

/** @param {any} run @param {number | string} n */
function sliceRef(run, n) {
  if (n === 'docs') return { repo: run.docs.repo, branch: run.docs.branch, base: run.docs.baseRef, testCases: [] };
  const s = run.slices.find((/** @type {any} */ x) => x.n === Number(n));
  if (!s) throw new Error(`No slice ${n}`);
  return { repo: s.repo, branch: s.branch, base: s.baseRef, testCases: s.testCases || [] };
}

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'checks',
  description: "Deterministic gate: runs the commands the repo lists in .orchestrate/factory.json `checks` on a committed HEAD and records the result against that commit.",
  functions: {
    run: {
      signature: 'factory.checks.run({ runId?: string, dispatchId?: string, slice?: number | "docs", cwd?: string, base?: string, only?: string[] }): Promise<{ ok: boolean, sha: string, checks: { id, ok, summary, warn?, output? }[] }>',
      description: "Run the repo's checks on the committed HEAD of cwd (with `slice`, first check out that slice's head in cwd; worktrees only). Results are recorded against the commit sha; engineers cannot report done without a passing result. Engineers and the docs writer only.",
      tags: ['lint', 'test', 'typecheck', 'coverage', 'gate', 'verify', 'ci'],
      handler: async ({ runId, dispatchId, slice, cwd, base, only }, ctx) => {
        const dir = cwd || ctx.cwd;
        const run = runId ? loadRun(ctx.home, runId) : null;
        if (run && dispatchId) {
          const d = findDispatch(run, dispatchId);
          if (!['engineer', 'docs-writer'].includes(d.role)) throw new Error(`Only engineers run checks. As ${d.role}, read recorded results with factory.checks.results({ runId, slice }).`);
        }
        const repo = run ? repoForCwd(run, dir) : null;
        if (run && !repo) throw new Error(`${dir} is not a checkout of any repo in run ${run.id} (${Object.keys(run.repos).join(', ')})`);
        const contract = repo ? repo.contract : loadContract(repoRoot(dir));
        let baseRef = base;
        /** @type {string[]} */
        let testCases = [];
        const sliceN = slice ?? (run && dispatchId ? findDispatch(run, dispatchId).slice : undefined);
        if (run && sliceN !== undefined) {
          const ref = sliceRef(run, sliceN);
          if (repo && ref.repo !== repo.name) throw new Error(`Slice ${sliceN} lives in repo "${ref.repo}" but ${dir} is a checkout of "${repo.name}".`);
          if (slice !== undefined) {
            assertWorktree(dir, 'checks.run with `slice`');
            if (dirtyPaths(dir).length) throw new Error('Working tree is dirty; commit or stash before checking another slice');
            git(dir, ['switch', '--detach', ref.branch]);
          }
          baseRef ??= ref.base;
          testCases = ref.testCases;
        }
        baseRef ??= repo?.baseSha || 'HEAD~1';
        const resolvedBase = tryRef(dir, baseRef) || baseRef;
        const result = await runChecks({ cwd: dir, base: resolvedBase, contract, testCases, only, runId: run?.id, slice: sliceN });
        if (run && !only) {
          writeRunFile(ctx.home, run.id, `checks/${result.sha}.json`, JSON.stringify({ ...result, repo: repo?.name, slice: sliceN, dispatchId, at: new Date().toISOString() }, null, 2));
          ledger(ctx.home, run.id, { event: 'checks.run', dispatchId, repo: repo?.name, slice: sliceN, sha: result.sha, ok: result.ok, failed: result.checks.filter(c => !c.ok).map(c => c.id) });
        }
        return result;
      },
    },
    results: {
      signature: 'factory.checks.results({ runId: string, slice?: number | "docs", sha?: string }): Promise<object | null>',
      description: 'The recorded check result for a slice head (or a sha).',
      tags: ['gate', 'ci'],
      handler: ({ runId, slice, sha }, ctx) => {
        const run = loadRun(ctx.home, runId);
        const target = sha || (slice === 'docs' ? run.docs?.headSha : run.slices.find((/** @type {any} */ s) => s.n === Number(slice))?.headSha);
        if (!target || !runFileExists(ctx.home, runId, `checks/${target}.json`)) return null;
        return JSON.parse(readRunFile(ctx.home, runId, `checks/${target}.json`));
      },
    },
  },
};
