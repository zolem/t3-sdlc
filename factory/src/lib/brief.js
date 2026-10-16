// @ts-check
// Composes the brief a child receives from factory.roles.brief: the role's
// judgment guidance (markdown, overridable per org/user/repo) followed by an
// assignment the factory generates for this exact dispatch — inputs, mechanical
// steps, output contract, and the call shapes it needs.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_ROOT, sha256 } from './store.js';
import { contractFor, SEVERITIES } from './contracts.js';

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
  const report = (/** @type {string} */ extra) => `Report: \`await factory.dispatch.report({ runId: "${run.id}", dispatchId: "${d.id}", summary${extra} })\`. If it returns errors, fix them and report again.`;

  switch (`${d.role}:${d.mode}`) {
    case 'engineer:build':
      return [
        `Your checkout (YOUR_CWD) is a fresh worktree of ${repo.root}. \`git status\` should be clean.`,
        `Create the slice branch: \`git switch -c ${slice.branch} ${d.extra.baseRef}\` (if it already exists from an earlier attempt: \`git switch ${slice.branch}\`). ${setup}`,
        'Implement only this slice. Make small atomic commits, one per logical change, each leaving the build green. End every commit message with a `Slice: ' + slice.n + '` trailer.',
        `Write the tests the spec asks for. Tag each test name with its test-case id (${(slice.testCases || []).join(', ') || 'see the spec'}).${slice.manualCases?.length ? ` These are verified in a browser by the manual tester, so make them work but do not fake tests for them: ${slice.manualCases.join(', ')}.` : ''}`,
        `Run the deterministic gate: \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\`. Fix every failure and re-run until ok is true. Results are tied to the HEAD commit, so re-run after any new commit.`,
        'Release the branch for later steps: `git switch --detach`.',
        report(`, branch: "${slice.branch}", headSha: "<git rev-parse ${slice.branch}>"`),
      ];
    case 'engineer:fix':
      return [
        `In YOUR_CWD (a fresh worktree): \`git switch ${slice.branch}\`. ${setup}`,
        'Read the findings input. Fix every blocking finding (critical/high/medium); fix minor ones when cheap and safe. Do not rewrite history: add new commits with a `Slice: ' + slice.n + '` trailer.',
        'If you believe a finding is wrong, do not silently skip it: explain in `addressed[].how` why no change is needed.',
        `Run \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\` until ok.`,
        'Release the branch: `git switch --detach`.',
        report(`, branch: "${slice.branch}", headSha: "<sha>", addressed: [{ id, how }]`),
      ];
    case 'engineer:feature-fix':
      return [
        `Your repo \`${repo.name}\` has this stack of branches: ${run.slices.filter((/** @type {any} */ s) => s.repo === repo.name).map((/** @type {any} */ s) => `${s.n}) ${s.branch}`).join(', ')}${run.docs?.headSha && run.docs.repo === repo.name ? `, then ${run.docs.branch}` : ''}. Each builds on the previous one.${multi ? ' Findings for other repos are handled by their own threads; fix only what is in your input.' : ''}`,
        'For each finding, fix it in the LOWEST slice it belongs to: `git switch <that branch>`, commit the fix (trailer `Slice: N`), then `git switch --detach`.',
        `After committing to slice N, restack everything above it: \`await factory.git.restack({ runId: "${run.id}", fromSlice: N, cwd: YOUR_CWD })\`. If it reports a conflict, resolve it, \`git add\` + \`git rebase --continue\`, and call restack again with the same fromSlice.`,
        `Run checks on every slice you touched or that was restacked: \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", slice: N, cwd: YOUR_CWD })\` (it checks out that slice head for you; use slice: "docs" for the docs branch). All must pass.`,
        'Leave YOUR_CWD detached (`git switch --detach`).',
        report(', addressed: [{ id, slice, how }]'),
      ];
    case 'manual-tester:slice':
    case 'manual-tester:feature':
      return [
        ...(d.mode === 'slice'
          ? [`In YOUR_CWD (a fresh worktree): \`git switch --detach ${d.extra.branch}\`. ${setup}`, `Start the app: \`const app = await factory.app.up({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\` → { url, logFile }.`]
          : [`Start the whole system: \`const app = await factory.app.up({ runId: "${run.id}", dispatchId: "${d.id}" })\` → { url, logFile }. It serves every repo from its finished stack (each repo thread prepared its checkout); do not edit or switch anything.`]),
        'Drive a real browser with the T3 preview tools (preview_open with open=false and reuseExistingTab=false, then preview_snapshot / preview_click / preview_type / preview_press / preview_wait_for). Keep using the tabId preview_open returns.',
        `Walk ${d.mode === 'slice' ? `every acceptance criterion and test case in this slice spec${slice?.manualCases?.length ? `, and above all the browser-only cases nobody else checks: ${slice.manualCases.join(', ')}` : ''}` : 'every user story and test case end to end'}, including the edge cases a real user would hit (empty, too long, double submit, refresh, back button, slow network if relevant).`,
        `Capture evidence: \`preview_snapshot\` with save=true gives a screenshotPath; copy it into the run with \`await factory.run.attach({ runId: "${run.id}", from: screenshotPath, as: "screenshots/${d.id}/<step>.png" })\`. Take one per meaningful state (before, after, error).`,
        `Stop the app when done: \`await factory.app.down({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\`.`,
        `Write a short human-readable report to run file \`verification/${d.id}.md\` (what you tried, what you saw, screenshots).`,
        report(', findings: Finding[], screenshots: string[] /* run paths */'),
      ];
    case 'reviewer:slice':
      return [
        `Review slice ${slice.n} (${slice.branch}). Get the diff: \`await factory.git.sliceDiff({ runId: "${run.id}", slice: ${slice.n} })\`. You may also read files at that branch with \`git show ${slice.branch}:<path>\` in ${repo.root}. Do NOT check out branches or edit anything.`,
        `Check what the change removes or rewrites and why it was there: \`await factory.history.forDiff({ runId: "${run.id}", slice: ${slice.n} })\`. Flag any change that undoes a deliberate fix or edge case (category "history").`,
        `See the deterministic gate result: \`await factory.checks.results({ runId: "${run.id}", slice: ${slice.n} })\`. Do not repeat what it already proves; focus on what it cannot.`,
        'Severity drives the outcome: any critical/high/medium finding sends the slice back to the engineer. Use low/nit for polish. Be specific: file, line, what breaks, how to fix.',
        report(', findings: Finding[]'),
      ];
    case 'feature-reviewer:review':
      return [
        `Review the whole feature as one change. Slices: ${run.slices.map((/** @type {any} */ s) => `${s.n}) ${s.title}`).join('; ')}.`,
        `Diffs per slice: \`await factory.git.sliceDiff({ runId: "${run.id}", slice: N })\`; whole stack: \`await factory.git.sliceDiff({ runId: "${run.id}", slice: "all" })\`. Read-only: never check out or edit.`,
        `History guard: \`await factory.history.forDiff({ runId: "${run.id}", slice: "all" })\`.`,
        'You are one of two independent reviewers from different model families. Assume the other reviewer is good; your value is what they might miss. Hunt for: requirement gaps, cross-slice integration bugs, unhandled edge cases, data integrity, security, broken history intent, missing tests.',
        'Set `slice` on each finding when you can tell where it belongs.',
        report(', findings: Finding[]'),
      ];
    case 'feature-reviewer:crossexam':
      return [
        "Read the other reviewer's report (input). For EVERY finding, decide confirm or dispute after checking the code yourself, and give a reason. Disputed findings go to the human; confirmed blocking ones get fixed.",
        'Then add any NEW findings you now see that neither report caught (do not repeat your own earlier findings).',
        `Tools: \`factory.git.sliceDiff\`, \`factory.history.forDiff\` (runId "${run.id}").`,
        report(', responses: [{ findingId, stance: "confirm" | "dispute", reason }], findings: Finding[]'),
      ];
    case 'docs-writer:default':
      return [
        `In YOUR_CWD (a fresh worktree): ${d.extra.refresh ? `\`git switch ${run.docs.branch}\` and update the existing doc for the latest changes` : `\`git switch -c ${run.docs.branch} ${d.extra.baseRef}\``}. ${setup}`,
        `Write the versioned feature doc at \`${docsDir}/<feature-slug>.md\`: plain-language summary, what changed and why, Mermaid diagrams of the data/request flow, decisions and trade-offs, how to test, follow-ups. Link the run id.`,
        `Copy useful screenshots from the run (\`factory.run.list({ runId: "${run.id}", prefix: "screenshots/" })\`) into \`${docsDir}/<feature-slug>/\` with \`factory.run.export({ runId, path, to })\` and reference them from the doc. Name each exported file \`slice-N-<step>.png\`, taking N from the screenshot's folder (\`screenshots/slice-N.validate…/\`; use \`feature-<step>.png\` for \`screenshots/feature.validate…/\`) so each PR can show its own screenshots.`,
        `Commit (trailer \`Slice: docs\`), run \`await factory.checks.run({ runId: "${run.id}", dispatchId: "${d.id}", cwd: YOUR_CWD })\` until ok, then \`git switch --detach\`.`,
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
        '```json\n{ "slices": [ { "n": 1, "slug": "notes-table", "title": "…", "layer": "data|api|ui|infra|docs|other", "summary": "what this PR contains", "why": "what it unlocks for the next slice / the user", "dependsOn": [], "ui": false, "testCases": ["TC-001"], "manualCases": [], "spec": "slices/01-notes-table.md" } ] }\n```',
        ...(multi ? [`This run spans several repos (${Object.values(run.repos).map((/** @type {any} */ r) => `\`${r.name}\`${r.primary ? ' (primary)' : ''}`).join(', ')}). Every slice changes exactly one repo: add \`"repo": "<name>"\` to each. Order slices so dependencies land first across repos (e.g. the service endpoint before the UI that calls it); each repo becomes its own PR stack.`] : []),
        'Every TC id in test-plan.md must be assigned to exactly one slice: the one that makes it pass. Put it in `testCases` when the engineer writes an automated test for it (a deterministic check verifies each id appears in that slice\'s tests), or in `manualCases` when only a person in a browser can verify it (the manual tester owns those; only allowed on `ui: true` slices). `ui` is true when the slice changes what a user sees or does in the browser.',
        report(''),
      ];
    case 'explainer:plan':
      return [
        'Write ONE self-contained HTML page to run file `explainers/plan.html` (factory.run.write). It is shown inline in the T3 thread with html_render.',
        'Style: no page background on html/body; use T3 theme CSS variables (var(--foreground), var(--muted-foreground), var(--card), var(--border), var(--accent), var(--radius), var(--font-sans), var(--font-mono), var(--chart-1..6)). Fluid width, no outer border or banner. Mermaid is fine via <script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs"; mermaid.initialize({ startOnLoad: true, theme: "neutral" })</script>.',
        'Structure: (1) the problem and outcome in 3-4 plain sentences anyone can read; (2) a diagram of how it works; (3) the slices as an ordered story — "this table, so this endpoint, so this screen" — one card each with summary, why, and whether a user will see it; (4) decisions, risks and open questions the reviewer should weigh; (5) a collapsed <details> "For engineers" section with data model, API shapes, test coverage map (TC → slice) and anything needed to judge the plan is sound.',
        'Be brief. The reader should understand the plan in two minutes and verify it in ten.',
        report(''),
      ];
    case 'explainer:stack':
      return [
        `Write ONE self-contained HTML page to run file \`explainers/stack.html\`. Same styling rules as the plan explainer (T3 theme variables, no page background, fluid width).`,
        `Read each slice diff with \`factory.git.sliceDiff({ runId: "${run.id}", slice: N })\` and the run state with \`factory.run.info({ runId: "${run.id}" })\` (checks, reviews, screenshots).`,
        'Structure: (1) what was built, in plain language, tied to the original request; (2) one diagram of the final flow; (3) the PR stack in order — for each slice: what it adds, why it comes here ("needed so the next slice can…"), what to look at closely, checks + review status, and screenshots (embed with <img src="ABSOLUTE_PATH">; get absolute paths from factory.run.list results joined to run.info().filesRoot); (4) disputed review findings the human must decide; (5) minor findings left as follow-ups.',
        'Keep each slice card short; link to file paths rather than pasting code. Show at most a few key lines of code where it truly helps.',
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
    '- Pass `cwd: YOUR_CWD` on every factory `execute` call. Read run files with `factory.run.read({ runId, path })`; never write run artifacts into the repo unless your steps say so.',
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
