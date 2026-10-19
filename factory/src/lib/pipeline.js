// @ts-check
// The SDLC pipeline as a deterministic state machine, split into scopes:
//
//   foreman   one thread per run (where the user typed /orchestrate). Plans the
//             whole feature, owns both human gates, the cross-repo feature review
//             and publishing. It never builds.
//   <repo>    one T3 thread per repo, launched by the foreman in a worktree of that
//             repo. Builds and verifies that repo's slices, applies fixes, writes
//             docs (primary repo), then idles until the foreman asks for more.
//
// Every thread calls next({ runId, repo? }) and carries out only its own scope's
// actions. Threads coordinate through an outbox of short messages the factory
// queues at milestones (build done, fix done, blocked, dependency ready), so the
// foreman's context only grows by a line per milestone.
//
// Foreman:  requirements → context → design(architect ∥ qa) → slicing → plan explainer → GATE plan
//           → launch repo threads → (repos build) → feature review panel ∥ integrated validation
//           → cross-examine → fixes routed to repos ↺ → docs (primary repo) → stack explainer
//           → GATE stack → publish → done
// Repo:     per slice in order: build → verify(review ∥ validate) → fix ↺ → … → checkout → idle

import { resolveTargets } from './policy.js';
import { contractFor, BLOCKING } from './contracts.js';
import { now } from './store.js';
import { cliCommand } from './paths.js';
import { assignBranches, primaryRepo, slicesIn } from './workspace.js';

export const DEFAULT_SETTINGS = {
  maxDispatchAttempts: 3,
  maxSliceFixes: 3,
  maxFeatureFixRounds: 2,
};

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
  const fingerprint = () => JSON.stringify([run.cursor, run.dispatches.length, run.slices.map((/** @type {any} */ s) => [s.phase, s.verifyRound, s.fixes]), run.repoState, run.feature.round, run.docs?.round, run.stackRound, Object.keys(run.blocked || {})]);
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
    case 'requirements': {
      const d = ensure(run, F, 'requirements', { role: 'product-manager', title: 'Write requirements', inputs: [DOC_INPUTS.brief] }, env);
      if (isDone(d)) run.cursor = 'context';
      return;
    }
    case 'context': {
      const d = ensure(run, F, 'context', { role: 'context-curator', title: 'Curate context', inputs: [DOC_INPUTS.brief, DOC_INPUTS.requirements] }, env);
      if (isDone(d)) run.cursor = 'design';
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
    case 'feature-crossexam':
      return stepCrossExam(run, env);
    case 'feature-fix':
    case 'stack-fix':
      if (activeRepos(run).every(n => rstate(run, n).phase === 'idle')) {
        if (run.cursor === 'feature-fix') {
          run.feature.round += 1;
          run.cursor = 'feature-verify';
        } else {
          run.docs.round += 1;
          requestDocs(run, env);
        }
      }
      return;
    case 'docs':
      if (rstate(run, primaryRepo(run).name).phase === 'idle' && run.docs.headSha && run.docs.doneRound === run.docs.round) run.cursor = 'stack-explainer';
      return;
    case 'stack-explainer': {
      const sr = run.stackRound;
      const d = ensure(run, F, `stack-explainer.r${sr}`, { role: 'explainer', mode: 'stack', title: `PR stack explainer (round ${sr})`, inputs: [DOC_INPUTS.brief, DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.slices, { path: `reviews/feature-r${run.feature.round}.json`, note: 'Final feature review: blocking, disputed and minor findings.' }] }, env);
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
  const specInput = { path: s.spec, note: `Spec for slice ${s.n}: ${s.title}` };
  const common = [specInput, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, DOC_INPUTS.context];

  if (s.phase === 'build') {
    const waitingOn = (s.dependsOn || []).map((/** @type {number} */ n) => sliceN(run, n)).filter((/** @type {any} */ d) => d && d.repo !== repo && d.phase !== 'done').map((/** @type {any} */ d) => d.n);
    if (waitingOn.length) {
      st.waitingOn = waitingOn;
      return;
    }
    delete st.waitingOn;
    const d = ensure(run, repo, `slice-${s.n}.build`, { role: 'engineer', mode: 'build', title: `Build slice ${s.n}: ${s.title}`, slice: s.n, inputs: common, extra: { branch: s.branch, baseRef: s.baseRef } }, env);
    if (isDone(d)) {
      s.author = { family: d.family, model: d.target.model };
      s.phase = 'verify';
      s.verifyRound = 1;
    }
    return;
  }

  if (s.phase === 'verify') {
    const v = s.verifyRound;
    const reviewInputs = [specInput, DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.testPlan];
    if (v > 1) reviewInputs.push({ path: `reviews/slice-${s.n}-v${v - 1}.json`, note: 'Findings from the previous round; confirm each is fixed.' });
    const review = ensure(run, repo, `slice-${s.n}.review.v${v}`, { role: 'reviewer', mode: 'slice', title: `Review slice ${s.n} (round ${v})`, slice: s.n, inputs: reviewInputs, avoidFamilies: [s.author.family] }, env);
    const validate = s.ui && sliceApp(run, s)
      ? ensure(run, repo, `slice-${s.n}.validate.v${v}`, { role: 'manual-tester', mode: 'slice', title: `Validate slice ${s.n} in the app (round ${v})`, slice: s.n, inputs: [specInput, DOC_INPUTS.requirements, DOC_INPUTS.testPlan], extra: { branch: s.branch } }, env)
      : null;
    if (!isDone(review) || (validate && !isDone(validate))) return;

    const findings = [
      ...(review.report.findings || []).map((/** @type {any} */ f) => ({ ...f, source: 'review', slice: s.n })),
      ...((validate?.report.findings) || []).map((/** @type {any} */ f) => ({ ...f, source: 'validation', slice: s.n })),
    ];
    const blocking = findings.filter(f => BLOCKING.has(f.severity) && !f.preexisting);
    const minor = findings.filter(f => !blocking.includes(f));
    env.write(`reviews/slice-${s.n}-v${v}.json`, JSON.stringify({ slice: s.n, repo, round: v, headSha: s.headSha, blocking, minor, screenshots: validate?.report.screenshots || [] }, null, 2));
    s.lastVerify = { round: v, blocking: blocking.length, minor: minor.length };
    env.ledger({ event: 'slice.verified', slice: s.n, repo, round: v, blocking: blocking.length, minor: minor.length, author: s.author, reviewer: review.target.model, validator: validate?.target.model });
    if (blocking.length === 0) {
      s.phase = 'done';
      s.completedAt = now();
      // Wake repos whose next slice was waiting on this one.
      for (const [other, ost] of Object.entries(run.repoState || {})) {
        if (other !== repo && /** @type {any} */ (ost).waitingOn?.includes(s.n)) notify(run, repo, other, `Slice ${s.n} (${repo}) is done; your slice can start. Call factory.orchestrator.next({ runId: "${run.id}", repo: "${other}" }).`, env);
      }
      return;
    }
    if (s.fixes >= run.settings.maxSliceFixes + (s.extraFixes || 0)) {
      block(run, repo, { kind: 'slice-fixes', slice: s.n, reason: `Slice ${s.n} still has ${blocking.length} blocking finding(s) after ${s.fixes} fix round(s). See reviews/slice-${s.n}-v${v}.json.` }, env);
      return;
    }
    s.phase = 'fix';
    return;
  }

  if (s.phase === 'fix') {
    const v = s.verifyRound;
    const d = ensure(run, repo, `slice-${s.n}.fix.${s.fixes + 1}`, { role: 'engineer', mode: 'fix', title: `Fix slice ${s.n} (round ${s.fixes + 1})`, slice: s.n, inputs: [specInput, DOC_INPUTS.architecture, { path: `reviews/slice-${s.n}-v${v}.json`, note: 'Blocking findings to fix (minor ones optional).' }], extra: { branch: s.branch, baseRef: s.baseRef } }, env);
    if (isDone(d)) {
      s.fixes += 1;
      s.verifyRound += 1;
      s.phase = 'verify';
    }
  }
}

/** Per-slice validation uses the slice repo's own app. @param {any} run @param {any} s */
export function sliceApp(run, s) {
  if (!run.capabilities?.browserValidation) return null;
  return run.repos[s.repo]?.contract?.app || null;
}

/** Whole-feature validation uses the workspace app, else the primary repo's app. @param {any} run */
export function featureApp(run) {
  if (!run.capabilities?.browserValidation) return null;
  return run.workspace?.app || primaryRepo(run).contract?.app || null;
}

/** @param {any} run @param {Env} env */
function stepFeatureVerify(run, env) {
  const fr = run.feature.round;
  const F = FOREMAN;
  const inputs = [DOC_INPUTS.requirements, DOC_INPUTS.architecture, DOC_INPUTS.testPlan, DOC_INPUTS.slices];
  if (fr > 1) inputs.push({ path: `reviews/feature-r${fr - 1}.json`, note: 'Previous round findings; confirm fixes and look for regressions.' });
  const a = ensure(run, F, `feature.review.r${fr}.a`, { role: 'feature-reviewer', mode: 'review', title: `Feature review A (round ${fr})`, inputs, panelIndex: 0 }, env);
  const b = ensure(run, F, `feature.review.r${fr}.b`, { role: 'feature-reviewer', mode: 'review', title: `Feature review B (round ${fr})`, inputs, panelIndex: 1 }, env);
  const validate = featureApp(run)
    ? ensure(run, F, `feature.validate.r${fr}`, { role: 'manual-tester', mode: 'feature', title: `Validate the whole feature (round ${fr})`, inputs: [DOC_INPUTS.requirements, DOC_INPUTS.testPlan] }, env)
    : null;
  if (isDone(a) && isDone(b) && (!validate || isDone(validate))) run.cursor = 'feature-crossexam';
}

/** @param {any} run @param {Env} env */
function stepCrossExam(run, env) {
  const fr = run.feature.round;
  const F = FOREMAN;
  const a = latest(run, `feature.review.r${fr}.a`);
  const b = latest(run, `feature.review.r${fr}.b`);
  const ca = ensure(run, F, `feature.crossexam.r${fr}.a`, { role: 'feature-reviewer', mode: 'crossexam', title: `Cross-examine B's findings (round ${fr})`, pinTarget: { ...a.target, family: a.family }, inputs: [DOC_INPUTS.requirements, DOC_INPUTS.architecture, { path: `reports/${b.id}.json`, note: "The other reviewer's report. Respond to every finding." }], extra: { otherDispatchId: b.id } }, env);
  const cb = ensure(run, F, `feature.crossexam.r${fr}.b`, { role: 'feature-reviewer', mode: 'crossexam', title: `Cross-examine A's findings (round ${fr})`, pinTarget: { ...b.target, family: b.family }, inputs: [DOC_INPUTS.requirements, DOC_INPUTS.architecture, { path: `reports/${a.id}.json`, note: "The other reviewer's report. Respond to every finding." }], extra: { otherDispatchId: a.id } }, env);
  if (!isDone(ca) || !isDone(cb)) return;

  const validate = latest(run, `feature.validate.r${fr}`);
  const consolidated = consolidate({ a, b, ca, cb, validate });
  env.write(`reviews/feature-r${fr}.json`, JSON.stringify({ round: fr, panel: [a.target.model, b.target.model], ...consolidated }, null, 2));
  run.feature.last = { round: fr, blocking: consolidated.blocking.length, disputed: consolidated.disputed.length, minor: consolidated.minor.length };
  env.ledger({ event: 'feature.consolidated', round: fr, ...run.feature.last });
  for (const [mine, theirs] of [[a, cb], [b, ca]]) {
    const raised = mine.report.findings || [];
    const disputedIds = new Set((theirs.report.responses || []).filter((/** @type {any} */ x) => x.stance === 'dispute').map((/** @type {any} */ x) => x.findingId));
    env.ledger({ event: 'feature.reviewer.score', round: fr, model: mine.target.model, family: mine.family, promptHash: mine.promptHash, raised: raised.length, confirmed: raised.filter((/** @type {any} */ f) => !disputedIds.has(f.id)).length, disputed: disputedIds.size, blockingRaised: raised.filter((/** @type {any} */ f) => BLOCKING.has(f.severity)).length });
  }

  if (consolidated.blocking.length === 0) {
    requestDocs(run, env);
    return;
  }
  if (fr >= run.settings.maxFeatureFixRounds + (run.feature.extraRounds || 0)) {
    block(run, F, { kind: 'feature-rounds', reason: `${consolidated.blocking.length} blocking finding(s) remain after ${fr} feature round(s). See reviews/feature-r${fr}.json.` }, env);
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
 * Merge two adversarial reviews and their cross-examinations.
 * Agreed = the other reviewer confirmed. Disputed = the other reviewer pushed back
 * (surfaced to the human at the PR gate, never auto-fixed). Validation findings are
 * observed behavior and count as agreed. Findings marked preexisting are follow-ups.
 * @param {{ a: any, b: any, ca: any, cb: any, validate?: any }} p
 */
export function consolidate({ a, b, ca, cb, validate }) {
  /** @type {any[]} */
  const agreed = [];
  /** @type {any[]} */
  const disputed = [];
  const tag = (/** @type {any} */ f, /** @type {string} */ by, /** @type {any} */ stance) => ({ ...f, raisedBy: by, crossExam: stance || null });
  const stances = (/** @type {any} */ cx) => Object.fromEntries((cx.report.responses || []).map((/** @type {any} */ r) => [r.findingId, r]));
  const sa = stances(cb);
  const sb = stances(ca);
  for (const f of a.report.findings || []) (sa[f.id]?.stance === 'dispute' ? disputed : agreed).push(tag(f, a.target.model, sa[f.id]));
  for (const f of b.report.findings || []) (sb[f.id]?.stance === 'dispute' ? disputed : agreed).push(tag(f, b.target.model, sb[f.id]));
  for (const f of ca.report.findings || []) agreed.push(tag(f, `${a.target.model} (cross-exam)`, null));
  for (const f of cb.report.findings || []) agreed.push(tag(f, `${b.target.model} (cross-exam)`, null));
  for (const f of validate?.report.findings || []) agreed.push(tag(f, `${validate.target.model} (manual validation)`, null));
  const blocking = agreed.filter(f => BLOCKING.has(f.severity) && !f.preexisting);
  return { blocking, minor: agreed.filter(f => !blocking.includes(f)), disputed, screenshots: validate?.report.screenshots || [] };
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
    return [...out, ...blocked.map((/** @type {any} */ b) => ({ type: 'blocked', scope: b.scope, reason: b.reason, options: ['retry', 'abort'], how: `Show the reason to the user, then factory.orchestrator.decide({ runId, gate: "blocked", scope: "${b.scope}", decision }).` }))];
  }
  if (run.cursor === 'done') return [...out, { type: 'done', how: 'Call factory.orchestrator.summary({ runId }) and show it. Settle this run’s repo threads and your own finished child threads.' }];
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
      if (b.kind === 'slice-fixes') sliceN(run, b.slice).extraFixes = (sliceN(run, b.slice).extraFixes || 0) + 1;
      if (b.kind === 'feature-rounds') {
        run.feature.extraRounds = (run.feature.extraRounds || 0) + 1;
        const last = JSON.parse(env.read(`reviews/feature-r${run.feature.round}.json`));
        routeFixes(run, last.blocking, `feature.fix.r${run.feature.round}`, `Fix feature findings (round ${run.feature.round})`, `reviews/feature-r${run.feature.round}`, env);
        run.cursor = 'feature-fix';
      }
      delete run.blocked[key];
      if (key !== FOREMAN) notify(run, FOREMAN, key, `The user chose to retry. Call factory.orchestrator.next({ runId: "${run.id}", repo: "${key}" }).`, env);
    } else throw new Error('Blocked decisions are "retry" or "abort"');
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
    phase: 'build', fixes: 0, headSha: null,
  }));
  assignBranches(run);
}
