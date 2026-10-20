// @ts-check
// End-to-end runs through the factory with simulated agents and real git: the
// user's thread starts a run thread, which plans, builds the primary repo (other
// repos get their own threads; checks are the gate), reviews the whole feature
// once, routes fixes back, re-checks, then docs (opt-in) and publish. The user's
// thread only sees gates, blocks and the finish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CAPABILITIES, CONTRACT, commit, drive, factory, git, initRepo, simulatedChildren } from './driver.js';

const SKIP = ['browser-validation', 'publish'];

test('single repo: foreman → one repo thread → feature fix routed back → recheck → docs → publish', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-1-'));
  const repo = path.join(tmp, 'notes');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify({ ...CONTRACT, docs: { enabled: true } }), 'src.txt': 'line one\nline two\n' });
  const { call } = factory(tmp, repo);

  const pre = await call('orchestrator.start', { repo, threadId: 'T-foreman', brief: 'Build notes with tags', capabilities: CAPABILITIES });
  assert.equal(pre.actions[0].type, 'preflight');
  assert.deepEqual([...pre.actions[0].needsDecision].sort(), SKIP);

  const started = await call('orchestrator.start', { repo, threadId: 'T-foreman', brief: 'Build notes with tags', capabilities: CAPABILITIES, skip: SKIP });
  const runId = started.runId;
  assert.equal(started.routing['feature-reviewer'], 'claudeAgent/claude-opus-5-5 + codex/gpt-6.1-sol');

  const plan = {
    slices: [
      { n: 1, slug: 'notes-table', title: 'Notes table', layer: 'data', summary: 's', why: 'w', ui: false, testCases: ['TC-001'], spec: 'slices/01.md', files: { 'notes.txt': 'notes\n', 'test/notes.test.txt': 'TC-001\n' } },
      { n: 2, slug: 'tags-ui', title: 'Tags UI', layer: 'ui', summary: 's', why: 'w', ui: true, dependsOn: [1], testCases: ['TC-002'], spec: 'slices/02.md', files: { 'src.txt': 'line one\nline 2 changed\n', 'test/tags.test.txt': 'TC-002\n' } },
    ],
    featureFindings: {
      'feature.review.r1.a': [{ id: 'A1', severity: 'high', title: 'data loss', detail: 'fix', slice: 1 }, { id: 'A2', severity: 'low', title: 'naming', detail: 'x' }],
      'feature.review.r1.b': [{ id: 'B1', severity: 'medium', title: 'missing empty state', detail: 'add one', slice: 2 }],
    },
  };
  let gates = 0;
  const log = await drive({
    call, runId, tmp,
    child: simulatedChildren({ call, runId: () => runId, tmp, plan }),
    gate: async (/** @type {string} */ g, /** @type {number} */ round) => {
      gates++;
      return g === 'plan' && round === 1 ? { decision: 'changes', notes: 'Split tags into their own table' } : { decision: 'approve' };
    },
  });

  assert.deepEqual(log.launches, ['run(notes)'], 'one run thread drives a single-repo run');
  assert.deepEqual([...new Set(log.deskActions)].sort(), ['done', 'gate', 'idle', 'launch-driver', 'notify'], 'the user\'s thread only launches, relays decisions and sees gates and the finish');
  assert.ok(log.dispatches.every((/** @type {any} */ d) => d.thread === 'run'), 'every dispatch is started by the run thread');
  assert.equal(gates, 3, 'plan changes, plan approve, stack approve');
  const byId = Object.fromEntries(log.dispatches.map((/** @type {any} */ d) => [d.id, d]));
  assert.equal(byId['requirements'].scope, 'foreman');
  assert.ok(log.dispatches.findIndex((/** @type {any} */ d) => d.id === 'context') < log.dispatches.findIndex((/** @type {any} */ d) => d.id === 'architecture.r1'), 'curator runs alongside the PM');
  assert.equal(byId['slice-1.build'].scope, 'notes');
  assert.equal(byId['slice-1.build'].isolation, 'shared', 'repo children share the repo thread worktree');
  assert.ok(!log.dispatches.some((/** @type {any} */ d) => /\.review\.v|\.validate\.v|slice-\d+\.fix/.test(d.id)), 'no per-slice review, validation or fix loop');
  assert.ok(byId['feature.fix.r1.notes'], 'feature fix routed to the repo thread');
  assert.ok(byId['feature.recheck.r2.a'] && byId['feature.recheck.r2.b'], 'each reviewer re-checks its own blocking findings');
  assert.equal(byId['feature.recheck.r2.a'].model, byId['feature.review.r1.a'].model, 'the re-check goes to the reviewer who raised it');
  assert.ok(!byId['feature.review.r2.a'], 'no second full review');
  assert.ok(byId['architecture.r2'], 'plan changes re-ran design');
  assert.ok(!byId['requirements.r2'] && log.dispatches.filter((/** @type {any} */ d) => d.id.startsWith('context')).length === 1, 'plan changes do not redo intake');

  // The foreman only hears milestones.
  // The user's thread hears only about decisions; milestones between the run thread's own scopes are never sent.
  const toDesk = log.notifies.filter((/** @type {any} */ n) => n.to === 'desk').map((/** @type {any} */ n) => n.message.split(' Call')[0]);
  assert.deepEqual(toDesk, ['The plan is ready for review (round 1).', 'The plan is ready for review (round 2).', 'The PR stack is ready for review (round 1).', `Run ${runId} is finished.`]);
  assert.ok(!log.notifies.some((/** @type {any} */ n) => n.to === 'foreman' && n.from !== 'desk'), 'the run thread never messages itself');

  const r1 = JSON.parse(await call('run.read', { runId, path: 'reviews/feature-r1.json' }));
  assert.deepEqual(r1.blocking.map((/** @type {any} */ f) => f.id), ['a:A1', 'b:B1'], 'ids are qualified by source so two reviewers can both use R1');
  assert.deepEqual(r1.minor.map((/** @type {any} */ f) => f.id), ['a:A2']);
  const r2 = JSON.parse(await call('run.read', { runId, path: 'reviews/feature-r2.json' }));
  assert.deepEqual(r2.blocking, []);
  assert.deepEqual(r2.minor.map((/** @type {any} */ f) => f.id), ['a:A2'], 'minor findings carry forward without being re-raised');

  assert.equal(log.publish.dryRun, true);
  assert.deepEqual(log.publish.prs.map((/** @type {any} */ p) => p.base), ['main', 'orch/' + runId + '/01-notes-table', 'orch/' + runId + '/02-tags-ui']);
  assert.equal(git(repo, ['symbolic-ref', '--short', 'HEAD']), 'main', 'main checkout untouched');
  assert.equal(git(repo, ['status', '--porcelain']), '');
  const stats = await call('ledger.stats', {});
  assert.ok(stats.reviewers.some((/** @type {any} */ x) => x.model === 'claude-opus-5-5' && x.raised === 2 && x.blockingRaised === 1));
});

test('two repos: per-repo threads, cross-repo dependency, routed fixes, stacks per repo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-2-'));
  const web = path.join(tmp, 'web');
  const api = path.join(tmp, 'api');
  initRepo(api, { '.orchestrate/factory.json': JSON.stringify(CONTRACT) });
  initRepo(web, { '.orchestrate/factory.json': JSON.stringify(CONTRACT), '.orchestrate/workspace.json': JSON.stringify({ name: 'shop', repos: { web: { path: '.' }, api: { path: '../api' } } }) });
  const { call } = factory(tmp, web);

  const doc = await call('repo.doctor', { repo: web });
  assert.deepEqual(doc.workspace.repos.map((/** @type {any} */ r) => r.name), ['web', 'api']);

  const { runId } = await call('orchestrator.start', { repo: web, threadId: 'T-foreman', brief: 'Show stock levels', capabilities: CAPABILITIES, skip: SKIP });
  const plan = {
    slices: [
      { n: 1, repo: 'api', slug: 'stock-endpoint', title: 'Stock endpoint', layer: 'api', summary: 's', why: 'w', ui: false, testCases: ['TC-001'], spec: 'slices/01.md', files: { 'stock.js': 'x\n', 'test/stock.test.js': 'TC-001\n' } },
      { n: 2, repo: 'web', slug: 'stock-badge', title: 'Stock badge', layer: 'ui', summary: 's', why: 'w', ui: true, dependsOn: [1], testCases: ['TC-002'], spec: 'slices/02.md', files: { 'badge.js': 'x\n', 'test/badge.test.js': 'TC-002\n' } },
    ],
    featureFindings: { 'feature.review.r1.b': [{ id: 'B1', severity: 'high', title: 'endpoint missing auth', detail: 'add it', slice: 1 }] },
  };
  const log = await drive({ call, runId, tmp, child: simulatedChildren({ call, runId: () => runId, tmp, plan }), gate: async () => ({ decision: 'approve' }) });

  assert.deepEqual(log.launches, ['run(web)', 'api'], 'the run thread drives the primary repo; other repos get their own thread');
  const byId = Object.fromEntries(log.dispatches.map((/** @type {any} */ d) => [d.id, d]));
  assert.equal(byId['slice-1.build'].scope, 'api');
  assert.equal(byId['slice-2.build'].scope, 'web');
  assert.ok(log.dispatches.findIndex((/** @type {any} */ d) => d.id === 'slice-2.build') > log.dispatches.findIndex((/** @type {any} */ d) => d.id === 'slice-1.build'), 'web waited for the api slice it depends on');
  assert.ok(log.notifies.some((/** @type {any} */ n) => n.from === 'api' && n.to === 'web'), 'api woke web when its dependency finished');
  assert.ok(byId['feature.fix.r1.api'] && !byId['feature.fix.r1.web'], 'the api finding went only to the api thread');
  assert.ok(byId['feature.recheck.r2.b'] && !byId['feature.recheck.r2.a'], 'only the reviewer with blocking findings re-checks');
  assert.ok(!log.dispatches.some((/** @type {any} */ d) => d.id.startsWith('docs.')), 'docs are off unless the repo enables them');

  const all = await call('git.sliceDiff', { runId, slice: 'all' });
  assert.deepEqual(all.map((/** @type {any} */ d) => d.repo).sort(), ['api', 'web']);
  /** @type {Record<string, any[]>} */
  const prs = {};
  for (const p of log.publish.prs) (prs[p.repo] ??= []).push(p);
  assert.deepEqual(prs.api.map(p => p.base), ['main']);
  assert.deepEqual(prs.web.map(p => p.base), ['main'], 'no docs PR on top when docs are off');
  for (const r of [web, api]) assert.equal(git(r, ['symbolic-ref', '--short', 'HEAD']), 'main');
});

test('blocking findings left after the fix round: the user can accept and continue to the PR stack', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-accept-'));
  const repo = path.join(tmp, 'r');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify(CONTRACT) });
  const { call } = factory(tmp, repo);
  const { runId } = await call('orchestrator.start', { repo, threadId: 'T', brief: 'Pin notes', capabilities: CAPABILITIES, skip: SKIP });
  const plan = {
    slices: [{ n: 1, slug: 'pins', title: 'Pins', layer: 'data', summary: 's', why: 'w', ui: false, testCases: ['TC-001'], spec: 'slices/01.md', files: { 'pins.txt': 'x\n', 'test/pins.test.txt': 'TC-001\n' } }],
    featureFindings: { 'feature.review.r1.a': [{ id: 'A1', severity: 'medium', title: 'plan conflict', detail: 'needs a plan change', slice: 1 }] },
    stillOpen: ['a:A1'],
  };
  /** @type {any[]} */
  const blocks = [];
  const log = await drive({
    call, runId, tmp,
    child: simulatedChildren({ call, runId: () => runId, tmp, plan }),
    gate: async () => ({ decision: 'approve' }),
    blocked: async (/** @type {any} */ a) => {
      blocks.push(a);
      return 'accept';
    },
  });
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].options, ['accept', 'retry', 'abort']);
  const ids = log.dispatches.map((/** @type {any} */ d) => d.id);
  assert.ok(ids.includes('feature.recheck.r2.a') && !ids.includes('feature.fix.r2.r'), 'one fix round, one re-check, then the user decides');
  assert.ok(ids.includes('stack-explainer.r1'));
  const info = await call('run.info', { runId });
  assert.equal(info.feature.accepted.open, 1);
  assert.match(await call('orchestrator.summary', { runId }), /accepted 1 open finding/);
});

test('a child that ends without a report is retried on the fallback model, then blocks', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-3-'));
  const repo = path.join(tmp, 'r');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify(CONTRACT) });
  const { call } = factory(tmp, repo);
  const { runId, actions } = await call('orchestrator.start', { repo, threadId: 'T', brief: 'Retry me', capabilities: CAPABILITIES, skip: SKIP });
  assert.equal(actions[0].type, 'launch-driver');
  assert.deepEqual(actions[0].modelSelection, { instanceId: 'claudeAgent', model: 'claude-haiku-5-5', options: { effort: 'low' } }, 'the run thread uses the coordinator model');
  const first = await call('orchestrator.launched', { runId, repo: 'r', threadId: 'T-run', driver: true });
  assert.equal(first.actions[0].type, 'idle', 'the user\'s thread is done until something needs a person');
  const go = await call('orchestrator.next', { runId });
  assert.equal(go.actions.find((/** @type {any} */ a) => a.dispatchId === 'requirements').delegate.target.model, 'claude-sonnet-5-5');
  await call('orchestrator.started', { runId, dispatchId: 'requirements', taskId: 'x1' });
  const retryOf = (/** @type {any} */ res) => res.actions.find((/** @type {any} */ a) => a.dispatchId?.startsWith('requirements'));
  let r = await call('orchestrator.finished', { runId, dispatchId: 'requirements', status: 'completed', summary: 'oops' });
  assert.equal(retryOf(r).dispatchId, 'requirements~2');
  assert.equal(retryOf(r).delegate.target.model, 'gpt-6.1-sol');
  for (const id of ['requirements~2', 'requirements~3']) {
    await call('orchestrator.started', { runId, dispatchId: id, taskId: id });
    r = await call('orchestrator.finished', { runId, dispatchId: id, status: 'failed', summary: 'provider error' });
  }
  assert.ok(r.actions.some((/** @type {any} */ a) => a.type === 'notify' && a.to === 'desk'), 'the run thread tells the user\'s thread');
  const desk = await call('orchestrator.next', { runId, scope: 'desk' });
  const b = desk.actions.find((/** @type {any} */ a) => a.type === 'blocked');
  assert.deepEqual(b.options, ['retry', 'abort'], 'accept is only offered for open feature findings');
  r = await call('orchestrator.decide', { runId, gate: 'blocked', scope: 'foreman', decision: 'retry' });
  assert.ok(r.actions.some((/** @type {any} */ a) => a.type === 'notify' && a.threadId === 'T-run'), 'the decision wakes the run thread');
  assert.equal(retryOf(await call('orchestrator.next', { runId })).dispatchId, 'requirements~4');
});

test('start: preflight blocks a dirty repo; an unroutable policy throws; threadId is required', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-4-'));
  const repo = path.join(tmp, 'r');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify(CONTRACT) });
  const { call } = factory(tmp, repo);
  await assert.rejects(call('orchestrator.start', { repo, brief: 'x', capabilities: CAPABILITIES, skip: SKIP }), /threadId/);
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
  const dirty = await call('orchestrator.start', { repo, threadId: 'T', brief: 'x', capabilities: CAPABILITIES, skip: SKIP });
  assert.equal(dirty.actions[0].blocking, true);
  assert.match(dirty.preflight.report, /uncommitted changes: dirty\.txt/);
  fs.rmSync(path.join(repo, 'dirty.txt'));
  await assert.rejects(call('orchestrator.start', { repo, threadId: 'T', brief: 'x', capabilities: { providers: [CAPABILITIES.providers[0]] }, skip: SKIP }), /feature-reviewer/);
  void commit;
});

test('start: asks which policy targets are available, then routes from that short list with options intact', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-5-'));
  const repo = path.join(tmp, 'r');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify(CONTRACT) });
  const { call } = factory(tmp, repo);
  const ask = await call('orchestrator.start', { repo, threadId: 'T', brief: 'x', skip: SKIP });
  assert.equal(ask.actions[0].type, 'availability');
  assert.ok(ask.actions[0].targets.includes('codex/gpt-6.1-sol'));
  const available = ask.actions[0].targets.filter((/** @type {string} */ t) => t !== 'claudeAgent/claude-sonnet-5-5');
  const run = await call('orchestrator.start', { repo, threadId: 'T', brief: 'x', skip: SKIP, available });
  assert.deepEqual(run.unavailable, ['claudeAgent/claude-sonnet-5-5']);
  assert.equal(run.routing['product-manager'], 'codex/gpt-6.1-sol', 'falls back past the unavailable target');
  await call('orchestrator.launched', { runId: run.runId, repo: 'r', threadId: 'T-run', driver: true });
  const go = await call('orchestrator.next', { runId: run.runId });
  assert.deepEqual(go.actions.find((/** @type {any} */ a) => a.dispatchId === 'requirements').delegate.target.options, { reasoningEffort: 'high' }, 'policy options pass through');
});
