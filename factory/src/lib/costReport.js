// @ts-check
// Per-run cost and time report: tokens from the provider logs (usage.js) priced
// at API list prices (policy/rates.json), grouped by phase, role and model, plus
// an SVG timeline. Written to the run as reports/cost.json and reports/cost.html.
// It shows what a run would cost on pay-as-you-go APIs, whatever plan paid for it.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_ROOT } from './store.js';
import { measureRun, runWindow } from './usage.js';

/**
 * @typedef {{ input?: number, cachedInput?: number, cacheWrite5m?: number, cacheWrite1h?: number, output?: number }} Prices
 * @typedef {Prices & { longContext?: Prices & { above: number }, priority?: Prices, reported?: boolean, source?: string, verified?: boolean }} Rate
 * @typedef {import('./usage.js').UsageRequest} UsageRequest
 */

/** Rate table layers: org (bundled) → user → repo; a later layer replaces a model entry. @param {{ home: string, repo?: string }} p */
export function loadRates({ home, repo }) {
  /** @type {Record<string, Rate>} */
  const models = {};
  const sources = [];
  for (const [layer, file] of [['org', path.join(CONTENT_ROOT, 'policy', 'rates.json')], ['user', path.join(home, 'rates.json')], ...(repo ? [['repo', path.join(repo, '.orchestrate', 'rates.json')]] : [])]) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(models, doc.models || {});
      sources.push({ layer, file });
    } catch {}
  }
  return { models, sources };
}

/** @param {Record<string, Rate>} models @param {string | null | undefined} model */
export function rateFor(models, model) {
  if (!model) return null;
  if (models[model]) return { key: model, rate: models[model] };
  const lower = model.toLowerCase();
  const tail = lower.split('/').pop();
  for (const [k, v] of Object.entries(models)) if (k.toLowerCase() === lower || k.toLowerCase().split('/').pop() === tail) return { key: k, rate: v };
  return null;
}

/**
 * List price of one request, or null when there is neither a rate nor a provider-reported cost.
 * @param {UsageRequest} r @param {Rate | null | undefined} rate @param {{ priority?: boolean }} [opts]
 * @returns {{ usd: number, basis: 'rate' | 'reported', tier: 'base' | 'long' | 'priority' } | null}
 */
export function priceRequest(r, rate, opts = {}) {
  const reported = typeof r.reportedUsd === 'number' ? r.reportedUsd : null;
  if (!rate || rate.reported || rate.input === undefined) return reported === null ? null : { usd: reported, basis: 'reported', tier: 'base' };
  const prompt = r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
  /** @type {'base' | 'long' | 'priority'} */
  let tier = 'base';
  /** @type {Prices} */
  let p = rate;
  if (opts.priority && rate.priority) {
    p = { ...p, ...rate.priority };
    tier = 'priority';
  }
  if (rate.longContext && prompt > rate.longContext.above) {
    p = { ...p, ...rate.longContext };
    tier = 'long';
  }
  const input = p.input || 0;
  const cw5 = p.cacheWrite5m ?? input;
  const usd = (r.input * input + r.cacheRead * (p.cachedInput ?? input) + r.cacheWrite5m * cw5 + r.cacheWrite1h * (p.cacheWrite1h ?? cw5) + (r.output + (r.reasoningSeparate ? r.reasoning : 0)) * (p.output || 0)) / 1e6;
  return { usd, basis: 'rate', tier };
}

/**
 * Phase of a dispatch, from its key first (stable across pipeline versions), then its role.
 * @param {{ key?: string, id?: string, role?: string, mode?: string }} d
 */
export function phaseOf(d) {
  const key = d.key || d.id || '';
  if (/^(requirements|context|architecture|test-plan|slicing|plan-explainer)\b/.test(key)) return 'planning';
  if (/^slice-\d+\./.test(key)) return 'build';
  if (/^(feature|stack)\./.test(key)) return 'feature';
  if (/^docs\b/.test(key)) return 'docs';
  if (/^stack-explainer\b/.test(key)) return 'stack';
  if (d.role === 'explainer') return d.mode === 'stack' ? 'stack' : 'planning';
  if (['product-manager', 'context-curator', 'architect', 'qa-analyst', 'slice-planner'].includes(d.role || '')) return 'planning';
  if (d.role === 'docs-writer') return 'docs';
  if (['feature-reviewer'].includes(d.role || '')) return 'feature';
  if (['engineer', 'reviewer', 'manual-tester'].includes(d.role || '')) return 'build';
  return 'other';
}

export const PHASES = [
  { id: 'planning', label: 'Planning' },
  { id: 'build', label: 'Build' },
  { id: 'feature', label: 'Feature review & fixes' },
  { id: 'docs', label: 'Docs' },
  { id: 'stack', label: 'Stack explainer' },
  { id: 'other', label: 'Other' },
  { id: 'coordination', label: 'Coordination (foreman, repo threads)' },
];

const zeroTokens = () => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, total: 0 });
/** @param {ReturnType<typeof zeroTokens>} t @param {UsageRequest} r */
function addTokens(t, r) {
  t.input += r.input;
  t.cached += r.cacheRead;
  t.cacheWrite += r.cacheWrite5m + r.cacheWrite1h;
  t.output += r.output + (r.reasoningSeparate ? r.reasoning : 0);
  t.total = t.input + t.cached + t.cacheWrite + t.output;
}
const round = (/** @type {number} */ x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
const ms = (/** @type {string | undefined} */ t) => (t ? Date.parse(t) : NaN);

/**
 * Measure, price and aggregate a run. Never throws on missing usage sources.
 * @param {any} run @param {{ home: string, paths?: Record<string, string | undefined>, rates?: Record<string, Rate> }} opts
 */
export function buildCostReport(run, opts) {
  const rates = opts.rates ? { models: opts.rates, sources: [{ layer: 'given', file: '(argument)' }] } : loadRates({ home: opts.home, repo: run.repo?.root });
  const measured = measureRun(run, { paths: opts.paths });
  const win = runWindow(run);
  const missingRates = new Set();

  /** @param {{ sessions: import('./usage.js').SessionUsage[] }} m @param {string | undefined} fallbackModel @param {boolean} priority */
  const price = (m, fallbackModel, priority) => {
    const tokens = zeroTokens();
    let usd = 0;
    let priced = 0;
    let unpriced = 0;
    const tiers = new Set();
    const bases = new Set();
    const models = new Set();
    for (const s of m.sessions) {
      for (const r of s.requests) {
        const model = r.model && r.model !== 'default' ? r.model : fallbackModel || r.model;
        models.add(model);
        addTokens(tokens, r);
        const hit = rateFor(rates.models, model) || rateFor(rates.models, r.model);
        const p = priceRequest(r, hit?.rate, { priority });
        if (!p) {
          unpriced++;
          missingRates.add(model);
          continue;
        }
        usd += p.usd;
        priced++;
        tiers.add(p.tier);
        bases.add(p.basis);
      }
    }
    const requests = m.sessions.reduce((a, s) => a + s.requests.length, 0);
    return { tokens, usd: priced ? usd : null, requests, unpriced, tiers: [...tiers], basis: [...bases], models: [...models].filter(Boolean) };
  };

  const rows = measured.dispatches.map(m => {
    const d = m.dispatch;
    const p = price(m, d.target?.model, d.target?.options?.serviceTier === 'priority');
    const start = ms(d.startedAt);
    const end = ms(d.finishedAt || d.reportedAt);
    /** @type {'measured' | 'unpriced' | 'unmeasured'} */
    const status = !m.sessions.length || !p.requests ? 'unmeasured' : p.usd === null ? 'unpriced' : 'measured';
    return {
      kind: 'dispatch', id: d.id, key: d.key, title: d.title, role: d.role, mode: d.mode, scope: d.scope, slice: d.slice ?? null,
      phase: phaseOf(d), provider: d.target?.providerInstanceId, model: p.models[0] || d.target?.model, family: d.family, outcome: d.status,
      startedAt: d.startedAt, finishedAt: d.finishedAt || d.reportedAt || null,
      minutes: Number.isFinite(start) && Number.isFinite(end) ? round((end - start) / 60000, 2) : null,
      requests: p.requests, tokens: p.tokens, usd: p.usd === null ? null : round(p.usd), basis: p.basis, tiers: p.tiers,
      status, estimatedUsd: /** @type {number | null} */ (null), note: m.note || (p.unpriced ? `${p.unpriced} request(s) without a rate` : undefined),
    };
  });
  // Estimate missing dispatch costs from same role + model peers in this run.
  for (const r of rows) {
    if (r.status === 'measured') continue;
    const peers = rows.filter(x => x.status === 'measured' && x.role === r.role && x.mode === r.mode && x.model === r.model && x.usd !== null);
    if (peers.length) {
      r.estimatedUsd = round(peers.reduce((a, x) => a + /** @type {number} */ (x.usd), 0) / peers.length);
      r.note = `${r.note ? `${r.note}; ` : ''}estimated as the mean of ${peers.length} similar dispatch(es) in this run`;
    }
  }

  const coordinators = measured.coordinators.map(m => {
    const p = price(m, undefined, false);
    return {
      kind: 'coordinator', id: m.id, label: m.label, phase: 'coordination', provider: m.sessions[0]?.provider || null, model: p.models[0] || null,
      requests: p.requests, tokens: p.tokens, usd: p.usd === null ? null : round(p.usd), basis: p.basis, tiers: p.tiers,
      status: !m.sessions.length || !p.requests ? 'unmeasured' : p.usd === null ? 'unpriced' : 'measured', note: m.note,
    };
  });

  const all = [...rows, ...coordinators];
  const sumUsd = (/** @type {any[]} */ xs) => round(xs.reduce((a, x) => a + (x.usd || 0), 0));
  const sumEst = (/** @type {any[]} */ xs) => round(xs.reduce((a, x) => a + (x.usd === null && x.estimatedUsd ? x.estimatedUsd : 0), 0));
  const sumTokens = (/** @type {any[]} */ xs) => xs.reduce((t, x) => ({ input: t.input + x.tokens.input, cached: t.cached + x.tokens.cached, cacheWrite: t.cacheWrite + x.tokens.cacheWrite, output: t.output + x.tokens.output, total: t.total + x.tokens.total }), zeroTokens());
  const wall = (/** @type {any[]} */ xs) => {
    const s = xs.map(x => ms(x.startedAt)).filter(Number.isFinite);
    const e = xs.map(x => ms(x.finishedAt)).filter(Number.isFinite);
    return s.length && e.length ? round((Math.max(...e) - Math.min(...s)) / 60000, 1) : null;
  };

  const byPhase = PHASES.map(ph => {
    const xs = all.filter(x => x.phase === ph.id);
    if (!xs.length) return null;
    const ds = xs.filter(x => x.kind === 'dispatch');
    return { phase: ph.id, label: ph.label, dispatches: ds.length, wallMinutes: ph.id === 'coordination' ? null : wall(ds), dispatchMinutes: round(ds.reduce((a, x) => a + (x.minutes || 0), 0), 1), usd: sumUsd(xs), estimatedUsd: sumEst(xs), tokens: sumTokens(xs), unmeasured: xs.filter(x => x.status !== 'measured').length };
  }).filter(Boolean);

  /** @type {Record<string, any>} */
  const models = {};
  for (const x of all) {
    const k = `${x.provider || '?'}/${x.model || '?'}`;
    const m = (models[k] ??= { provider: x.provider, model: x.model, rows: 0, dispatches: 0, minutes: 0, usd: 0, estimatedUsd: 0, tokens: zeroTokens(), rate: rateFor(rates.models, x.model)?.key || null });
    m.rows++;
    if (x.kind === 'dispatch') {
      m.dispatches++;
      m.minutes += x.minutes || 0;
    }
    m.usd += x.usd || 0;
    if (x.usd === null && x.estimatedUsd) m.estimatedUsd += x.estimatedUsd;
    m.tokens = sumTokens([{ tokens: m.tokens }, x]);
  }
  const byModel = Object.values(models).map(m => ({ ...m, minutes: round(m.minutes, 1), usd: round(m.usd), estimatedUsd: round(m.estimatedUsd) })).sort((a, b) => b.usd + b.estimatedUsd - (a.usd + a.estimatedUsd));

  const measuredUsd = sumUsd(all);
  const estimatedUsd = sumEst(all);
  const gates = ['plan', 'stack'].flatMap(g => (run.gates?.[g] || []).map((/** @type {any} */ x) => ({ gate: g, round: x.round, status: x.status, openedAt: x.openedAt, decidedAt: x.decidedAt || null })));
  const gateMinutes = round(gates.reduce((a, g) => a + (g.decidedAt ? (ms(g.decidedAt) - ms(g.openedAt)) / 60000 : 0), 0), 1);
  const gaps = [
    ...(!measured.dbOk ? ["T3's state database could not be read, so no thread could be matched to a provider session (timing only)."] : []),
    ...all.filter(x => x.status !== 'measured').map(x => `${x.id}: ${x.status}${x.note ? ` — ${x.note}` : ''}`),
    ...[...missingRates].filter(Boolean).map(m => `No rate for model "${m}" (add it to rates.json)`),
  ];
  return {
    runId: run.id, title: run.title, status: run.status, cursor: run.cursor,
    generatedAt: new Date().toISOString(),
    window: { start: new Date(win.start).toISOString(), end: new Date(win.end).toISOString() },
    totals: {
      usd: round(measuredUsd + estimatedUsd, 2), measuredUsd: round(measuredUsd, 2), estimatedUsd: round(estimatedUsd, 2),
      wallMinutes: round((win.end - win.start) / 60000, 1), gateMinutes, dispatches: rows.length, failed: rows.filter(r => r.outcome === 'failed').length,
      tokens: sumTokens(all), unmeasured: all.filter(x => x.status !== 'measured').length,
    },
    byPhase, byModel, dispatches: rows, coordinators, gates, gaps,
    rateSources: rates.sources,
    method: 'Threads → provider sessions via T3 state (orchestration_v2_projection_provider_threads.nativeThreadRef). Claude: transcript usage per request, deduped by message/request id. Codex: rollout token_count events. Cursor: T3 Cursor billing cache (Cursor-reported cost). OpenCode: session totals. Priced at API list prices from rates.json, with long-context and priority tiers; coordinator threads count only requests inside the run window.',
  };
}

// ---------- HTML ----------

const esc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"']/g, c => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (/** @type {number | null | undefined} */ x) => (x === null || x === undefined ? '—' : x >= 100 ? `$${x.toFixed(0)}` : x >= 1 ? `$${x.toFixed(2)}` : x >= 0.01 ? `$${x.toFixed(3)}` : x > 0 ? `$${x.toFixed(4)}` : '$0');
const tok = (/** @type {number} */ n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const mins = (/** @type {number | null | undefined} */ m) => (m === null || m === undefined ? '—' : m < 1 ? `${Math.round(m * 60)}s` : `${m.toFixed(m < 10 ? 1 : 0)} min`);
/** Display name: Cursor's "default" model is Cursor Auto. @param {string | null | undefined} provider @param {string | null | undefined} model */
const label = (provider, model) => (model === 'default' && provider === 'cursor' ? 'Cursor Auto' : model || '—');
const flag = (/** @type {any} */ x) => (x.status === 'measured' ? (x.basis?.includes('reported') ? '<span class="f r" title="provider-reported cost">billed</span>' : '') : x.estimatedUsd ? '<span class="f e" title="estimated">est.</span>' : `<span class="f u" title="${esc(x.note || '')}">${x.status === 'unpriced' ? 'no rate' : 'unmeasured'}</span>`);

/** @param {ReturnType<typeof buildCostReport>} rep */
export function renderCostHtml(rep) {
  const t = rep.totals;
  const colorOf = /** @type {Record<string, string>} */ ({});
  rep.byModel.forEach((m, i) => (colorOf[`${m.provider}/${m.model}`] = `var(--chart-${(i % 6) + 1})`));
  const top = rep.byModel[0];
  const topShare = top && t.usd ? Math.round(((top.usd + top.estimatedUsd) / t.usd) * 100) : 0;
  const allTok = t.tokens;

  const kpis = [
    [mins(t.wallMinutes), `start → ${rep.status === 'active' ? 'now' : 'end'}${t.gateMinutes ? ` (${mins(t.gateMinutes)} waiting on you at gates)` : ''}`],
    [`${t.estimatedUsd ? '~' : ''}${usd(t.usd)}`, `API list price${t.estimatedUsd ? `: ${usd(t.measuredUsd)} measured + ${usd(t.estimatedUsd)} estimated` : ''}`],
    [tok(allTok.total), `tokens (${tok(allTok.cached)} cached reads, ${tok(allTok.output)} output)`],
    [top ? `${topShare}%` : '—', top ? `of cost was ${esc(label(top.provider, top.model))}` : 'no usage measured'],
  ];

  // Timeline
  const ds = rep.dispatches.filter(d => d.startedAt).sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const T0 = ms(rep.window.start);
  const T1 = Math.max(ms(rep.window.end), ...ds.map(d => ms(d.finishedAt || d.startedAt)));
  const span = Math.max(1, (T1 - T0) / 60000);
  const L = 210, W = 1000, R = 12, rowH = 15, top0 = 22;
  const x = (/** @type {number} */ tms) => L + ((tms - T0) / 60000 / span) * (W - L - R);
  const H = top0 + ds.length * rowH + 10;
  const step = span > 120 ? 30 : span > 60 ? 10 : span > 20 ? 5 : span > 8 ? 2 : 1;
  const ticks = [];
  for (let m = 0; m <= span; m += step) ticks.push(`<line x1="${x(T0 + m * 60000).toFixed(1)}" x2="${x(T0 + m * 60000).toFixed(1)}" y1="${top0 - 4}" y2="${H - 6}" style="stroke:var(--border)"/><text x="${x(T0 + m * 60000).toFixed(1)}" y="12" text-anchor="middle" class="ax">${m}</text>`);
  const gateBands = rep.gates.map(g => {
    const a = x(ms(g.openedAt));
    const b = x(g.decidedAt ? ms(g.decidedAt) : T1);
    return `<rect x="${a.toFixed(1)}" y="${top0 - 4}" width="${Math.max(1, b - a).toFixed(1)}" height="${H - top0 - 2}" style="fill:var(--muted-foreground);opacity:.14"><title>${esc(`${g.gate} gate round ${g.round}: ${g.status}`)}</title></rect>`;
  });
  const bars = ds.map((d, i) => {
    const y = top0 + i * rowH;
    const a = x(ms(d.startedAt));
    const b = x(d.finishedAt ? ms(d.finishedAt) : T1);
    const c = colorOf[`${d.provider}/${d.model}`] || 'var(--muted-foreground)';
    const cost = d.usd ?? d.estimatedUsd;
    const end = Math.max(2, b - a) + a;
    const right = end + 4 + 44 <= W;
    return `<text x="${L - 6}" y="${y + 10}" text-anchor="end" class="lb">${esc(d.id.length > 30 ? `${d.id.slice(0, 29)}…` : d.id)}</text><rect x="${a.toFixed(1)}" y="${y + 2}" width="${Math.max(2, b - a).toFixed(1)}" height="${rowH - 5}" rx="2" style="fill:${c}${d.outcome === 'failed' ? ';opacity:.45' : ''}"><title>${esc(`${d.id} · ${label(d.provider, d.model)} · ${mins(d.minutes)} · ${usd(cost)}${d.outcome === 'failed' ? ' · failed' : ''}`)}</title></rect><text x="${(right ? end + 4 : a - 4).toFixed(1)}" y="${y + 10}"${right ? '' : ' text-anchor="end"'} class="ax">${cost !== null && cost !== undefined ? usd(cost) : ''}</text>`;
  });
  const legend = rep.byModel.filter(m => m.dispatches).map(m => `<span><i style="background:${colorOf[`${m.provider}/${m.model}`]}"></i>${esc(label(m.provider, m.model))}</span>`).join('') + (rep.gates.length ? '<span><i style="background:var(--muted-foreground);opacity:.35"></i>human gate</span>' : '');

  const tr = (/** @type {string[]} */ cells) => `<tr>${cells.join('')}</tr>`;
  const td = (/** @type {unknown} */ v, n = false) => `<td${n ? ' class="n"' : ''}>${v}</td>`;
  const phaseRows = rep.byPhase.map(p => tr([td(esc(p.label)), td(p.wallMinutes === null ? 'whole run' : mins(p.wallMinutes)), td(p.dispatches || '—', true), td(p.dispatches ? mins(p.dispatchMinutes) : '—', true), td(tok(p.tokens.total), true), td(`${usd(p.usd)}${p.estimatedUsd ? ` <span class="f e">+${usd(p.estimatedUsd)} est.</span>` : ''}`, true), td(t.usd ? `${Math.round(((p.usd + p.estimatedUsd) / t.usd) * 100)}%` : '—', true)]));
  const modelRows = rep.byModel.map(m => tr([td(`<i class="sw" style="background:${colorOf[`${m.provider}/${m.model}`]}"></i>${esc(label(m.provider, m.model))} <span class="mu">${esc(m.provider || '')}</span>`), td(m.dispatches, true), td(mins(m.minutes), true), td(tok(m.tokens.input), true), td(tok(m.tokens.cached), true), td(tok(m.tokens.cacheWrite), true), td(tok(m.tokens.output), true), td(`${usd(m.usd)}${m.estimatedUsd ? ` <span class="f e">+${usd(m.estimatedUsd)}</span>` : ''}`, true), td(m.rate ? '' : '<span class="f u">no rate</span>')]));
  const coordRows = rep.coordinators.map(c => tr([td(esc(c.label)), td(esc(label(c.provider, c.model))), td(c.requests, true), td(tok(c.tokens.total), true), td(usd(c.usd), true), td(`${flag(c)}${c.tiers?.includes('long') ? ' <span class="f t" title="some requests were priced at the long-context tier">long-context tier</span>' : ''}`)]));
  const dispatchRows = rep.dispatches.map(d => tr([td(`<code>${esc(d.id)}</code>`), td(esc(PHASES.find(p => p.id === d.phase)?.label || d.phase)), td(esc(`${d.role}${d.mode && d.mode !== 'default' ? `:${d.mode}` : ''}`)), td(esc(label(d.provider, d.model))), td(mins(d.minutes), true), td(d.requests, true), td(tok(d.tokens.total), true), td(usd(d.usd ?? d.estimatedUsd), true), td(`${flag(d)}${d.outcome === 'failed' ? ' <span class="f u">failed</span>' : ''}${d.tiers?.includes('long') ? ' <span class="f t" title="some requests were priced at the long-context tier">long-context</span>' : ''}`)]));

  return `<!doctype html><html><head><meta charset="utf-8"><title>Cost · ${esc(rep.title)}</title><style>
body{font-family:var(--font-sans,system-ui);color:var(--foreground);margin:0;line-height:1.45;font-size:14px}
h1{font-size:16px;margin:0 0 4px;font-weight:650}.sub{color:var(--muted-foreground);font-size:12px;margin-bottom:14px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);margin:22px 0 8px;font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.kpi{border:1px solid var(--border);border-radius:var(--radius,8px);padding:10px 12px}
.kpi b{display:block;font-size:22px;font-weight:650}.kpi span{color:var(--muted-foreground);font-size:12px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:5px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{color:var(--muted-foreground);font-weight:600;font-size:12px}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.legend span{display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:12px;color:var(--muted-foreground)}
.legend i,.sw{width:10px;height:10px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:-1px}
svg .lb{font:11px var(--font-mono,ui-monospace,monospace);fill:var(--foreground)}svg .ax{font:10px var(--font-sans,system-ui);fill:var(--muted-foreground)}
.mu{color:var(--muted-foreground);font-size:12px}code{font-family:var(--font-mono,ui-monospace,monospace);font-size:12px}
.f{font-size:11px;border-radius:4px;padding:0 5px;margin-left:4px;white-space:nowrap}
.f.e{background:color-mix(in srgb,var(--chart-3) 18%,transparent)}.f.u{background:color-mix(in srgb,var(--destructive,var(--chart-5)) 16%,transparent)}.f.r,.f.t{background:color-mix(in srgb,var(--chart-2) 16%,transparent)}
details{margin-top:6px}summary{cursor:pointer;color:var(--muted-foreground);font-size:13px}ul{margin:4px 0;padding-left:18px}li{margin:3px 0;font-size:13px}
</style></head><body>
<h1>${esc(rep.title)}</h1>
<div class="sub">Run <code>${esc(rep.runId)}</code> · ${esc(rep.status)}${rep.status === 'active' ? ` at ${esc(rep.cursor)}` : ''} · generated ${esc(rep.generatedAt.slice(0, 16).replace('T', ' '))}Z · API list prices, whatever plan actually paid</div>
<div class="kpis">${kpis.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('')}</div>
<h2>Timeline (minutes from start)</h2>
<div class="legend">${legend}</div>
<div class="wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:640px" role="img" aria-label="Dispatch timeline">${ticks.join('')}${gateBands.join('')}${bars.join('')}</svg></div>
<h2>By phase</h2>
<div class="wrap"><table><tr><th>Phase</th><th>Wall</th><th class="n">Dispatches</th><th class="n">Agent time</th><th class="n">Tokens</th><th class="n">Cost</th><th class="n">Share</th></tr>${phaseRows.join('')}</table></div>
<h2>By model</h2>
<div class="wrap"><table><tr><th>Model</th><th class="n">Dispatches</th><th class="n">Agent time</th><th class="n">Input</th><th class="n">Cached</th><th class="n">Cache write</th><th class="n">Output</th><th class="n">Cost</th><th></th></tr>${modelRows.join('')}</table></div>
${rep.coordinators.length ? `<h2>Coordination threads</h2><div class="wrap"><table><tr><th>Thread</th><th>Model</th><th class="n">Requests</th><th class="n">Tokens</th><th class="n">Cost</th><th></th></tr>${coordRows.join('')}</table></div>` : ''}
<h2>Every dispatch</h2>
<details><summary>${rep.dispatches.length} dispatches</summary><div class="wrap"><table><tr><th>Dispatch</th><th>Phase</th><th>Role</th><th>Model</th><th class="n">Time</th><th class="n">Requests</th><th class="n">Tokens</th><th class="n">Cost</th><th></th></tr>${dispatchRows.join('')}</table></div></details>
<h2>How this was measured</h2>
<ul><li>${esc(rep.method)}</li><li>Agent time is each dispatch's start → finish; parallel dispatches overlap, so it can exceed wall time.</li>${rep.gaps.length ? `<li>Gaps:<ul>${rep.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></li>` : '<li>No gaps: every dispatch and coordinator thread was measured.</li>'}</ul>
</body></html>`;
}
