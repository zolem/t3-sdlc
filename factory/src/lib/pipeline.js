// @ts-check
// The SDLC pipeline as a deterministic state machine, split into scopes:
//
//   foreman   one thread per run (where the user typed /orchestrate). Plans the
//             whole feature, owns both human gates, the cross-repo feature review
//             and publishing. It never builds.
//   <repo>    one T3 thread per repo, launched by the foreman in a worktree of that
//             repo. Every child it starts works in that one worktree, one at a
//             time: it builds the repo's slices, applies fixes, writes docs
//             (primary repo, when enabled), then idles until the foreman asks for more.
//
// Every thread calls next({ runId, repo? }) and carries out only its own scope's
// actions. Threads coordinate through an outbox of short messages the factory
// queues at milestones (build done, fix done, blocked, dependency ready), so the
// foreman's context only grows by a line per milestone.
//
// Foreman:  intake(requirements ∥ context) → design(architect ∥ qa) → slicing → plan explainer → GATE plan
//           → launch repo threads → (repos build) → feature review panel ∥ integrated validation
//           → fixes routed to repos → recheck what changed (↺ up to maxFeatureFixRounds) → docs (opt-in)
//           → stack explainer → GATE stack → publish → done
// Repo:     per slice in order: build (the repo's checks are the gate) → … → checkout → idle
//
// Review happens once, on the whole feature. Engineers must pass the repo's
// deterministic checks (lint, types, tests…) before a slice counts as built.

import { resolveTargets } from './policy.js';
import { contractFor, BLOCKING } from './contracts.js';
import { now } from './store.js';
import { cliCommand } from './paths.js';
import { assignBranches, primaryRepo, slicesIn } from './workspace.js';

export const DEFAULT_SETTINGS = {
  maxDispatchAttempts: 3,
  maxFeatureFixRounds: 1,
  costReport: true,
};

/** The docs slice is opt-in: run settings, else the primary repo's contract (`"docs": { "enabled": true }`). @param {any} run */
export function docsEnabled(run) {
  return run.settings?.docs ?? Boolean(primaryRepo(run).contract?.docs?.enabled);
}

export const FOREMAN = 'foreman';

/**
 * @typedef {object} Env
 * @property {(rel: string) => boolean} exists
 * @property {(rel: string) => string} read
 * @property {(rel: string, content: string) => void} write
 * @property {(entry: object) => void} ledger
 */

/** @param {any} run @param {string} key */
function latest(run, key) {
  for (let i = run.dispatches.length - 1; i >= 0; i--) if (run.dispatches[i].key === key) return run.dispatches[i];
  return undefined;
}

/** @param {any} run @param {string} id */
export function findDispatch(run, id) {
  const d = run.dispatches.find((/** @type {any} */ x) => x.id === id);
  if (!d) throw new Error(`Unknown dispatch "${id}" in run ${run.id}`);
  return d;
}

/** @param {any} run @param {number} n */
const sliceN = (run, n) => run.slices.find((/** @type {any} */ s) => s.n === n);

/**
 * Queue a message for another thread. It is sent by the scope that queued it.
 * @param {any} run @param {string} from @param {string} to @param {string} message @param {Env} env
 */
function notify(run, from, to, message, env) {
  run.outbox ??= [];
  const id = `m${run.outbox.length + 1}`;
  run.outbox.push({ id, from, to, message, sent: false, at: now() });
  env.ledger({ event: 'outbox.queued', id, from, to, message });
}

/**
 * Block a scope. Repo blocks are reported to the foreman, who asks the human.
 * @param {any} run @param {string} scope @param {{ kind: string, key?: string, slice?: number, reason: string }} info @param {Env} env
 */
function block(run, scope, info, env) {
  run.blocked ??= {};
  if (run.blocked[scope]) return;
  run.blocked[scope] = { ...info, scope, at: now() };
  env.ledger({ event: 'blocked', scope, ...info });
  if (scope !== FOREMAN) notify(run, scope, FOREMAN, `${scope}: blocked — ${info.reason} Call factory.orchestrator.next({ runId: "${run.id}" }).`, env);
}

/**
 * @param {string} runId @param {string} id @param {string} role @param {string} mode
 */
export function taskText(runId, id, role, mode) {
  const cli = cliCommand();
  return [
    `You are the \`${role}\` agent (${mode} mode) for t3-sdlc run \`${runId}\`, dispatch \`${id}\`.`,
    'Your full instructions come from the t3-sdlc CLI, not from this message.',
    '1. Run `pwd` and keep the result as YOUR_CWD. Run every t3-sdlc command from there.',
    '2. Get your brief by running exactly:',
    `${cli} exec - <<'JS'`,
    `async () => factory.roles.brief({ runId: "${runId}", dispatchId: "${id}" })`,
    'JS',
    `3. Follow the returned brief exactly. Every \`factory.<module>.<fn>()\` call it shows runs the same way, through \`${cli} exec\`. Finish by calling factory.dispatch.report(...) as the brief describes. If the report is rejected, fix what it lists and report again.`,
    '4. Reply with one line: DONE or BLOCKED, plus a short reason.',
    `If \`${cli}\` is missing or says it needs full access, reply "FACTORY UNAVAILABLE: <its message>" and stop.`,
  ].join('\n');
}

/**
 * Create (or retry) the dispatch for `key` in `scope`. Returns the latest dispatch for the key.
 * @param {any} run @param {string} scope @param {string} key
 * @param {{ role: string, mode?: string, title: string, inputs?: { path: string, note: string }[], slice?: number, avoidFamilies?: string[], panelIndex?: number, pinTarget?: any, extra?: Record<string, unknown> }} spec
 * @param {Env} env
 */
function ensure(run, scope, key, spec, env) {
  const prev = latest(run, key);
  if (prev && prev.status !== 'failed') return prev;

  const attempts = run.dispatches.filter((/** @type {any} */ d) => d.key === key).length;
  const allowance = run.settings.maxDispatchAttempts + (run.allowances?.[key] || 0);
  if (prev && attempts >= allowance) {
    block(run, scope, { kind: 'dispatch', key, reason: `${spec.title} failed ${attempts} time(s). Last error: ${prev.error || 'unknown'}` }, env);
    return prev;
  }

  const mode = spec.mode || 'default';
  const contract = contractFor(spec.role, mode);
  /** @type {any[]} */
  let candidates;
  if (spec.pinTarget) {
    candidates = [spec.pinTarget];
  } else {
    const resolved = resolveTargets({ policy: run.policy, role: spec.role, availability: run.availability, avoidFamilies: spec.avoidFamilies || [] });
    const primary = spec.panelIndex !== undefined ? resolved.targets[spec.panelIndex] : resolved.targets[0];
    const others = [...resolved.targets.filter(t => t !== primary), ...resolved.fallbacks];
    candidates = [primary, ...others.filter(t => spec.panelIndex === undefined || t.family === primary.family)];
  }
  const target = candidates[attempts % candidates.length];
  const id = attempts === 0 ? key : `${key}~${attempts + 1}`;
  const { family, ...t3Target } = target;
  const dispatch = {
    id, key, scope,
    role: spec.role, mode, title: spec.title, slice: spec.slice,
    repo: scope === FOREMAN ? primaryRepo(run).name : scope,
    status: 'pending', attempt: attempts + 1,
    target: t3Target, family,
    isolation: contract.isolation, t3Role: contract.t3Role,
    inputs: spec.inputs || [], extra: spec.extra || {},
    createdAt: now(),
  };
  run.dispatches.push(dispatch);
  env.ledger({ event: 'dispatch.created', dispatchId: id, key, scope, role: spec.role, mode, slice: spec.slice, target: t3Target, family, attempt: dispatch.attempt });
  return dispatch;
}

const isDone = (/** @type {any} */ d) => d && d.status === 'done';

/** @param {any} run */
function planRound(run) {
  return 1 + run.gates.plan.filter((/** @type {any} */ g) => g.status === 'changes').length;
}

/** @param {any} run */
function planInputs(run) {
  return run.gates.plan.filter((/** @type {any} */ g) => g.status === 'changes').map((/** @type {any} */ g) => ({ path: g.feedbackPath, note: `Reviewer feedback from plan review round ${g.round}. Address every point.` }));
}

const DOC_INPUTS = {
  brief: { path: 'brief.md', note: 'Original request (ticket or prompt).' },
  requirements: { path: 'requirements.md', note: 'User stories and acceptance criteria.' },
  context: { path: 'context.md', note: 'Curated codebase and org context.' },
  architecture: { path: 'architecture.md', note: 'Implementation plan.' },
  testPlan: { path: 'test-plan.md', note: 'Test cases (TC-NNN).' },
  slices: { path: 'slices.json', note: 'Ordered slices (each names its repo and spec file).' },
};

/** Repos that get a thread: every repo with slices, plus the primary repo (docs). @param {any} run */
export function activeRepos(run) {
  const names = new Set(run.slices.map((/** @type {any} */ s) => s.repo));
  names.add(primaryRepo(run).name);
  return Object.keys(run.repos).filter(n => names.has(n));
}

/** @param {any} run @param {string} repo */
function rstate(run, repo) {
  run.repoState ??= {};
  return (run.repoState[repo] ??= { phase: 'pending' });
}

/**
 * Advance the whole run as far as possible and return the actions for one scope.
 * @param {any} run @param {Env} env @param {string} [scope]
 */
export function advance(run, env, scope = FOREMAN) {
  const fingerprint = () => JSON.stringify([run.cursor, run.dispatches.length, run.slices.map((/** @type {any} */ s) => s.phase), run.repoState, run.feature.round, run.docs?.round, run.stackRound, Object.keys(run.blocked || {})]);
  for (let guard = 0; guard < 100; guard++) {
    const before = run.cursor;
    const print = fingerprint();
    if (!run.blocked?.[FOREMAN]) stepForeman(run, env);
    for (const repo of Object.keys(run.repoState || {})) if (!run.blocked?.[repo]) stepRepo(run, repo, env);
    if (run.cursor !== before) env.ledger({ event: 'cursor', from: before, to: run.cursor });
    if (fingerprint() === print) break;
  }
  return actions(run, scope);
}

/** @param {any} run @param {Env} env */
function stepForeman(run, env) {
  const r = planRound(run);
  const F = FOREMAN;
  switch (run.cursor) {
    case 'intake': {
      // The curator works from the brief so it can run alongside the product manager.
      const pm = ensure(run, F, 'requirements', { role: 'product-manager', title: 'Write requirements', inputs: [DOC_INPUTS.brief] }, env);
      const cc = ensure(run, F, 'context', { role: 'context-curator', title: 'Curate context', inputs: [DOC_INPUTS.brief] }, env);
      if (isDone(pm) && isDone(cc)) run.cursor = 'design';
      return;
    }
    case 'design': {
      const base = [DOC_INPUTS.requirements, DOC_INPUTS.context, ...planInputs(run)];
      const a = ensure(run, F, `architecture.r${r}`, { role: 'architect', title: `Architecture (round ${r})`, inputs: base }, env);
      const q = ensure(run, F, `test-plan.r${r}`, { role: 'qa-analyst', title: `Test plan (round ${r})`, inputs: base }, env);
      if (isDone(a) && isDone(q)) run.cursor = 'slicing';
      return;
    }
    case 'slicing': {
      const d = ensure(run, F, `slicing.r${r}`, { role: 'slice-planner', title: `Slice plan (round ${r})`, inputs: [DOC_INPUTS.requirements, DOC_INPUTS.context, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, ...planInputs(run)] }, env);
      if (isDone(d)) run.cursor = 'plan-explainer';
      return;
    }
    case 'plan-explainer': {
      const d = ensure(run, F, `plan-explainer.r${r}`, { role: 'explainer', mode: 'plan', title: `Plan explainer (round ${r})`, inputs: [DOC_INPUTS.brief, DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, DOC_INPUTS.slices] }, env);
      if (isDone(d)) {
        run.gates.plan.push({ round: r, status: 'open', htmlPath: 'explainers/plan.html', openedAt: now() });
        run.cursor = 'gate:plan';
      }
      return;
    }
    case 'gate:plan':
    case 'gate:stack':
    case 'publish':
    case 'done':
      return; // waits for decide / publish.stack
    case 'build':
      // Repo threads build; the foreman moves on once every repo is idle (built + checked out).
      if (activeRepos(run).every(n => rstate(run, n).phase === 'idle')) run.cursor = 'feature-verify';
      return;
    case 'feature-verify':
      return stepFeatureVerify(run, env);
    case 'feature-fix':
    case 'stack-fix':
      if (activeRepos(run).every(n => rstate(run, n).phase === 'idle')) {
        if (run.cursor === 'feature-fix') {
          run.feature.round += 1;
          run.cursor = 'feature-verify';
        } else if (docsEnabled(run) && run.docs.headSha) {
          run.docs.round += 1;
          requestDocs(run, env);
        } else run.cursor = 'stack-explainer';
      }
      return;
    case 'docs':
      if (rstate(run, primaryRepo(run).name).phase === 'idle' && run.docs.headSha && run.docs.doneRound === run.docs.round) run.cursor = 'stack-explainer';
      return;
    case 'stack-explainer': {
      const sr = run.stackRound;
      const d = ensure(run, F, `stack-explainer.r${sr}`, { role: 'explainer', mode: 'stack', title: `PR stack explainer (round ${sr})`, inputs: [DOC_INPUTS.brief, DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, DOC_INPUTS.slices, { path: `reviews/feature-r${run.feature.round}.json`, note: 'Final feature review: findings still open (if the user accepted them) and minor follow-ups.' }] }, env);
      if (isDone(d)) {
        run.gates.stack.push({ round: sr, status: 'open', htmlPath: 'explainers/stack.html', openedAt: now() });
        run.cursor = 'gate:stack';
      }
      return;
    }
    default:
      throw new Error(`Unknown cursor "${run.cursor}"`);
  }
}

/** The feature passed (or the user accepted it): docs when enabled, else straight to the stack explainer. @param {any} run @param {Env} env */
function afterFeature(run, env) {
  if (docsEnabled(run)) requestDocs(run, env);
  else run.cursor = 'stack-explainer';
}

/** Ask the primary repo thread for the docs slice. @param {any} run @param {Env} env */
function requestDocs(run, env) {
  const p = primaryRepo(run).name;
  Object.assign(rstate(run, p), { phase: 'docs' });
  notify(run, FOREMAN, p, `Write the feature docs (round ${run.docs.round}). Call factory.orchestrator.next({ runId: "${run.id}", repo: "${p}" }).`, env);
  run.cursor = 'docs';
}

/** @param {any} run @param {string} repo @param {Env} env */
function stepRepo(run, repo, env) {
  const st = rstate(run, repo);
  switch (st.phase) {
    case 'pending':
    case 'idle':
    case 'done':
      return;
    case 'build': {
      const s = slicesIn(run, repo).find((/** @type {any} */ x) => x.phase !== 'done');
      if (!s) {
        Object.assign(st, { phase: 'checkout', after: 'build' });
        return;
      }
      return stepSlice(run, repo, s, env);
    }
    case 'fix': {
      const d = ensure(run, repo, st.fixKey, {
        role: 'engineer', mode: 'feature-fix', title: st.fixTitle,
        inputs: [DOC_INPUTS.architecture, DOC_INPUTS.slices, { path: st.fixInput, note: 'Findings to fix in this repo. Each names a slice when known. Treat every item as blocking.' }],
      }, env);
      if (isDone(d)) Object.assign(st, { phase: 'checkout', after: 'fix' });
      return;
    }
    case 'docs': {
      const dr = run.docs.round;
      const d = ensure(run, repo, `docs.r${dr}`, {
        role: 'docs-writer', title: dr === 1 ? 'Write feature docs' : `Refresh feature docs (round ${dr})`,
        inputs: [DOC_INPUTS.brief, DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.slices],
        extra: { branch: run.docs.branch, baseRef: run.docs.baseRef, refresh: dr > 1 },
      }, env);
      if (isDone(d)) {
        run.docs.doneRound = dr;
        Object.assign(st, { phase: 'checkout', after: 'docs' });
      }
      return;
    }
    case 'checkout':
      return; // waits for workspace.prepare from the repo thread
    default:
      throw new Error(`Unknown phase "${st.phase}" for repo ${repo}`);
  }
}

/** @param {any} run @param {string} repo @param {any} s @param {Env} env */
function stepSlice(run, repo, s, env) {
  const st = rstate(run, repo);
  const waitingOn = (s.dependsOn || []).map((/** @type {number} */ n) => sliceN(run, n)).filter((/** @type {any} */ d) => d && d.repo !== repo && d.phase !== 'done').map((/** @type {any} */ d) => d.n);
  if (waitingOn.length) {
    st.waitingOn = waitingOn;
    return;
  }
  delete st.waitingOn;
  const inputs = [{ path: s.spec, note: `Spec for slice ${s.n}: ${s.title}` }, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, DOC_INPUTS.context];
  const d = ensure(run, repo, `slice-${s.n}.build`, { role: 'engineer', mode: 'build', title: `Build slice ${s.n}: ${s.title}`, slice: s.n, inputs, extra: { branch: s.branch, baseRef: s.baseRef } }, env);
  if (!isDone(d)) return;
  // The report was only accepted with passing checks on the branch head.
  s.author = { family: d.family, model: d.target.model };
  s.phase = 'done';
  s.completedAt = now();
  env.ledger({ event: 'slice.built', slice: s.n, repo, author: s.author, headSha: s.headSha });
  // Wake repos whose next slice was waiting on this one.
  for (const [other, ost] of Object.entries(run.repoState || {})) {
    if (other !== repo && /** @type {any} */ (ost).waitingOn?.includes(s.n)) notify(run, repo, other, `Slice ${s.n} (${repo}) is done; your slice can start. Call factory.orchestrator.next({ runId: "${run.id}", repo: "${other}" }).`, env);
  }
}

/** Whole-feature validation uses the workspace app, else the primary repo's app. @param {any} run */
export function featureApp(run) {
  if (!run.capabilities?.browserValidation) return null;
  return run.workspace?.app || primaryRepo(run).contract?.app || null;
}

const PANEL = ['a', 'b'];

/**
 * Round 1: two reviewers from different families review the whole feature while the
 * manual tester walks it in a browser. Later rounds re-check only what the fixes
 * touched: each reviewer re-checks its own open findings against the new heads, and
 * the browser walk re-runs only when a fix touched a UI slice or validation had failed.
 * @param {any} run @param {Env} env
 */
function stepFeatureVerify(run, env) {
  const fr = run.feature.round;
  const F = FOREMAN;
  /** @type {{ source: string, d: any }[]} */
  const parts = [];
  let carried = /** @type {any[]} */ ([]);
  if (fr === 1) {
    const inputs = [DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, DOC_INPUTS.slices];
    PANEL.forEach((x, i) => parts.push({ source: x, d: ensure(run, F, `feature.review.r1.${x}`, { role: 'feature-reviewer', mode: 'review', title: `Feature review ${x.toUpperCase()}`, inputs, panelIndex: i }, env) }));
    if (featureApp(run)) parts.push({ source: 'validate', d: ensure(run, F, 'feature.validate.r1', { role: 'manual-tester', mode: 'feature', title: 'Validate the whole feature', inputs: [DOC_INPUTS.requirements, DOC_INPUTS.testPlan, DOC_INPUTS.slices] }, env) });
  } else {
    const prev = JSON.parse(env.read(`reviews/feature-r${fr - 1}.json`));
    carried = prev.minor || [];
    const fixes = run.dispatches.filter((/** @type {any} */ d) => d.key.startsWith(`feature.fix.r${fr - 1}.`) && d.status === 'done');
    const responses = fixes.flatMap((/** @type {any} */ d) => d.report.addressed || []);
    for (const x of PANEL) {
      const open = prev.blocking.filter((/** @type {any} */ f) => f.source === x);
      if (!open.length) continue;
      const first = latest(run, `feature.review.r1.${x}`);
      const file = `reviews/feature-r${fr}-recheck-${x}.json`;
      if (!env.exists(file)) env.write(file, JSON.stringify({ findings: open, engineerResponses: responses.filter((/** @type {any} */ r) => open.some((/** @type {any} */ f) => f.id === r.id)), reviewedHeads: prev.heads }, null, 2));
      parts.push({ source: x, d: ensure(run, F, `feature.recheck.r${fr}.${x}`, { role: 'feature-reviewer', mode: 'recheck', title: `Re-check review ${x.toUpperCase()} findings (round ${fr})`, pinTarget: { ...first.target, family: first.family }, inputs: [DOC_INPUTS.requirements, DOC_INPUTS.slices, { path: file, note: 'Your open findings from the last round, what the engineers did about each, and the slice heads you reviewed.' }], extra: { recheckFile: file } }, env) });
    }
    const uiTouched = responses.some((/** @type {any} */ r) => !sliceN(run, Number(r.slice)) || sliceN(run, Number(r.slice)).ui);
    if (featureApp(run) && (uiTouched || prev.blocking.some((/** @type {any} */ f) => f.source === 'validate'))) {
      parts.push({ source: 'validate', d: ensure(run, F, `feature.validate.r${fr}`, { role: 'manual-tester', mode: 'feature', title: `Re-validate the feature (round ${fr})`, inputs: [DOC_INPUTS.requirements, DOC_INPUTS.testPlan, DOC_INPUTS.slices, { path: `reviews/feature-r${fr - 1}.json`, note: 'Last round. Confirm the validation findings are fixed first, then re-walk the main flows the fixes touched.' }] }, env) });
    }
  }
  if (!parts.every(p => isDone(p.d))) return;

  const consolidated = consolidate(parts, carried);
  const heads = Object.fromEntries(run.slices.map((/** @type {any} */ s) => [s.n, s.headSha]));
  env.write(`reviews/feature-r${fr}.json`, JSON.stringify({ round: fr, by: Object.fromEntries(parts.map(p => [p.source, p.d.target.model])), heads, ...consolidated }, null, 2));
  run.feature.last = { round: fr, blocking: consolidated.blocking.length, minor: consolidated.minor.length };
  env.ledger({ event: 'feature.consolidated', round: fr, ...run.feature.last });
  if (fr === 1) {
    for (const p of parts.filter(x => x.source !== 'validate')) {
      const raised = p.d.report.findings || [];
      env.ledger({ event: 'feature.reviewer.score', round: fr, model: p.d.target.model, family: p.d.family, promptHash: p.d.promptHash, raised: raised.length, blockingRaised: raised.filter((/** @type {any} */ f) => BLOCKING.has(f.severity)).length });
    }
  }

  if (consolidated.blocking.length === 0) return afterFeature(run, env);
  if (fr > run.settings.maxFeatureFixRounds + (run.feature.extraRounds || 0)) {
    block(run, F, { kind: 'feature-rounds', reason: `${consolidated.blocking.length} blocking finding(s) remain after ${fr - 1} fix round(s). See reviews/feature-r${fr}.json.` }, env);
    return;
  }
  routeFixes(run, consolidated.blocking, `feature.fix.r${fr}`, `Fix feature findings (round ${fr})`, `reviews/feature-r${fr}`, env);
  run.cursor = 'feature-fix';
}

/**
 * Split findings by the repo of their slice (unknown slice → primary repo) and send each repo its share.
 * @param {any} run @param {any[]} findings @param {string} keyPrefix @param {string} title @param {string} filePrefix @param {Env} env
 */
function routeFixes(run, findings, keyPrefix, title, filePrefix, env) {
  /** @type {Record<string, any[]>} */
  const byRepo = {};
  for (const f of findings) {
    const repo = f.slice && sliceN(run, Number(f.slice)) ? sliceN(run, Number(f.slice)).repo : f.repo && run.repos[f.repo] ? f.repo : primaryRepo(run).name;
    (byRepo[repo] ??= []).push(f);
  }
  for (const [repo, list] of Object.entries(byRepo)) {
    const file = `${filePrefix}-${repo}.json`;
    env.write(file, JSON.stringify({ repo, findings: list }, null, 2));
    Object.assign(rstate(run, repo), { phase: 'fix', fixKey: `${keyPrefix}.${repo}`, fixTitle: `${title} in ${repo}`, fixInput: file });
    notify(run, FOREMAN, repo, `${list.length} finding(s) to fix in ${repo} (${file}). Call factory.orchestrator.next({ runId: "${run.id}", repo: "${repo}" }).`, env);
  }
}

/**
 * Merge the round's reports. Every finding keeps its source (reviewer a/b or
 * validation) so the next round re-checks it with whoever raised it. Minor findings
 * from earlier rounds are carried forward, never re-raised. Findings marked
 * preexisting are follow-ups.
 * @param {{ source: string, d: any }[]} parts @param {any[]} [carried]
 */
export function consolidate(parts, carried = []) {
  const all = parts.flatMap(({ source, d }) => (d.report.findings || []).map((/** @type {any} */ f) => ({ ...f, source, raisedBy: d.target.model })));
  const blocking = all.filter(f => BLOCKING.has(f.severity) && !f.preexisting);
  const validate = parts.find(p => p.source === 'validate');
  return { blocking, minor: [...carried, ...all.filter(f => !blocking.includes(f))], screenshots: validate?.d.report.screenshots || [] };
}

/** @param {any} run @param {string} scope */
function outboxFor(run, scope) {
  return (run.outbox || []).filter((/** @type {any} */ m) => !m.sent && m.from === scope).map((/** @type {any} */ m) => {
    const threadId = m.to === FOREMAN ? run.foreman?.threadId : run.repos[m.to]?.thread?.threadId;
    return threadId ? { type: 'notify', id: m.id, to: m.to, threadId, message: m.message, how: `t3_thread_send({ threadId: "${threadId}", message }), then factory.orchestrator.sent({ runId, id: "${m.id}" }).` } : null;
  }).filter(Boolean);
}

/** @param {any} run @param {any} d */
function dispatchAction(run, d) {
  return {
    type: 'dispatch',
    dispatchId: d.id,
    title: d.title,
    delegate: { title: d.title, task: taskText(run.id, d.id, d.role, d.mode), target: d.target, isolation: d.isolation, role: d.t3Role, mode: 'async', clientRequestId: `${run.id}:${d.id}` },
  };
}

/**
 * What a scope's thread must do now.
 * @param {any} run @param {string} scope
 */
export function actions(run, scope = FOREMAN) {
  const out = /** @type {any[]} */ ([...outboxFor(run, scope)]);
  const pending = run.dispatches.filter((/** @type {any} */ d) => d.status === 'pending' && (d.scope || FOREMAN) === scope).map((/** @type {any} */ d) => dispatchAction(run, d));
  const running = run.dispatches.filter((/** @type {any} */ d) => d.status === 'started' && (d.scope || FOREMAN) === scope);

  if (scope !== FOREMAN) {
    const st = rstate(run, scope);
    if (run.status === 'aborted' || st.phase === 'done') return [...out, { type: 'finished', how: 'Your part of the run is over. Settle any of your child threads that are still unsettled, reply with one line, and stop.' }];
    if (run.blocked?.[scope]) return [...out, { type: 'idle', reason: `blocked: ${run.blocked[scope].reason}`, how: 'The foreman has been told and will ask the user. End your turn; you will be messaged when to continue.' }];
    if (pending.length) return [...out, ...pending];
    if (st.phase === 'checkout' && !running.length) {
      return [...out, { type: 'checkout', how: `Point your own worktree at the finished ${scope} stack for whole-feature checks: factory.workspace.prepare({ runId: "${run.id}", repo: "${scope}", cwd: <your thread's checkout path> }), then call factory.orchestrator.next({ runId, repo: "${scope}" }).` }];
    }
    if (running.length) return [...out, { type: 'wait', running: running.map((/** @type {any} */ d) => ({ dispatchId: d.id, taskId: d.taskId, title: d.title })) }];
    if (st.waitingOn?.length) return [...out, { type: 'idle', reason: `waiting on slice(s) ${st.waitingOn.join(', ')} in another repo`, how: 'End your turn; you will be messaged when the dependency is done.' }];
    return [...out, { type: 'idle', reason: st.phase, how: 'End your turn. The foreman messages you when there is more work.' }];
  }

  const blocked = Object.values(run.blocked || {});
  if (blocked.length) {
    return [...out, ...blocked.map((/** @type {any} */ b) => {
      const options = b.kind === 'feature-rounds' ? ['accept', 'retry', 'abort'] : ['retry', 'abort'];
      const help = b.kind === 'feature-rounds' ? ' accept = continue to the PR stack with these findings shown as open; retry = one more fix round; abort = stop the run.' : '';
      return { type: 'blocked', scope: b.scope, reason: b.reason, options, how: `Show the reason to the user and ask: ${options.join(', ')}.${help} Then factory.orchestrator.decide({ runId, gate: "blocked", scope: "${b.scope}", decision }).` };
    })];
  }
  if (run.cursor === 'done') return [...out, { type: 'done', how: `Call factory.orchestrator.summary({ runId }) and show it.${run.settings.costReport === false ? '' : ' Then show the cost report: factory.run.read({ runId, path: "reports/cost.html" }) and html_render it.'} Settle this run’s repo threads and your own finished child threads.` }];
  if (run.cursor === 'publish') return [...out, { type: 'publish', how: 'The user approved the PR stack. Call factory.publish.stack({ runId }), link every returned PR URL with link_pull_request, then call factory.orchestrator.next({ runId }).' }];
  for (const gate of ['plan', 'stack']) {
    if (run.cursor === `gate:${gate}`) {
      const g = run.gates[gate][run.gates[gate].length - 1];
      return [...out, { type: 'gate', gate, round: g.round, htmlPath: g.htmlPath, how: `Read the HTML with factory.run.read({ runId, path: "${g.htmlPath}" }), show it with html_render, then ask the user to approve or request changes. Record the answer with factory.orchestrator.decide({ runId, gate: "${gate}", decision: "approve" | "changes", notes }).` }];
    }
  }
  const launches = run.cursor !== 'done' ? activeRepos(run).filter(n => rstate(run, n).phase !== 'pending' && !run.repos[n].thread).map(n => ({
    type: 'launch',
    repo: n,
    projectRoot: run.repos[n].root,
    baseBranch: run.repos[n].baseBranch,
    title: `${run.title} · ${n}`,
    message: `You are the repo thread for t3-sdlc run ${run.id}, repo ${n}. Run \`${cliCommand()} skill orchestrate-repo\` and follow it yourself in this thread. Never delegate the coordination to a child.`,
    how: `Find the T3 project whose workspaceRoot is "${run.repos[n].root}" (t3_project_list). t3_thread_launch({ title, projectId, workspaceStrategy: { type: "worktree", baseRef: "${run.repos[n].baseBranch}", startFromOrigin: false }, message }). Then factory.orchestrator.launched({ runId, repo: "${n}", threadId }).`,
  })) : [];
  if (pending.length || launches.length || out.length) return [...out, ...launches, ...pending];
  if (running.length) return [{ type: 'wait', running: running.map((/** @type {any} */ d) => ({ dispatchId: d.id, taskId: d.taskId, title: d.title })) }];
  if (['build', 'feature-fix', 'stack-fix', 'docs'].includes(run.cursor)) {
    return [{ type: 'wait', repos: activeRepos(run).map(n => ({ repo: n, phase: rstate(run, n).phase })), how: 'Repo threads are working. End your turn; they message you at milestones.' }];
  }
  return [{ type: 'stalled', reason: `Nothing to do at cursor "${run.cursor}". Call factory.orchestrator.status({ runId }) and tell the user.` }];
}

/**
 * Apply a human decision (foreman only).
 * @param {any} run @param {{ gate: string, decision: string, notes?: string, scope?: string, repos?: string[] }} d @param {Env} env
 */
export function decide(run, { gate, decision, notes, scope, repos }, env) {
  if (gate === 'blocked') {
    const key = scope || Object.keys(run.blocked || {})[0];
    const b = key && run.blocked?.[key];
    if (!b) throw new Error('Nothing is blocked');
    if (decision === 'abort') {
      run.status = 'aborted';
      run.cursor = 'done';
      run.blocked = {};
      for (const n of activeRepos(run)) {
        rstate(run, n).phase = 'done';
        if (run.repos[n].thread) notify(run, FOREMAN, n, `Run aborted by the user. Call factory.orchestrator.next({ runId: "${run.id}", repo: "${n}" }) and stop.`, env);
      }
    } else if (decision === 'retry') {
      if (b.kind === 'dispatch') run.allowances[b.key] = (run.allowances[b.key] || 0) + 1;
      if (b.kind === 'feature-rounds') {
        run.feature.extraRounds = (run.feature.extraRounds || 0) + 1;
        const last = JSON.parse(env.read(`reviews/feature-r${run.feature.round}.json`));
        routeFixes(run, last.blocking, `feature.fix.r${run.feature.round}`, `Fix feature findings (round ${run.feature.round})`, `reviews/feature-r${run.feature.round}`, env);
        run.cursor = 'feature-fix';
      }
      delete run.blocked[key];
      if (key !== FOREMAN) notify(run, FOREMAN, key, `The user chose to retry. Call factory.orchestrator.next({ runId: "${run.id}", repo: "${key}" }).`, env);
    } else if (decision === 'accept') {
      if (b.kind !== 'feature-rounds') throw new Error(`"accept" only applies to open feature findings; this block (${b.kind}) is "retry" or "abort"`);
      run.feature.accepted = { round: run.feature.round, open: run.feature.last?.blocking ?? null, notes: notes || '' };
      delete run.blocked[key];
      afterFeature(run, env);
    } else throw new Error('Blocked decisions are "retry", "abort", or (for open feature findings) "accept"');
    env.ledger({ event: 'blocked.decided', scope: key, decision, kind: b.kind, notes });
    return;
  }

  if (!['plan', 'stack'].includes(gate)) throw new Error(`Unknown gate "${gate}"`);
  if (run.cursor !== `gate:${gate}`) throw new Error(`Gate "${gate}" is not open (cursor is ${run.cursor})`);
  if (!['approve', 'changes'].includes(decision)) throw new Error('decision must be "approve" or "changes"');
  if (decision === 'changes' && (!notes || !notes.trim())) throw new Error('Requesting changes needs notes describing what to change');
  const g = run.gates[gate][run.gates[gate].length - 1];
  g.status = decision === 'approve' ? 'approved' : 'changes';
  g.decidedAt = now();
  g.notes = notes || '';
  env.ledger({ event: 'gate.decided', gate, round: g.round, decision, notes });
  if (decision === 'changes') {
    g.feedbackPath = `feedback/${gate}-r${g.round}.md`;
    env.write(g.feedbackPath, `# ${gate === 'plan' ? 'Plan' : 'PR stack'} review feedback (round ${g.round})\n\n${notes.trim()}\n`);
  }

  if (gate === 'plan') {
    if (decision === 'changes') {
      run.cursor = 'design';
      return;
    }
    initSlices(run, env);
    for (const n of activeRepos(run)) rstate(run, n).phase = 'build';
    run.cursor = 'build';
    return;
  }

  if (decision === 'approve') {
    run.cursor = 'publish';
    return;
  }
  run.stackRound += 1;
  const targets = repos?.length ? repos : activeRepos(run).filter(n => slicesIn(run, n).length);
  const items = targets.map(repo => ({ id: `U${g.round}`, severity: 'high', title: 'PR review feedback', detail: notes.trim(), repo }));
  routeFixes(run, items, `stack.fix.r${run.stackRound}`, `Apply PR review feedback (round ${run.stackRound})`, `feedback/stack-r${g.round}`, env);
  run.cursor = 'stack-fix';
}

/**
 * A repo thread pointed its worktree at the finished stack: record it, go idle, tell the foreman.
 * @param {any} run @param {string} repo @param {{ path: string, sha: string }} checkout @param {Env} env
 */
export function checkedOut(run, repo, checkout, env) {
  const st = rstate(run, repo);
  if (st.phase !== 'checkout') throw new Error(`${repo} is in phase "${st.phase}", not waiting for a checkout`);
  run.repos[repo].checkout = { ...checkout, at: now() };
  const what = { build: 'build done', fix: 'fixes done', docs: 'docs done' }[/** @type {'build'} */ (st.after)] || 'done';
  Object.assign(st, { phase: 'idle', after: undefined });
  notify(run, repo, FOREMAN, `${repo}: ${what}. Call factory.orchestrator.next({ runId: "${run.id}" }).`, env);
}

/** @param {any} run @param {Env} env */
function initSlices(run, env) {
  const doc = JSON.parse(env.read('slices.json'));
  run.slices = doc.slices.map((/** @type {any} */ s) => ({
    n: s.n, slug: s.slug, title: s.title, layer: s.layer, ui: s.ui, repo: s.repo, dependsOn: s.dependsOn || [],
    testCases: s.testCases || [], manualCases: s.manualCases || [], spec: s.spec,
    phase: 'build', headSha: null,
  }));
  assignBranches(run);
}
