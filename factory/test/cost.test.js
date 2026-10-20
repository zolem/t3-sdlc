// @ts-check
// Cost report: thread → session mapping, provider log parsing, tiered pricing,
// estimates for gaps, and graceful degradation when sources are missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildCostReport, priceRequest, renderCostHtml, phaseOf } from '../src/lib/costReport.js';
import { createRunDir } from '../src/lib/runs.js';
import { writeCostReport } from '../src/modules/report.js';

const RATES = {
  'claude-haiku-5-5': { input: 0.1, cachedInput: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2, output: 0.5, longContext: { above: 100000, input: 0.5, cachedInput: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1.0, output: 2.5 } },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5, priority: { input: 0.2, cachedInput: 0.02, output: 1.0 } },
  'baseten/zai-org/GLM-5.3-Flash': { input: 0.15, cachedInput: 0.03, output: 0.5 },
  default: { reported: true },
};

const jl = (/** @type {any[]} */ rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

function fixtures() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
  const claudeDir = path.join(tmp, 'claude', 'projects', '-repo');
  const codexDir = path.join(tmp, 'codex', 'sessions', '2026', '10', '19');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(codexDir, { recursive: true });
  const usage = (/** @type {any} */ u) => ({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, ...u });
  const asst = (/** @type {string} */ id, /** @type {string} */ ts, /** @type {any} */ u, model = 'claude-haiku-5-5') => ({ type: 'assistant', requestId: `req_${id}`, timestamp: ts, message: { id: `msg_${id}`, model, usage: usage(u) } });
  // Request 1 streams twice (dedupe, keep larger output); request 2 is above 100k prompt tokens (long tier).
  fs.writeFileSync(path.join(claudeDir, 'sess-pm.jsonl'), jl([
    { type: 'user', timestamp: '2026-10-19T10:00:00Z' },
    asst('1', '2026-10-19T10:00:01Z', { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 }, output_tokens: 50 }),
    asst('1', '2026-10-19T10:00:02Z', { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 }, output_tokens: 100 }),
    asst('2', '2026-10-19T10:00:10Z', { input_tokens: 0, cache_read_input_tokens: 150000, output_tokens: 1000 }),
    asst('3', '2026-10-19T10:00:11Z', { output_tokens: 5 }, '<synthetic>'),
  ]));
  // Foreman: one request inside the run window, one long after it (excluded).
  fs.writeFileSync(path.join(claudeDir, 'sess-foreman.jsonl'), jl([
    asst('f1', '2026-10-19T10:00:30Z', { input_tokens: 100, output_tokens: 100 }),
    asst('f2', '2026-10-20T10:00:00Z', { input_tokens: 1e6, output_tokens: 1e6 }),
  ]));
  const tc = (/** @type {string} */ ts, /** @type {any} */ last, /** @type {any} */ total) => ({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: total } } });
  const l1 = { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 200, reasoning_output_tokens: 50 };
  fs.writeFileSync(path.join(codexDir, 'rollout-2026-10-19T10-01-00-sess-ctx.jsonl'), jl([
    { timestamp: '2026-10-19T10:01:00Z', type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    tc('2026-10-19T10:01:01Z', l1, l1),
    tc('2026-10-19T10:01:02Z', l1, l1), // repeated event: same running total
    tc('2026-10-19T10:01:03Z', { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }, { input_tokens: 6000 }),
  ]));
  const cursorCache = path.join(tmp, 'cursor.json');
  fs.writeFileSync(cursorCache, JSON.stringify({ version: 1, strings: ['default', 'agent-explain'], accounts: { k: { fetchedAtMs: Date.parse('2026-10-19T11:00:00Z'), records: [[Date.parse('2026-10-19T10:05:00Z'), 0, 1, 1000, 50000, 0, 3000, 0.75, 'id1']] } } }));

  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const t3Db = path.join(tmp, 'state.sqlite');
  const db = new DatabaseSync(t3Db);
  db.exec('create table orchestration_v2_projection_provider_threads (provider_thread_id text primary key, thread_id text, provider text not null, provider_instance_id text, payload_json text not null)');
  const ins = db.prepare('insert into orchestration_v2_projection_provider_threads values (?, ?, ?, ?, ?)');
  for (const [thread, provider, native] of [['T-pm', 'claudeAgent', 'sess-pm'], ['T-ctx', 'codex', 'sess-ctx'], ['T-explain', 'cursor', 'agent-explain'], ['T-foreman', 'claudeAgent', 'sess-foreman'], ['T-qa', 'opencode', 'ses_qa'], ['T-pm2', 'claudeAgent', 'sess-missing']]) {
    ins.run(`pt-${thread}`, thread, provider, provider, JSON.stringify({ nativeThreadRef: { nativeId: native } }));
  }
  db.close();
  const opencodeDb = path.join(tmp, 'opencode.db');
  const odb = new DatabaseSync(opencodeDb);
  odb.exec('create table session_v2 (id text primary key, parent_id text, model text, cost real, tokens_input integer, tokens_output integer, tokens_reasoning integer, tokens_cache_read integer, tokens_cache_write integer, time_updated integer)');
  odb.prepare('insert into session_v2 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('ses_qa', null, JSON.stringify({ id: 'zai-org/GLM-5.3-Flash', providerID: 'baseten' }), 0.0019915, 11000, 448, 235, 0, 0, Date.parse('2026-10-19T10:02:00Z'));
  odb.close();

  const paths = { t3Db, claudeProjects: path.join(tmp, 'claude', 'projects'), codexSessions: path.join(tmp, 'codex', 'sessions'), cursorCache, opencodeDb };
  const d = (/** @type {string} */ id, /** @type {string} */ role, /** @type {string} */ provider, /** @type {string} */ model, /** @type {string} */ start, /** @type {string} */ end, /** @type {string} */ thread, extra = {}) => ({ id, key: id, role, mode: 'default', scope: 'foreman', target: { providerInstanceId: provider, model, options: {} }, status: 'done', startedAt: start, finishedAt: end, childThreadId: thread, ...extra });
  const run = {
    id: 'cost-run-1', title: 'Cost test', status: 'done', cursor: 'done', createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:10:00Z',
    repo: { root: tmp }, repos: { r: { name: 'r', root: tmp, primary: true } }, foreman: { threadId: 'T-foreman' },
    gates: { plan: [{ round: 1, status: 'approved', openedAt: '2026-10-19T10:06:00Z', decidedAt: '2026-10-19T10:08:00Z' }], stack: [] },
    settings: {},
    dispatches: [
      d('requirements', 'product-manager', 'claudeAgent', 'claude-haiku-5-5', '2026-10-19T10:00:00Z', '2026-10-19T10:01:00Z', 'T-pm'),
      d('context', 'context-curator', 'codex', 'gpt-6-luna', '2026-10-19T10:01:00Z', '2026-10-19T10:02:00Z', 'T-ctx', { target: { providerInstanceId: 'codex', model: 'gpt-6-luna', options: { serviceTier: 'priority' } } }),
      d('test-plan.r1', 'qa-analyst', 'opencode', 'baseten/zai-org/GLM-5.3-Flash', '2026-10-19T10:01:00Z', '2026-10-19T10:02:30Z', 'T-qa'),
      d('plan-explainer.r1', 'explainer', 'cursor', 'default', '2026-10-19T10:03:00Z', '2026-10-19T10:06:00Z', 'T-explain', { mode: 'plan' }),
      d('requirements~2', 'product-manager', 'claudeAgent', 'claude-haiku-5-5', '2026-10-19T10:08:00Z', '2026-10-19T10:09:00Z', 'T-pm2'),
      d('slice-1.build', 'engineer', 'claudeAgent', 'claude-haiku-5-5', '2026-10-19T10:09:00Z', '2026-10-19T10:10:00Z', undefined, { mode: 'build' }),
    ],
  };
  return { tmp, paths, run };
}

test('priceRequest: base, long-context and priority tiers; reported cost passes through', () => {
  const r = { ts: '', model: 'claude-haiku-5-5', input: 10, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 2000, output: 100, reasoning: 0 };
  assert.equal(priceRequest(r, RATES['claude-haiku-5-5'])?.usd.toFixed(8), ((10 * 0.1 + 1000 * 0.01 + 2000 * 0.2 + 100 * 0.5) / 1e6).toFixed(8));
  const long = priceRequest({ ...r, input: 0, cacheRead: 150000, cacheWrite1h: 0, output: 1000 }, RATES['claude-haiku-5-5']);
  assert.equal(long?.tier, 'long');
  assert.equal(long?.usd.toFixed(6), ((150000 * 0.05 + 1000 * 2.5) / 1e6).toFixed(6));
  assert.equal(priceRequest({ ...r, model: 'gpt-6-luna', cacheWrite1h: 0 }, RATES['gpt-6-luna'], { priority: true })?.tier, 'priority');
  assert.deepEqual(priceRequest({ ...r, reportedUsd: 0.75 }, RATES.default), { usd: 0.75, basis: 'reported', tier: 'base' });
  assert.equal(priceRequest(r, undefined), null);
  assert.equal(phaseOf({ key: 'feature.recheck.r2.a' }), 'feature');
  assert.equal(phaseOf({ key: 'stack-explainer.r1' }), 'stack');
  assert.equal(phaseOf({ key: 'slice-3.build' }), 'build');
});

test('buildCostReport: parses every provider, prices at list rates, estimates gaps', () => {
  const { paths, run, tmp } = fixtures();
  const rep = buildCostReport(run, { home: path.join(tmp, 'home'), paths, rates: RATES });
  const by = Object.fromEntries(rep.dispatches.map(d => [d.id, d]));

  // Claude: streaming duplicate collapsed (2 requests), synthetic dropped, 1h cache write priced, second request long tier.
  assert.equal(by.requirements.requests, 2);
  assert.deepEqual(by.requirements.tokens, { input: 10, cached: 151000, cacheWrite: 2000, output: 1100, total: 154110 });
  const want = (10 * 0.1 + 1000 * 0.01 + 2000 * 0.2 + 100 * 0.5 + 150000 * 0.05 + 1000 * 2.5) / 1e6;
  assert.equal(by.requirements.usd, Math.round(want * 1e4) / 1e4);
  assert.ok(by.requirements.tiers.includes('long'));

  // Codex: repeated token_count dropped; uncached = input - cached; priority tier from target options.
  assert.equal(by.context.requests, 2);
  assert.deepEqual(by.context.tokens, { input: 2000, cached: 4000, cacheWrite: 0, output: 300, total: 6300 });
  assert.ok(by.context.tiers.includes('priority'));

  // OpenCode: reasoning billed separately; our rate reproduces OpenCode's own cost.
  assert.equal(by['test-plan.r1'].usd, Math.round(0.0019915 * 1e4) / 1e4);
  assert.equal(by['test-plan.r1'].tokens.output, 448 + 235);

  // Cursor: reported cost.
  assert.equal(by['plan-explainer.r1'].usd, 0.75);
  assert.deepEqual(by['plan-explainer.r1'].basis, ['reported']);

  // Missing log → unmeasured, estimated from the same role+model peer. No thread id → unmeasured, no peer.
  assert.equal(by['requirements~2'].status, 'unmeasured');
  assert.equal(by['requirements~2'].estimatedUsd, by.requirements.usd);
  assert.equal(by['slice-1.build'].status, 'unmeasured');
  assert.equal(by['slice-1.build'].estimatedUsd, null);

  // Foreman counts only requests inside the run window.
  assert.equal(rep.coordinators[0].requests, 1);
  assert.equal(rep.coordinators[0].phase, 'coordination');

  assert.equal(rep.totals.estimatedUsd, Math.round(/** @type {number} */ (by.requirements.usd) * 100) / 100);
  assert.equal(rep.totals.gateMinutes, 2);
  assert.ok(rep.byPhase.find(p => p?.phase === 'planning'));
  assert.ok(rep.gaps.some(g => g.startsWith('slice-1.build: unmeasured')));
  const html = renderCostHtml(rep);
  assert.match(html, /<svg[^>]+Dispatch timeline/);
  assert.match(html, /Cursor Auto/);
  assert.doesNotMatch(html, /fill="var\(/, 'CSS variables only work in style, not presentation attributes');
});

test('cost report degrades to timing only when T3 state is unreadable, and is written to the run', () => {
  const { paths, run, tmp } = fixtures();
  const home = path.join(tmp, 'home');
  const rep = buildCostReport(run, { home, paths: { ...paths, t3Db: path.join(tmp, 'nope.sqlite') }, rates: RATES });
  assert.ok(rep.dispatches.every(d => d.status === 'unmeasured' && d.minutes !== null));
  assert.equal(rep.totals.usd, 0);
  assert.match(rep.gaps[0], /state database could not be read/);
  assert.ok(renderCostHtml(rep).length > 1000);

  createRunDir(home, run);
  const prev = { ...process.env };
  Object.assign(process.env, { T3_SDLC_USAGE_T3_DB: paths.t3Db, T3_SDLC_USAGE_CLAUDE_DIR: paths.claudeProjects, T3_SDLC_USAGE_CODEX_DIR: paths.codexSessions, T3_SDLC_USAGE_CURSOR_CACHE: paths.cursorCache, T3_SDLC_USAGE_OPENCODE_DB: paths.opencodeDb });
  try {
    const out = writeCostReport(home, run.id);
    assert.ok(fs.existsSync(out.htmlPath));
    assert.ok(fs.existsSync(path.join(path.dirname(out.htmlPath), 'cost.json')));
    assert.ok(out.totals.measuredUsd > 0, 'bundled rates.json prices the fixture models');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
  }
});
