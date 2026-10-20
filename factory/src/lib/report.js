// @ts-check
// Validates a child's dispatch.report against its role contract. Rejections are
// returned to the child as errors so it keeps working instead of ending early.

import { contractFor, findingErrors, sliceErrors, testCaseIds } from './contracts.js';
import { explainerErrors } from './explainer.js';
import { checkedOutBranches, git, tryRef } from './git.js';

/**
 * @param {{ run: any, dispatch: any, report: any, files: { exists: (rel: string) => boolean, read: (rel: string) => string } }} p
 * @returns {{ errors: string[], apply: (run: any) => void }}
 */
export function validateReport({ run, dispatch, report, files }) {
  const errors = [];
  /** @type {((run: any) => void)[]} */
  const effects = [];
  const contract = contractFor(dispatch.role, dispatch.mode);
  const rootOf = (/** @type {string | undefined} */ repo) => (repo && run.repos?.[repo] ? run.repos[repo].root : run.repo.root);

  if (!report.summary || typeof report.summary !== 'string') errors.push('summary is required (1-3 sentences on what you did)');
  for (const out of contract.outputs || []) if (!files.exists(out)) errors.push(`Expected run file "${out}" — write it with factory.run.write({ runId, path: "${out}", content })`);

  const passing = (/** @type {string} */ sha) => {
    if (!files.exists(`checks/${sha}.json`)) return false;
    return JSON.parse(files.read(`checks/${sha}.json`)).ok === true;
  };
  const slice = dispatch.slice ? run.slices.find((/** @type {any} */ s) => s.n === dispatch.slice) : null;

  /** @param {string} branch @param {string} headSha @param {string} parentRef @param {string} [repo] */
  const branchChecks = (branch, headSha, parentRef, repo) => {
    const root = rootOf(repo);
    const actual = tryRef(root, branch);
    if (!actual) return void errors.push(`Branch ${branch} does not exist. Create it with: git switch -c ${branch} ${parentRef}`);
    if (headSha && !actual.startsWith(headSha) && !headSha.startsWith(actual)) errors.push(`headSha ${headSha} does not match ${branch} (${actual}). Report the branch head after your last commit.`);
    const parentSha = tryRef(root, parentRef);
    if (parentSha && git(root, ['merge-base', '--is-ancestor', parentSha, actual], { allowFail: true }) === null) errors.push(`${branch} is not based on ${parentRef}. Rebase it onto ${parentRef}.`);
    if (parentSha === actual) errors.push(`${branch} has no commits beyond ${parentRef}.`);
    if (!passing(actual)) errors.push(`No passing checks recorded for ${branch} @ ${actual.slice(0, 12)}. Run factory.checks.run({ runId, dispatchId, cwd }) on that commit and fix failures.`);
    const holder = checkedOutBranches(root)[branch];
    if (holder) errors.push(`${branch} is still checked out in ${holder}. Run \`git switch --detach\` there so later steps can use the branch.`);
    return { actual, parentSha };
  };

  switch (`${dispatch.role}:${dispatch.mode}`) {
    case 'qa-analyst:default': {
      if (files.exists('test-plan.md')) {
        const ids = testCaseIds(files.read('test-plan.md'));
        if (ids.length === 0) errors.push(`test-plan.md has no test case ids (expected TC-${run.tcPrefix || ''}${run.tcPrefix ? '-' : ''}NNN)`);
        const foreign = run.tcPrefix ? ids.filter(id => !id.startsWith(`TC-${run.tcPrefix}-`)) : [];
        if (foreign.length) errors.push(`Use this run's test-case prefix so ids never collide with tests already in the repo: TC-${run.tcPrefix}-001, TC-${run.tcPrefix}-002… Wrong ids: ${foreign.slice(0, 8).join(', ')}`);
      }
      break;
    }
    case 'slice-planner:default': {
      if (!files.exists('slices.json')) break;
      let doc;
      try {
        doc = JSON.parse(files.read('slices.json'));
      } catch (err) {
        errors.push(`slices.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
        break;
      }
      errors.push(...sliceErrors(doc, { testCases: files.exists('test-plan.md') ? testCaseIds(files.read('test-plan.md')) : [], exists: files.exists, repos: Object.keys(run.repos || {}) }));
      break;
    }
    case 'explainer:plan':
    case 'explainer:stack': {
      const out = contract.outputs?.[0];
      if (out && files.exists(out)) {
        let doc;
        try {
          doc = JSON.parse(files.read(out));
        } catch (err) {
          errors.push(`${out} is not valid JSON: ${err instanceof Error ? err.message : err}`);
          break;
        }
        errors.push(...explainerErrors(dispatch.mode, doc, { run, exists: files.exists, read: files.read, list: () => [], abs: rel => rel }).map(e => `${out}: ${e}`));
      }
      break;
    }
    case 'engineer:build': {
      if (!slice) break;
      if (report.branch !== slice.branch) errors.push(`branch must be "${slice.branch}"`);
      const r = branchChecks(slice.branch, report.headSha, slice.baseRef, slice.repo);
      if (r && errors.length === 0) {
        effects.push(run2 => {
          const s = run2.slices.find((/** @type {any} */ x) => x.n === slice.n);
          s.headSha = r.actual;
          s.parentSha ??= r.parentSha;
        });
      }
      break;
    }
    case 'engineer:feature-fix': {
      if (!Array.isArray(report.addressed)) errors.push('addressed must list { id, slice, how } for every blocking finding');
      else {
        const own = run.slices.filter((/** @type {any} */ x) => x.repo === dispatch.repo).map((/** @type {any} */ x) => x.n);
        for (const a of report.addressed) if (!own.includes(Number(a?.slice)) && a?.slice !== 'docs') errors.push(`addressed ${a?.id}: slice must be the number of the ${dispatch.repo} slice the fix landed in (or would have, if no change was needed): one of ${own.join(', ')}`);
      }
      const heads = [];
      for (const s of run.slices.filter((/** @type {any} */ x) => x.repo === dispatch.repo)) {
        const r = branchChecks(s.branch, '', s.baseRef, s.repo);
        if (r) heads.push({ n: s.n, sha: r.actual });
      }
      if (run.docs?.headSha && run.docs.repo === dispatch.repo) {
        const r = branchChecks(run.docs.branch, '', run.docs.baseRef, run.docs.repo);
        if (r) heads.push({ n: 'docs', sha: r.actual });
      }
      if (errors.length === 0) {
        effects.push(run2 => {
          for (const h of heads) {
            if (h.n === 'docs') run2.docs.headSha = h.sha;
            else run2.slices.find((/** @type {any} */ x) => x.n === h.n).headSha = h.sha;
          }
        });
      }
      break;
    }
    case 'docs-writer:default': {
      if (report.branch !== run.docs.branch) errors.push(`branch must be "${run.docs.branch}"`);
      const r = branchChecks(run.docs.branch, report.headSha, run.docs.baseRef, run.docs.repo);
      if (!report.docPath) errors.push('docPath is required (repo-relative path of the feature doc)');
      else if (r && git(rootOf(run.docs.repo), ['cat-file', '-e', `${r.actual}:${report.docPath}`], { allowFail: true }) === null) errors.push(`${report.docPath} is not committed on ${run.docs.branch}`);
      if (r && errors.length === 0) {
        effects.push(run2 => {
          run2.docs.headSha = r.actual;
          run2.docs.docPath = report.docPath;
          run2.docs.parentSha ??= r.parentSha;
        });
      }
      break;
    }
    case 'manual-tester:feature': {
      errors.push(...findingErrors(report.findings));
      if (!Array.isArray(report.screenshots) || report.screenshots.length === 0) errors.push('screenshots must list at least one run path saved with factory.run.attach (evidence for reviewers and the PR)');
      else for (const p of report.screenshots) if (!files.exists(p)) errors.push(`screenshot "${p}" is not in the run folder; save it with factory.run.attach({ runId, from: screenshotPath, as: "screenshots/<name>.png" })`);
      break;
    }
    case 'feature-reviewer:review':
      errors.push(...findingErrors(report.findings));
      break;
    case 'feature-reviewer:recheck': {
      errors.push(...findingErrors(report.findings));
      if (!Array.isArray(report.resolved)) errors.push('resolved must be an array of finding ids (use [] when none are resolved)');
      const open = files.exists(dispatch.extra.recheckFile) ? JSON.parse(files.read(dispatch.extra.recheckFile)).findings.map((/** @type {any} */ f) => f.id) : [];
      const answered = new Set([...(Array.isArray(report.resolved) ? report.resolved : []), ...(Array.isArray(report.findings) ? report.findings.map((/** @type {any} */ f) => f.id) : [])]);
      const missing = open.filter((/** @type {string} */ id) => !answered.has(id));
      if (missing.length) errors.push(`Account for every finding you are re-checking, in resolved or findings; missing: ${missing.join(', ')}`);
      break;
    }
    default:
      break;
  }

  return { errors, apply: run2 => effects.forEach(fn => fn(run2)) };
}
