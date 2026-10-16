// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { assertWorktree, changedFiles, checkedOutBranches, commitsBetween, diff, diffStat, git, tryRef } from '../lib/git.js';
import { ledger, loadRun, mutateRun } from '../lib/runs.js';
import { slicesIn } from '../lib/workspace.js';

/**
 * Ranges a slice selector covers: one entry per repo for "all", else one.
 * @param {any} run @param {number | string} n
 * @returns {{ repo: string, root: string, base: string, head: string, label: string }[]}
 */
export function sliceRanges(run, n) {
  if (n === 'all') {
    const out = [];
    for (const repo of Object.values(run.repos)) {
      const r = /** @type {any} */ (repo);
      const own = slicesIn(run, r.name).filter((/** @type {any} */ s) => tryRef(r.root, s.branch));
      const top = run.docs?.headSha && run.docs.repo === r.name ? run.docs.branch : own[own.length - 1]?.branch;
      if (top) out.push({ repo: r.name, root: r.root, base: r.baseSha, head: top, label: `${r.name}: whole stack` });
    }
    return out;
  }
  if (n === 'docs') {
    const r = run.repos[run.docs.repo];
    return [{ repo: r.name, root: r.root, base: run.docs.baseRef, head: run.docs.branch, label: 'docs' }];
  }
  const s = run.slices.find((/** @type {any} */ x) => x.n === Number(n));
  if (!s) throw new Error(`No slice ${n}`);
  const r = run.repos[s.repo];
  if (!tryRef(r.root, s.branch)) throw new Error(`Slice ${n} branch ${s.branch} does not exist yet`);
  return [{ repo: r.name, root: r.root, base: s.baseRef, head: s.branch, label: `slice ${s.n} (${r.name}): ${s.title}` }];
}

const MAX_DIFF = 120_000;

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'git',
  description: 'Read slice diffs and keep the stacked branches consistent.',
  functions: {
    sliceDiff: {
      signature: 'factory.git.sliceDiff({ runId: string, slice: number | "docs" | "all", context?: number, pathFilter?: string }): Promise<{ label, repo, root, base, head, commits, files, stat, diff, truncated }[] /* one entry per repo */>',
      description: "A slice's commits, changed files and unified diff against its parent branch (read-only). \"all\" returns the whole stack, one entry per repo.",
      tags: ['diff', 'review', 'changes', 'commits'],
      handler: ({ runId, slice, context = 3, pathFilter }, ctx) => {
        const run = loadRun(ctx.home, runId);
        let budget = MAX_DIFF;
        return sliceRanges(run, slice).map(({ repo, root, base, head, label }) => {
          let d = pathFilter ? git(root, ['diff', `-U${context}`, `${base}...${head}`, '--', pathFilter]) : diff(root, base, head, context);
          const truncated = d.length > budget;
          if (truncated) d = `${d.slice(0, Math.max(budget, 0))}\n… diff truncated; call again with pathFilter to read the rest`;
          budget -= d.length;
          return { label, repo, root, base, head, commits: commitsBetween(root, base, head), files: changedFiles(root, base, head), stat: diffStat(root, base, head), diff: d, truncated };
        });
      },
    },
    restack: {
      signature: 'factory.git.restack({ runId: string, fromSlice: number, cwd?: string /* a worktree of that slice\'s repo */ }): Promise<{ ok: boolean, rebased: (number | "docs")[], conflict?: { slice, files, how } }>',
      description: "After committing to slice N, rebase every later slice in the same repo's stack (and the docs branch) onto the new parent heads. Stops on conflicts with instructions; call again after `git rebase --continue`.",
      tags: ['rebase', 'stack', 'update-refs'],
      handler: ({ runId, fromSlice, cwd }, ctx) => {
        const dir = cwd || ctx.cwd;
        assertWorktree(dir, 'git.restack');
        const run = loadRun(ctx.home, runId);
        const from = run.slices.find((/** @type {any} */ s) => s.n === Number(fromSlice));
        if (!from) throw new Error(`No slice ${fromSlice}`);
        const gitDir = git(dir, ['rev-parse', '--absolute-git-dir']);
        if (['rebase-merge', 'rebase-apply'].some(p => fs.existsSync(path.join(gitDir, p)))) {
          throw new Error('A rebase is in progress here. Resolve conflicts, `git add`, `git rebase --continue`, then call restack again.');
        }
        const chain = [
          ...slicesIn(run, from.repo).map((/** @type {any} */ s) => ({ key: s.n, branch: s.branch, parentSha: s.parentSha })),
          ...(run.docs?.headSha && run.docs.repo === from.repo ? [{ key: 'docs', branch: run.docs.branch, parentSha: run.docs.parentSha }] : []),
        ];
        const start = chain.findIndex(c => c.key === from.n);
        const holders = checkedOutBranches(dir);
        const rebased = [];
        /** @type {Record<string, { parentSha: string, headSha: string }>} */
        const updates = {};
        for (let i = start + 1; i < chain.length; i++) {
          const parent = chain[i - 1];
          const cur = chain[i];
          const newParent = git(dir, ['rev-parse', parent.branch]);
          const holder = holders[cur.branch];
          if (holder && holder !== dir) throw new Error(`${cur.branch} is checked out in ${holder}; detach it there first.`);
          if (git(dir, ['merge-base', '--is-ancestor', newParent, cur.branch], { allowFail: true }) !== null) {
            updates[cur.key] = { parentSha: newParent, headSha: git(dir, ['rev-parse', cur.branch]) };
            continue;
          }
          const res = git(dir, ['rebase', '--onto', newParent, cur.parentSha, cur.branch], { allowFail: true });
          if (res === null) {
            const files = git(dir, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true }) || '';
            mutateRun(ctx.home, runId, r => applyUpdates(r, updates));
            ledger(ctx.home, runId, { event: 'git.restack.conflict', slice: cur.key, files });
            return { ok: false, rebased, conflict: { slice: cur.key, files: files.split('\n').filter(Boolean), how: `Resolve the conflicts in ${dir}, git add them, run \`git rebase --continue\`, then call factory.git.restack({ runId, fromSlice: ${fromSlice}, cwd }) again.` } };
          }
          updates[cur.key] = { parentSha: newParent, headSha: git(dir, ['rev-parse', cur.branch]) };
          rebased.push(cur.key);
        }
        git(dir, ['switch', '--detach'], { allowFail: true });
        mutateRun(ctx.home, runId, r => applyUpdates(r, updates));
        ledger(ctx.home, runId, { event: 'git.restack', fromSlice, repo: from.repo, rebased });
        return { ok: true, rebased, note: 'Re-run factory.checks.run for each rebased slice before reporting.' };
      },
    },
  },
};

/** @param {any} run @param {Record<string, { parentSha: string, headSha: string }>} updates */
function applyUpdates(run, updates) {
  for (const [key, u] of Object.entries(updates)) {
    const target = key === 'docs' ? run.docs : run.slices.find((/** @type {any} */ s) => String(s.n) === key);
    if (target) Object.assign(target, u);
  }
}
