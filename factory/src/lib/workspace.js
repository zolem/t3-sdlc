// @ts-check
// A run spans one or more repos (run.repos); every slice belongs to exactly one.
// Each repo is driven by its own T3 thread, launched by the foreman in a worktree
// of that repo, so T3 owns every worktree.

import { git } from './git.js';

/** @param {any} run */
export function primaryRepo(run) {
  return Object.values(run.repos).find((/** @type {any} */ r) => r.primary);
}

/** @param {any} run @param {string | undefined} name */
export function repoNamed(run, name) {
  const r = name ? run.repos[name] : primaryRepo(run);
  if (!r) throw new Error(`Unknown repo "${name}" (workspace repos: ${Object.keys(run.repos).join(', ')})`);
  return r;
}

/** Which repo a cwd belongs to (by its main checkout). @param {any} run @param {string} cwd */
export function repoForCwd(run, cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { allowFail: true });
  if (!common) return null;
  const root = common.replace(/\/\.git\/?$/, '');
  return Object.values(run.repos).find((/** @type {any} */ r) => r.root === root) || null;
}

/** @param {any} run */
export function isMultiRepo(run) {
  return Object.keys(run.repos).length > 1;
}

/** Slices of one repo, in stack order. @param {any} run @param {string} repo */
export function slicesIn(run, repo) {
  return run.slices.filter((/** @type {any} */ s) => s.repo === repo);
}

/** Give every slice its repo, branch and base ref (stacks are per repo). @param {any} run */
export function assignBranches(run) {
  const lastByRepo = /** @type {Record<string, any>} */ ({});
  for (const s of run.slices) {
    s.repo ??= primaryRepo(run).name;
    s.branch = `orch/${run.id}/${String(s.n).padStart(2, '0')}-${s.slug}`;
    s.baseRef = lastByRepo[s.repo]?.branch || run.repos[s.repo].baseSha;
    lastByRepo[s.repo] = s;
  }
  const primary = primaryRepo(run);
  const topPrimary = lastByRepo[primary.name];
  run.docs = {
    round: 1, repo: primary.name,
    branch: `orch/${run.id}/${String(run.slices.length + 1).padStart(2, '0')}-docs`,
    baseRef: topPrimary?.branch || primary.baseSha, headSha: null, docPath: null,
  };
}

/** The ref a repo's finished stack ends at: docs branch, else its last slice, else its base. @param {any} run @param {string} repo */
export function topRef(run, repo) {
  if (run.docs?.headSha && run.docs.repo === repo) return run.docs.branch;
  const own = slicesIn(run, repo).filter((/** @type {any} */ s) => s.headSha);
  return own.length ? own[own.length - 1].branch : run.repos[repo].baseSha;
}
