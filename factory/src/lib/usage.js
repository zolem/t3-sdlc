// @ts-check
// Token usage for a run, read from the providers' own session logs. T3 maps each
// thread (a dispatch's child thread, the foreman, a repo thread) to the
// provider's native session id; the provider logs hold per-request tokens.
//
// Every source is optional and read-only. T3's database and the provider log
// formats are not public interfaces, so anything missing or unreadable makes
// that row "unmeasured" (timing only) instead of failing the report.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * One billed model request. Token fields are disjoint: `input` excludes cached
 * and cache-write tokens. `reasoning` is informational unless the source bills it
 * separately from `output` (OpenCode).
 * @typedef {{ ts: string, model: string | null, input: number, cacheRead: number, cacheWrite5m: number, cacheWrite1h: number, output: number, reasoning: number, reasoningSeparate?: boolean, reportedUsd?: number | null }} UsageRequest
 * @typedef {{ provider: string, nativeId: string, source: string | null, requests: UsageRequest[], note?: string }} SessionUsage
 */

/** @param {Record<string, string | undefined>} [over] */
export function usagePaths(over = {}) {
  const h = os.homedir();
  const env = process.env;
  return {
    t3Db: over.t3Db || env.T3_SDLC_USAGE_T3_DB || path.join(h, '.t3', 'userdata', 'statev2.sqlite'),
    claudeProjects: over.claudeProjects || env.T3_SDLC_USAGE_CLAUDE_DIR || path.join(h, '.claude', 'projects'),
    codexSessions: over.codexSessions || env.T3_SDLC_USAGE_CODEX_DIR || path.join(h, '.codex', 'sessions'),
    cursorCache: over.cursorCache || env.T3_SDLC_USAGE_CURSOR_CACHE || path.join(h, '.t3', 'userdata', 'usage-cursor-account-cache-v1.json'),
    opencodeDb: over.opencodeDb || env.T3_SDLC_USAGE_OPENCODE_DB || path.join(h, '.local', 'share', 'opencode', 'opencode.db'),
  };
}

const q = (/** @type {string} */ s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Read-only query. Prefers the sqlite3 CLI (no experimental warning), then node:sqlite.
 * Returns null when the database cannot be read.
 * @param {string} db @param {string} sql @returns {any[] | null}
 */
export function sqliteQuery(db, sql) {
  if (!fs.existsSync(db)) return null;
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-json', db, sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() ? JSON.parse(out) : [];
  } catch {}
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const conn = new DatabaseSync(db, { readOnly: true });
    try {
      return conn.prepare(sql).all();
    } finally {
      conn.close();
    }
  } catch {
    return null;
  }
}

/**
 * T3 thread id → provider sessions (a thread can hand off between providers).
 * @param {string[]} threadIds @param {ReturnType<typeof usagePaths>} paths
 * @returns {{ map: Map<string, { provider: string, nativeId: string }[]>, ok: boolean }}
 */
export function sessionsForThreads(threadIds, paths) {
  /** @type {Map<string, { provider: string, nativeId: string }[]>} */
  const map = new Map();
  const ids = [...new Set(threadIds.filter(Boolean))];
  if (!ids.length) return { map, ok: true };
  const rows = sqliteQuery(paths.t3Db, `select thread_id as threadId, coalesce(provider_instance_id, provider) as provider, json_extract(payload_json, '$.nativeThreadRef.nativeId') as nativeId from orchestration_v2_projection_provider_threads where thread_id in (${ids.map(q).join(',')})`);
  if (!rows) return { map, ok: false };
  for (const r of rows) {
    if (!r.nativeId) continue;
    const list = map.get(r.threadId) || [];
    if (!list.some(x => x.nativeId === r.nativeId)) list.push({ provider: String(r.provider), nativeId: String(r.nativeId) });
    map.set(r.threadId, list);
  }
  return { map, ok: true };
}

/** @param {string} file @returns {string[]} */
function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
}

/** @param {string} dir @param {string} nativeId */
function findClaudeLog(dir, nativeId) {
  let projects = [];
  try {
    projects = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const p of projects) {
    const f = path.join(dir, p, `${nativeId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * Claude Code transcript: assistant records carry usage; streaming repeats a
 * request, so dedupe by (message.id, requestId) keeping the largest output.
 * @param {string} nativeId @param {ReturnType<typeof usagePaths>} paths @returns {SessionUsage | null}
 */
export function claudeUsage(nativeId, paths) {
  const file = findClaudeLog(paths.claudeProjects, nativeId);
  if (!file) return null;
  /** @type {Map<string, UsageRequest>} */
  const byKey = new Map();
  for (const line of readLines(file)) {
    if (!line.includes('"usage"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const u = o?.type === 'assistant' ? o.message?.usage : null;
    if (!u || o.message?.model === '<synthetic>') continue;
    const cc = u.cache_creation;
    /** @type {UsageRequest} */
    const req = {
      ts: o.timestamp,
      model: o.message?.model || null,
      input: u.input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite5m: cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
      cacheWrite1h: cc ? cc.ephemeral_1h_input_tokens || 0 : 0,
      output: u.output_tokens || 0,
      reasoning: u.output_tokens_details?.thinking_tokens || 0,
    };
    const key = `${o.message?.id}|${o.requestId}`;
    const prev = byKey.get(key);
    if (!prev || req.output > prev.output) byKey.set(key, prev ? { ...req, ts: prev.ts } : req);
  }
  return { provider: 'claudeAgent', nativeId, source: file, requests: [...byKey.values()] };
}

/** @param {string} dir @param {string} nativeId @param {string[]} days ISO dates to look in first */
function findCodexLog(dir, nativeId, days) {
  const suffix = `-${nativeId}.jsonl`;
  for (const day of days) {
    const [y, m, d] = day.slice(0, 10).split('-');
    const sub = path.join(dir, y, m, d);
    try {
      const hit = fs.readdirSync(sub).find(f => f.endsWith(suffix));
      if (hit) return path.join(sub, hit);
    } catch {}
  }
  /** @param {string} p @param {number} depth @returns {string | null} */
  const walk = (p, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(suffix)) return path.join(p, e.name);
      if (e.isDirectory() && depth < 4) {
        const r = walk(path.join(p, e.name), depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(dir, 0);
}

/**
 * Codex rollout: one token_count event per request; last_token_usage is the
 * request, and an unchanged running total marks a repeated event.
 * @param {string} nativeId @param {ReturnType<typeof usagePaths>} paths @param {string[]} [days] @returns {SessionUsage | null}
 */
export function codexUsage(nativeId, paths, days = []) {
  const file = findCodexLog(paths.codexSessions, nativeId, days);
  if (!file) return null;
  /** @type {UsageRequest[]} */
  const requests = [];
  let model = null;
  let lastTotal = '';
  for (const line of readLines(file)) {
    if (!line.includes('"turn_context"') && !line.includes('"token_count"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o?.payload;
    if (o?.type === 'turn_context' && p?.model) model = p.model;
    if (p?.type !== 'token_count' || !p.info?.last_token_usage) continue;
    const total = JSON.stringify(p.info.total_token_usage || null);
    if (total === lastTotal) continue;
    lastTotal = total;
    const l = p.info.last_token_usage;
    const cached = l.cached_input_tokens || 0;
    requests.push({
      ts: o.timestamp, model,
      input: Math.max(0, (l.input_tokens || 0) - cached),
      cacheRead: cached,
      cacheWrite5m: l.cache_write_input_tokens || 0,
      cacheWrite1h: 0,
      output: l.output_tokens || 0,
      reasoning: l.reasoning_output_tokens || 0,
    });
  }
  return { provider: 'codex', nativeId, source: file, requests };
}

/**
 * T3's Cursor billing cache: a string table plus records
 * [ts, modelIdx, conversationIdx, uncachedIn, cacheRead, cacheWrite, out, costUSD, id].
 * Loaded once per report.
 * @param {ReturnType<typeof usagePaths>} paths
 */
export function loadCursorCache(paths) {
  try {
    const doc = JSON.parse(fs.readFileSync(paths.cursorCache, 'utf8'));
    const S = doc.strings || [];
    /** @type {Map<string, UsageRequest[]>} */
    const byConversation = new Map();
    let fetchedAtMs = 0;
    for (const acct of Object.values(doc.accounts || {})) {
      const a = /** @type {any} */ (acct);
      fetchedAtMs = Math.max(fetchedAtMs, a.fetchedAtMs || a.untilMs || 0);
      for (const r of a.records || []) {
        if (!Array.isArray(r) || r.length < 8) continue;
        const conv = S[r[2]];
        if (!conv) continue;
        const list = byConversation.get(conv) || [];
        list.push({ ts: new Date(r[0]).toISOString(), model: S[r[1]] ?? null, input: r[3] || 0, cacheRead: r[4] || 0, cacheWrite5m: r[5] || 0, cacheWrite1h: 0, output: r[6] || 0, reasoning: 0, reportedUsd: typeof r[7] === 'number' ? r[7] : null });
        byConversation.set(conv, list);
      }
    }
    return { byConversation, fetchedAtMs };
  } catch {
    return null;
  }
}

/**
 * OpenCode keeps per-session totals (and its own computed cost) in session_v2;
 * subagent sessions point at their parent.
 * @param {string} nativeId @param {ReturnType<typeof usagePaths>} paths @returns {SessionUsage | null}
 */
export function opencodeUsage(nativeId, paths) {
  const rows = sqliteQuery(paths.opencodeDb, `select id, model, cost, tokens_input as input, tokens_output as output, tokens_reasoning as reasoning, tokens_cache_read as cacheRead, tokens_cache_write as cacheWrite, time_updated as updated from session_v2 where id = ${q(nativeId)} or parent_id = ${q(nativeId)}`);
  if (!rows || !rows.length) return null;
  return {
    provider: 'opencode', nativeId, source: paths.opencodeDb,
    requests: rows.map(r => {
      let model = null;
      try {
        const m = JSON.parse(r.model || 'null');
        model = m ? (m.providerID ? `${m.providerID}/${m.id}` : m.id) : null;
      } catch {}
      return { ts: new Date(Number(r.updated) || 0).toISOString(), model, input: r.input || 0, cacheRead: r.cacheRead || 0, cacheWrite5m: r.cacheWrite || 0, cacheWrite1h: 0, output: r.output || 0, reasoning: r.reasoning || 0, reasoningSeparate: true, reportedUsd: typeof r.cost === 'number' ? r.cost : null };
    }),
    note: 'OpenCode session totals (no per-request detail, so no long-context tier)',
  };
}

/**
 * Who used what in a run: every started dispatch plus the coordinator threads.
 * Coordinator threads are long-lived, so only their requests inside the run window count.
 * @param {any} run @param {{ paths?: Record<string, string | undefined> }} [opts]
 */
export function measureRun(run, opts = {}) {
  const paths = usagePaths(opts.paths);
  const started = (run.dispatches || []).filter((/** @type {any} */ d) => d.startedAt);
  const coordinators = [
    ...(run.foreman?.threadId ? [{ id: 'foreman', label: 'Foreman', threadId: run.foreman.threadId }] : []),
    ...Object.values(run.repos || {}).filter((/** @type {any} */ r) => r.thread?.threadId).map((/** @type {any} */ r) => ({ id: `repo:${r.name}`, label: `Repo thread · ${r.name}`, threadId: r.thread.threadId })),
  ];
  const { map, ok: dbOk } = sessionsForThreads([...started.map((/** @type {any} */ d) => d.childThreadId), ...coordinators.map(c => c.threadId)], paths);
  /** @type {ReturnType<typeof loadCursorCache> | undefined} */
  let cursor;
  const window = runWindow(run);

  /** @param {string | undefined} threadId @param {string[]} days @param {{ from: number, to: number } | null} win */
  const measure = (threadId, days, win) => {
    if (!threadId) return { sessions: [], note: 'no T3 thread id recorded' };
    const found = map.get(threadId);
    if (!found?.length) return { sessions: [], note: dbOk ? 'thread not in T3 state' : 'T3 state database unreadable' };
    /** @type {SessionUsage[]} */
    const sessions = [];
    const notes = [];
    for (const s of found) {
      let u = null;
      const missing = () => notes.push(`${s.provider} session ${s.nativeId}: log not found`);
      if (s.provider === 'claudeAgent' || s.provider.startsWith('claude')) (u = claudeUsage(s.nativeId, paths)) || missing();
      else if (s.provider === 'codex') (u = codexUsage(s.nativeId, paths, days)) || missing();
      else if (s.provider === 'cursor') {
        cursor ??= loadCursorCache(paths);
        const reqs = cursor?.byConversation.get(s.nativeId);
        if (reqs?.length) u = { provider: 'cursor', nativeId: s.nativeId, source: paths.cursorCache, requests: reqs, note: 'Cursor-billed cost' };
        else notes.push(cursor ? `Cursor run not in T3's Cursor usage cache (fetched ${cursor.fetchedAtMs ? new Date(cursor.fetchedAtMs).toISOString() : 'never'}; opening T3's usage page refreshes it)` : "T3's Cursor usage cache is missing");
      } else if (s.provider === 'opencode') (u = opencodeUsage(s.nativeId, paths)) || missing();
      else notes.push(`no usage reader for provider "${s.provider}"`);
      if (u) {
        if (win) u = { ...u, requests: u.requests.filter(r => { const t = Date.parse(r.ts); return !(t < win.from || t > win.to); }) };
        sessions.push(u);
      }
    }
    return { sessions, note: notes.join('; ') || undefined };
  };

  const dayList = (/** @type {any[]} */ ...ts) => [...new Set(ts.map(t => (typeof t === 'number' ? t : Date.parse(t))).filter(Number.isFinite).flatMap(d => [d - 864e5, d, d + 864e5].map(x => new Date(x).toISOString().slice(0, 10))))];
  const dispatches = started.map((/** @type {any} */ d) => ({ kind: 'dispatch', dispatch: d, ...measure(d.childThreadId, dayList(d.startedAt, d.finishedAt), null) }));
  const coords = coordinators.map(c => ({ kind: 'coordinator', ...c, ...measure(c.threadId, dayList(run.createdAt, window.end), { from: window.start - 120_000, to: window.end + 120_000 }) }));
  return { dispatches, coordinators: coords, dbOk, paths, cursorFetchedAtMs: cursor?.fetchedAtMs || null };
}

/** Start and end of a run in ms: creation to its last recorded activity. @param {any} run */
export function runWindow(run) {
  const start = Date.parse(run.createdAt);
  const stamps = [
    ...(run.dispatches || []).flatMap((/** @type {any} */ d) => [d.finishedAt, d.reportedAt, d.startedAt]),
    ...['plan', 'stack'].flatMap(g => (run.gates?.[g] || []).flatMap((/** @type {any} */ x) => [x.decidedAt, x.openedAt])),
  ].filter(Boolean).map(t => Date.parse(t));
  const end = stamps.length ? Math.max(...stamps) : Date.parse(run.updatedAt || run.createdAt);
  return { start, end: run.status === 'active' ? Math.max(end, Date.now()) : end };
}
