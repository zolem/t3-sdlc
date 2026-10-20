// @ts-check
// Composes the brief a child receives from factory.roles.brief: the role's
// judgment guidance (markdown, overridable per org/user/repo) followed by an
// assignment the factory generates for this exact dispatch — inputs, mechanical
// steps, output contract, and the call shapes it needs.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_ROOT, sha256 } from './store.js';
import { contractFor, SEVERITIES } from './contracts.js';
import { cliCommand } from './paths.js';

/**
 * Split optional frontmatter (`mode: append|replace`, `version: x`).
 * @param {string} text
 */
function parseOverlay(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

/**
 * Resolve a role's guidance through its layers.
 * @param {{ role: string, home: string, repo?: string }} p
 */
export function resolveRoleText({ role, home, repo }) {
  const layers = [
    { layer: 'org', file: path.join(CONTENT_ROOT, 'roles', `${role}.md`) },
    { layer: 'user', file: path.join(home, 'roles', `${role}.md`) },
    ...(repo ? [{ layer: 'repo', file: path.join(repo, '.orchestrate', 'roles', `${role}.md`) }] : []),
  ];
  let text = '';
  const sources = [];
  for (const l of layers) {
    if (!fs.existsSync(l.file)) continue;
    const { meta, body } = parseOverlay(fs.readFileSync(l.file, 'utf8'));
    if (l.layer === 'org' || meta.mode === 'replace') text = body.trim();
    else text = `${text}\n\n## ${l.layer === 'user' ? 'Your' : 'This repository’s'} additions\n\n${body.trim()}`;
    sources.push({ layer: l.layer, file: l.file, version: meta.version || null, mode: l.layer === 'org' ? 'base' : meta.mode || 'append' });
  }
  if (!text) throw new Error(`No role brief found for "${role}" (looked in ${layers.map(l => l.file).join(', ')})`);
  return { text, sources };
}

const FINDING_SHAPE = `type Finding = { id: string /* unique in your report, e.g. "R1" */, severity: ${SEVERITIES.map(s => `"${s}"`).join(' | ')}, title: string, detail: string /* what, why it matters, how to fix */, category?: string, file?: string, line?: number, slice?: number, steps?: string /* repro steps for behavior bugs */ }`;

/** @param {any} run @param {any} d */
function steps(run, d) {
  const slice = d.slice ? run.slices.find((/** @type {any} */ s) => s.n === d.slice) : null;
  const repo = run.repos?.[d.repo] || run.repo;
  const contract = repo.contract || {};
  const multi = Object.keys(run.repos || {}).length > 1;
  const docsDir = contract.docs?.dir || 'docs/features';
  const setup = contract.setup ? `If dependencies are missing, run \`${contract.setup}\` (checks also do this automatically).` : '';
  const shared = `YOUR_CWD is this repo's run worktree. Every step of the run for \`${repo.name}\` works in it, one at a time, so start from and leave behind a clean tree. The worktree belongs to the run alone, so if \`git status --porcelain\` is not empty when you start, an earlier step crashed mid-way: discard its leftovers with \`git reset --hard && git clean -fd && git switch --detach\` and continue (committed work on slice branches is safe).`;
  const report = (/** @type {string} */ extra) => `Report: \`await factory.dispatch.report({ runId: "${run.id}", dispatchId: "${d.id}", summary${extra} })\`. If it returns errors, fix them and report again.`;

  switch (`${d.role}:${d.mode}`) {
    case 'engineer:build':
      return [
        shared,
        `Create the slice branch: \`git switch -c ${slice.branch} ${d.extra.baseRef}\` (if it already exists from an earlier attempt: \`git switch ${slice.branch}\`). ${setup}`,
        'Implement only this slice. Make small atomic commits, one per logical change, each leaving the build green. End every commit message with a `Slice: ' + slice.n + '` trailer.',
        `Make every assigned test case pass: ${(slice.testCases || []).join(', ') || '(none assigned; follow the spec)'}. Decide which to automate for regression protection: automate each one the repo's existing test setup can assert reliably, with its TC id in the test name; for any you do not automate, give a concrete reason (the manual tester runs through every case regardless). Do not add new test tooling.`,
        'Nobody reviews this slice on its own: the whole feature is reviewed once it is built, and the repo\'s checks are your gate. Before you commit, re-read your diff against the spec as a reviewer would (missed acceptance criteria, edge cases, error handling, leftover debug code).',
        `Run the deterministic gate: \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\`. Fix every failure and re-run until ok is true. Results are tied to the HEAD commit, so re-run after any new commit.`,
        'Release the branch for the next step: `git switch --detach`, and leave the tree clean.',
        report(`, branch: "${slice.branch}", headSha: "<git rev-parse ${slice.branch}>", tests: [{ id: "TC-…", automated: true, where: "test/file.test.ts" } | { id: "TC-…", automated: false, why: "…" }] /* one entry per assigned case */`),
      ];
    case 'engineer:feature-fix':
      return [
        shared,
        `Your repo \`${repo.name}\` has this stack of branches: ${run.slices.filter((/** @type {any} */ s) => s.repo === repo.name).map((/** @type {any} */ s) => `${s.n}) ${s.branch}`).join(', ')}${run.docs?.headSha && run.docs.repo === repo.name ? `, then ${run.docs.branch}` : ''}. Each builds on the previous one.${multi ? ' Findings for other repos are handled by their own threads; fix only what is in your input.' : ''}`,
        'For each finding, fix it in the LOWEST slice it belongs to: `git switch <that branch>`, commit the fix (trailer `Slice: N`), then `git switch --detach`. If you believe a finding is wrong, change nothing for it and say why in `addressed[].how`; the reviewer who raised it re-checks your reason.',
        `After committing to slice N, restack everything above it: \`await factory.git.restack({ runId: "${run.id}", fromSlice: N, cwd: YOUR_CWD })\`. If it reports a conflict, resolve it, \`git add\` + \`git rebase --continue\`, and call restack again with the same fromSlice.`,
        `Run checks on every slice you touched or that was restacked: \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", slice: N, cwd: YOUR_CWD })\` (it checks out that slice head for you; use slice: "docs" for the docs branch). All must pass.`,
        'Leave YOUR_CWD detached (`git switch --detach`).',
        report(', addressed: [{ id, slice, how }]'),
      ];
    case 'manual-tester:feature': {
      const recheck = d.inputs.some((/** @type {any} */ i) => i.path.startsWith('reviews/'));
      return [
        `Start the whole system: \`const app = await factory.app.up({ runId: "${run.id}", dispatchId: "${d.id}" })\` → { url, logFile }. It serves every repo from its finished stack (each repo thread prepared its checkout); do not edit or switch anything.`,
        'Drive a real browser with the T3 preview tools: preview_open({ url, open: true, reuseExistingTab: false }) (hidden tabs cannot be screenshotted), then preview_snapshot / preview_click / preview_type / preview_press / preview_wait_for. Keep using the tabId preview_open returns.',
        recheck
          ? 'This is a re-check after fixes: first confirm each validation finding in the last round is fixed (report the ones that are not, keeping their ids), then re-run the test cases the fixes touched. Do not repeat the whole run-through.'
          : 'Run through EVERY test case in test-plan.md end to end, as a user would, including its edge cases (empty, too long, double submit, refresh, back button). Each slice\'s `tests` (factory.run.info) says which cases are also automated; run them all anyway.',
        `Capture evidence: \`preview_snapshot\` with save=true gives a screenshotPath; copy it into the run with \`await factory.run.attach({ runId: "${run.id}", from: screenshotPath, as: "screenshots/${d.id}/slice-<N>-<step>.png" })\`, where N is the slice whose change the screenshot shows. Take one per meaningful state (before, after, error). If the screenshot tool keeps failing, carry on testing and report \`noScreenshots: "<what failed>"\` instead of screenshots. Never attach a screenshot from an earlier round.`,
        `Stop the app when done: \`await factory.app.down({ runId: "${run.id}", dispatchId: "${d.id}" })\`.`,
        `Write a short human-readable report to run file \`verification/${d.id}.md\` (what you tried, what you saw, screenshots).`,
        report(`, cases: [{ id: "TC-…", result: "pass" | "fail" | "not-run", note? }]${recheck ? ' /* the cases you re-ran */' : ' /* every test case */'}, findings: Finding[] /* every failed case, plus anything else you found */, screenshots: string[] /* run paths */, noScreenshots?: string`),
      ];
    }
    case 'feature-reviewer:review':
      return [
        `Review the whole feature as one change. Slices: ${run.slices.map((/** @type {any} */ s) => `${s.n}) ${s.title}`).join('; ')}.`,
        `Diffs per slice: \`await factory.git.sliceDiff({ runId: "${run.id}", slice: N })\`; whole stack: \`await factory.git.sliceDiff({ runId: "${run.id}", slice: "all" })\`. Read-only: never check out or edit.`,
        `History guard: \`await factory.history.forDiff({ runId: "${run.id}", slice: "all" })\`. Deterministic checks already passed on every slice (\`factory.checks.results({ runId: "${run.id}", slice: N })\`); do not repeat what they prove.`,
        'You are one of two independent reviewers from different model families. Assume the other reviewer is good; your value is what they might miss. Hunt for: requirement gaps, cross-slice integration bugs, unhandled edge cases, data integrity, security, broken history intent, missing tests.',
        `Check regression protection: each slice's \`tests\` (factory.run.info({ runId: "${run.id}" })) says which test cases its engineer automated (and where) and why the rest were not. Confirm the automated tests really assert their case and the reasons hold; flag P0 behaviour or cross-slice integration nothing would catch if it regressed (category "tests").`,
        'Set `slice` on each finding when you can tell where it belongs. Severity drives the outcome: critical/high/medium findings are fixed and then re-checked by you; low/nit are follow-ups and are never re-raised.',
        report(', findings: Finding[]'),
      ];
    case 'feature-reviewer:recheck':
      return [
        `Read \`${d.extra.recheckFile}\`: your open findings, what the engineers did about each, and the slice heads you reviewed (\`reviewedHeads\`).`,
        `See what changed since: for each slice, \`git -C <repo root> diff <reviewedHeads[N]> <branch>\` (branches and roots: \`factory.run.info({ runId: "${run.id}" })\`), or \`factory.git.sliceDiff\` for the current slice. Read-only: never check out or edit.`,
        'For each finding: if it is fixed, or the engineer\'s reason for not changing it holds, list its id in `resolved`. Otherwise report it again in `findings` with the same id. Add a new finding only for something the fixes broke. Do not review anything else: this is a re-check, not a new review.',
        report(', resolved: string[], findings: Finding[]'),
      ];
    case 'docs-writer:default':
      return [
        shared,
        `In YOUR_CWD: ${d.extra.refresh ? `\`git switch ${run.docs.branch}\` and update the existing doc for the latest changes` : `\`git switch -c ${run.docs.branch} ${d.extra.baseRef}\``}. ${setup}`,
        `Write the versioned feature doc at \`${docsDir}/<feature-slug>.md\`: plain-language summary, what changed and why, Mermaid diagrams of the data/request flow, decisions and trade-offs, how to test, follow-ups. Link the run id.`,
        `Copy useful screenshots from the run (\`factory.run.list({ runId: "${run.id}", prefix: "screenshots/" })\`) into \`${docsDir}/<feature-slug>/\` with \`factory.run.export({ runId, path, to })\` and reference them from the doc. Keep each file's \`slice-N-<step>.png\` name so each PR can show its own screenshots.`,
        `Commit (trailer \`Slice: docs\`), run \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\` until ok, then \`git switch --detach\` and leave the tree clean.`,
        report(`, branch: "${run.docs.branch}", headSha: "<sha>", docPath: "${docsDir}/…"`),
      ];
    case 'qa-analyst:default':
      return [
        `Number every test case \`TC-${run.tcPrefix || 'X'}-001\`, \`TC-${run.tcPrefix || 'X'}-002\`, … (this run's prefix). The repo may already have tests tagged with other TC ids; never reuse or renumber those.`,
        `Write \`test-plan.md\` with \`await factory.run.write({ runId: "${run.id}", path: "test-plan.md", content })\`.`,
        report(', testCases: ["TC-…-001", …]'),
      ];
    case 'slice-planner:default':
      return [
        'Write each slice spec to the run as `slices/NN-<slug>.md` (factory.run.write), then write `slices.json`:',
        '```json\n{ "slices": [ { "n": 1, "slug": "notes-table", "title": "…", "layer": "data|api|ui|infra|docs|other", "summary": "what this PR contains", "why": "what it unlocks for the next slice / the user", "dependsOn": [], "ui": false, "testCases": ["TC-001"], "spec": "slices/01-notes-table.md" } ] }\n```',
        ...(multi ? [`This run spans several repos (${Object.values(run.repos).map((/** @type {any} */ r) => `\`${r.name}\`${r.primary ? ' (primary)' : ''}`).join(', ')}). Every slice changes exactly one repo: add \`"repo": "<name>"\` to each. Order slices so dependencies land first across repos (e.g. the service endpoint before the UI that calls it); each repo becomes its own PR stack.`] : []),
        'Every TC id in test-plan.md goes in the `testCases` of exactly one slice: the one that makes it pass. Whether a case gets automated is the engineer\'s call, not yours; the manual tester runs through every case once the feature is built. `ui` is true when the slice changes what a user sees or does in the browser.',
        report(''),
      ];
    case 'explainer:plan':
      return [
        'Write ONE JSON document to run file `explainers/plan.json` (factory.run.write). Do not write HTML: the factory validates your JSON, renders your Mermaid to SVG, adds what it already knows (slice cards, the order diagram, test assignments) and shows the page at the plan gate.',
        'Shape:\n```ts\n{\n  intent: string /* one sentence: who gets what */,\n  outcome: string /* 2-4 plain sentences: what changes for users and how we will know it worked */,\n  needsYourCall: { title, detail, default /* what happens if nobody objects */ }[] /* open questions, assumptions, risky calls; [] when none */,\n  diagrams: { title, caption?, before?: Mermaid, after: Mermaid }[] /* 1-3 diagrams of how the system changes. Lead with a sequenceDiagram of the main user/request flow; add a flowchart of the parts touched with nodes marked `class X added`, `class Y changed` or `class Z removed` (the factory styles them). Omit before only for something brand new. 12 nodes or fewer each. */,\n  slices: { n, story /* why it comes here and what it unlocks next */, verify: string[] /* 1-4 concrete things to check in this PR */ }[] /* every slice in slices.json */,\n  tests: { id, what /* the behaviour, in plain words */, why /* what would break or go unnoticed without it */ }[] /* every TC id in test-plan.md; never test code */,\n  decisions: { choice, why, alternatives: string[] }[],\n  risks: { risk, level: "high" | "medium" | "low", mitigation }[],\n  engineering: { heading, items: string[] }[] /* collapsed section: data model, API shapes, what will not change and why */\n}\n```',
        'Text fields allow `code` and **bold** only. Be brief: the reader should understand the plan in two minutes and verify it in ten.',
        report(''),
      ];
    case 'explainer:stack':
      return [
        `Read each slice diff (\`factory.git.sliceDiff({ runId: "${run.id}", slice: N })\`), the run state (\`factory.run.info({ runId: "${run.id}" })\`), the final feature review (input) and the fix reports (\`factory.run.list({ runId: "${run.id}", prefix: "reports/feature.fix" })\`). Describe what was built, not what was planned.`,
        'Write ONE JSON document to run file `explainers/stack.json`. Do not write HTML: the factory adds check results, review status, the fixes made after review, screenshots and test status itself.',
        'Shape:\n```ts\n{\n  built: string /* plain language, tied to the original request */,\n  risk: { level: 1 | 2 | 3 | 4 | 5, why: string } /* how much careful review this stack needs */,\n  needsYourCall: { title, detail, default }[] /* [] when none */,\n  diagrams: { title, caption?, before?: Mermaid, after: Mermaid }[] /* 1-3 diagrams of how the system changed, as built. Lead with a sequenceDiagram of the main user/request flow; add a flowchart of the parts touched with nodes marked `class X added`, `class Y changed` or `class Z removed` (the factory styles them). Omit before only for something brand new. 12 nodes or fewer each. */,\n  slices: { n, whatChanged /* one sentence, never a diff paraphrase */, whyThisWay /* from architecture.md; say "no rationale documented" if there is none */, verify: string[] /* the 1-4 spots where judgment matters: a migration, an auth check, an edge case, code that replaced something deliberate */, focus: string[] /* "path" or "path:12-40" to open first */, rewrittenLater?: string /* if a later PR rewrites this */ }[] /* every slice */,\n  tests: { id, what, why }[] /* every TC id: what the tests cover and why each matters; never paste test code */,\n  divergences: string[] /* where the build differs from the plan */,\n  followUps: string[]\n}\n```',
        'Text fields allow `code` and **bold** only. Keep each slice short: the concrete "verify" lines are the most valuable part of the page.',
        report(''),
      ];
    default: {
      const outs = contractFor(d.role, d.mode).outputs || [];
      return [
        ...outs.map(o => `Write \`${o}\` to the run with \`await factory.run.write({ runId: "${run.id}", path: "${o}", content })\`.`),
        report(d.role === 'qa-analyst' ? ', testCases: ["TC-001", …]' : ''),
      ];
    }
  }
}

/**
 * @param {{ run: any, dispatch: any, home: string, signatures: Record<string, string> }} p
 */
export function composeBrief({ run, dispatch: d, home, signatures }) {
  const repo = run.repos?.[d.repo] || run.repo;
  const multi = Object.keys(run.repos || {}).length > 1;
  const { text, sources } = resolveRoleText({ role: d.role, home, repo: repo.root });
  const contract = contractFor(d.role, d.mode);
  const slice = d.slice ? run.slices.find((/** @type {any} */ s) => s.n === d.slice) : null;
  const lines = [
    `# Role: ${d.role}${d.mode !== 'default' ? ` — ${d.mode} mode` : ''}`,
    '',
    text,
    '',
    '---',
    '',
    '# Assignment (generated by the factory; it overrides anything above that conflicts)',
    '',
    `- Run: \`${run.id}\` — ${run.title}`,
    `- Dispatch: \`${d.id}\` — ${d.title}`,
    `- Repo: \`${repo.name}\` (main checkout \`${repo.root}\`) on base \`${repo.baseBranch}\` @ ${repo.baseSha.slice(0, 12)}`,
    ...(multi ? [`- This run spans repos: ${Object.values(run.repos).map((/** @type {any} */ r) => `\`${r.name}\`${r.primary ? ' (primary)' : ''} at ${r.root}`).join(', ')}`] : []),
    ...(slice ? [`- Slice ${slice.n}/${run.slices.length}: ${slice.title} — branch \`${slice.branch}\`, based on \`${slice.baseRef}\``] : []),
    `- Goal: ${contract.summary}`,
    `- Call the factory with \`${cliCommand()} exec - <<'JS' ... JS\` from YOUR_CWD (or pass \`--cwd YOUR_CWD\`). Read run files with \`factory.run.read({ runId, path })\`; never write run artifacts into the repo unless your steps say so.`,
    '',
    '## Inputs',
    ...(d.inputs.length ? d.inputs.map((/** @type {any} */ i) => `- \`${i.path}\` — ${i.note}`) : ['- (none beyond this brief)']),
    ...(repo.contract ? ['', `Repo contract (.orchestrate/factory.json): \`${JSON.stringify(repo.contract)}\``] : []),
    '',
    '## Steps',
    ...steps(run, d).map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Report shape',
    '```ts',
    `factory.dispatch.report(${contract.reportShape})`,
    ...(contract.reportShape.includes('Finding') ? [FINDING_SHAPE] : []),
    '```',
    '',
    '## Factory calls for this role',
    ...(contract.capabilities || []).map(c => `- \`${signatures[c] || c}\``),
  ];
  const brief = lines.join('\n');
  return { brief, hash: sha256(brief).slice(0, 16), sources };
}
