// @ts-check
// End-to-end runs through the factory with simulated agents and real git:
// the foreman plans, launches one thread per repo, repo threads build and verify,
// the foreman reviews across repos, routes fixes back, then docs, gate, publish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CAPABILITIES, CONTRACT, commit, drive, factory, git, initRepo, simulatedChildren } from './driver.js';

const SKIP = ['browser-validation', 'publish'];

test('single repo: foreman → one repo thread → feature fix routed back → docs → publish', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-1-'));
  const repo = path.join(tmp, 'notes');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify(CONTRACT), 'src.txt': 'line one\nline two\n' });
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
    sliceFindings: { 'slice-2.review.v1': [{ id: 'M1', severity: 'medium', title: 'missing empty state', detail: 'add one' }] },
    featureFindings: { 'feature.review.r1.a': [{ id: 'A1', severity: 'high', title: 'data loss', detail: 'fix', slice: 1 }, { id: 'A2', severity: 'medium', title: 'dubious', detail: 'x' }] },
    disputes: ['A2'],
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

  assert.deepEqual(log.launches, ['notes'], 'every repo gets a thread, even a single one');
  assert.equal(gates, 3, 'plan changes, plan approve, stack approve');
  const byId = Object.fromEntries(log.dispatches.map((/** @type {any} */ d) => [d.id, d]));
  assert.equal(byId['requirements'].scope, 'foreman');
  assert.equal(byId['slice-1.build'].scope, 'notes');
  assert.equal(byId['slice-1.build'].isolation, 'worktree');
  assert.equal(byId['slice-1.review.v1'].model, 'gpt-6.1-sol', 'reviewer avoids the engineer family');
  assert.ok(byId['slice-2.fix.1'], 'slice fix loop ran');
  assert.ok(byId['feature.fix.r1.notes'], 'feature fix routed to the repo thread');
  assert.ok(byId['architecture.r2'], 'plan changes re-ran design');

  // The foreman only hears milestones.
  const toForeman = log.notifies.filter((/** @type {any} */ n) => n.to === 'foreman').map((/** @type {any} */ n) => n.message);
  assert.deepEqual(toForeman.map((/** @type {string} */ m) => m.split('.')[0]), ['notes: build done', 'notes: fixes done', 'notes: docs done']);

  const consolidated = JSON.parse(await call('run.read', { runId, path: 'reviews/feature-r1.json' }));
  assert.deepEqual(consolidated.blocking.map((/** @type {any} */ f) => f.id), ['A1']);
  assert.deepEqual(consolidated.disputed.map((/** @type {any} */ f) => f.id), ['A2']);

  assert.equal(log.publish.dryRun, true);
  assert.deepEqual(log.publish.prs.map((/** @type {any} */ p) => p.base), ['main', 'orch/' + runId + '/01-notes-table', 'orch/' + runId + '/02-tags-ui']);
  assert.equal(git(repo, ['symbolic-ref', '--short', 'HEAD']), 'main', 'main checkout untouched');
  assert.equal(git(repo, ['status', '--porcelain']), '');
  const stats = await call('ledger.stats', {});
  assert.ok(stats.reviewers.some((/** @type {any} */ x) => x.model === 'claude-opus-5-5' && x.raised === 2 && x.confirmed === 1));
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

  assert.deepEqual([...log.launches].sort(), ['api', 'web']);
  const byId = Object.fromEntries(log.dispatches.map((/** @type {any} */ d) => [d.id, d]));
  assert.equal(byId['slice-1.build'].scope, 'api');
  assert.equal(byId['slice-2.build'].scope, 'web');
  assert.ok(log.dispatches.findIndex((/** @type {any} */ d) => d.id === 'slice-2.build') > log.dispatches.findIndex((/** @type {any} */ d) => d.id === 'slice-1.review.v1'), 'web waited for the api slice it depends on');
  assert.ok(log.notifies.some((/** @type {any} */ n) => n.from === 'api' && n.to === 'web'), 'api woke web when its dependency finished');
  assert.ok(byId['feature.fix.r1.api'] && !byId['feature.fix.r1.web'], 'the api finding went only to the api thread');
  assert.equal(byId['docs.r1'].scope, 'web', 'docs live in the primary repo');

  const all = await call('git.sliceDiff', { runId, slice: 'all' });
  assert.deepEqual(all.map((/** @type {any} */ d) => d.repo).sort(), ['api', 'web']);
  /** @type {Record<string, any[]>} */
  const prs = {};
  for (const p of log.publish.prs) (prs[p.repo] ??= []).push(p);
  assert.deepEqual(prs.api.map(p => p.base), ['main']);
  assert.deepEqual(prs.web.map(p => p.base), ['main', `orch/${runId}/02-stock-badge`]);
  for (const r of [web, api]) assert.equal(git(r, ['symbolic-ref', '--short', 'HEAD']), 'main');
});

test('a child that ends without a report is retried on the fallback model, then blocks', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-3-'));
  const repo = path.join(tmp, 'r');
  initRepo(repo, { '.orchestrate/factory.json': JSON.stringify(CONTRACT) });
  const { call } = factory(tmp, repo);
  const { runId, actions } = await call('orchestrator.start', { repo, threadId: 'T', brief: 'Retry me', capabilities: CAPABILITIES, skip: SKIP });
  assert.equal(actions[0].delegate.target.model, 'claude-sonnet-5-5');
  await call('orchestrator.started', { runId, dispatchId: 'requirements', taskId: 'x1' });
  let r = await call('orchestrator.finished', { runId, dispatchId: 'requirements', status: 'completed', summary: 'oops' });
  assert.equal(r.actions[0].dispatchId, 'requirements~2');
  assert.equal(r.actions[0].delegate.target.model, 'gpt-6.1-sol');
  for (const id of ['requirements~2', 'requirements~3']) {
    await call('orchestrator.started', { runId, dispatchId: id, taskId: id });
    r = await call('orchestrator.finished', { runId, dispatchId: id, status: 'failed', summary: 'provider error' });
  }
  assert.equal(r.actions[0].type, 'blocked');
  r = await call('orchestrator.decide', { runId, gate: 'blocked', scope: 'foreman', decision: 'retry' });
  assert.equal(r.actions[0].dispatchId, 'requirements~4');
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
  assert.deepEqual(run.actions[0].delegate.target.options, { reasoningEffort: 'high' }, 'policy options pass through');
});
