#!/usr/bin/env node
// @ts-check
// Completeness check for the role kit's handoff files: the product spec
// (spec.md), the screen index (screen-index.html, read from its JSON data block)
// and the design spec (design-spec.md). It reads what the files declare and
// reports what is missing before a file can be handed to the next role.
//
// No dependencies, one file, Node 18+, so a skill can ship a copy and run it
// anywhere code can run. Agents that cannot run code apply the same rules by
// hand from FORMAT.md (kept in sync with RULES below by a test).
//
//   node check.mjs <folder or files…> [--add-ids] [--sync] [--json]
//
// Exit code 0 when there are no errors, 1 when there are, 2 on bad usage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STATES = ['default', 'empty', 'loading', 'error', 'denied'];
/** Screen types that are not drawn as interactive states (no empty/loading/denied of their own). */
const STATELESS_TYPES = new Set(['email', 'toast', 'notification', 'sms', 'push']);
const VAGUE = ['fast', 'quick', 'quickly', 'easy', 'easily', 'simple', 'intuitive', 'user-friendly', 'seamless', 'seamlessly', 'robust', 'appropriate', 'appropriately', 'as needed', 'etc', 'and so on', 'various', 'tbd', 'tbc'];
const PLACEHOLDER = /^(todo|tbd|tbc|\?+|-|…|\.\.\.)$/i;
/** Answers that say the question is still open. */
const UNANSWERED = /^(todo|tbd|tbc|\?+|-|…|\.\.\.|none|unknown|undecided|pending|open|not (yet )?(decided|known|sure|answered)|not decided yet|no answer( yet)?)\b/i;
/** Marks something not settled yet: "(proposed)", "(proposed, see id:x)" or "(waiting on id:x)". */
const PROPOSED = /\((?:proposed|waiting on)\b[^)]*\)/i;
/** A spec line pointing at another item: "(proposed, see id:x)" or "(waiting on id:x)". */
const OPEN_REF = /\((?:proposed\b[^)]*?\bsee|waiting on)\s+`?id:([^`)\s,]+)/gi;
/** An id written last on its line: `id:seat-limit`. */
const ID_TAG_END = /\s*`id:([^`]*)`\s*$/;
const ID_TAG_ANY = /`id:([^`]*)`/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Example markers: ✅ normal case, ⚠️ edge case, ❌ error. */
const EDGE_OR_ERROR = /^(?:⚠|❌|✖|edge(?: case)?:|error:)/i;
/** The screen index's data block inside screen-index.html. */
const DATA_BLOCK = /(<script\b[^>]*\bid=["']screen-index["'][^>]*>)([\s\S]*?)(<\/script>)/i;
export const SCREEN_TYPES = ['page', 'modal', 'drawer', 'panel', 'email', 'toast', 'notification', 'sms', 'push'];
/** The wireframe building blocks screen-index.html knows how to draw. */
export const BLOCKS = ['h', 'p', 'section', 'btn', 'row', 'cols', 'card', 'input', 'field', 'select', 'date', 'days', 'toggle', 'check', 'radio', 'tabs', 'list', 'menu', 'icon', 'skel', 'banner', 'err', 'badge', 'toast', 'empty', 'spinner', 'img', 'divider'];

/** Every rule, with the file it guards. FORMAT.md documents the same ids. */
export const RULES = {
  F1: { file: 'any', text: 'Front matter (or the screen index data) has kind, feature, version and status (draft or ready).' },
  F2: { file: 'any', text: 'Every id is used once across the handoff files.' },
  F3: { file: 'any', text: 'Every id or persona a file points at exists in the handoff files.' },
  F4: { file: 'any', text: 'No template placeholders (<like this>) are left.' },
  F5: { file: 'any', text: 'Every persona, requirement, rule, open question, screen, flow and acceptance case ends with an id (`id:short-name`, lowercase words and hyphens).' },
  S1: { file: 'spec', text: 'Every required section is present and not empty (n/a — why, if it does not apply).' },
  S2: { file: 'spec', text: 'At least one persona is listed.' },
  S3: { file: 'spec', text: 'Every requirement says who it is for (personas from the Personas section) and its priority (must, should or could).' },
  S4: { file: 'spec', text: 'Every requirement has at least one rule, and every rule has at least one example.' },
  S5: { file: 'spec', text: 'Every example gives the situation and what happens (situation → result, or Given/When/Then).' },
  S6: { file: 'spec', text: 'Every requirement has at least one edge case or error example (⚠️ or ❌), not only the happy path. Warning only.' },
  S7: { file: 'spec', text: 'The permissions table has a column for every persona and no empty cells.' },
  S8: { file: 'spec', text: 'A ready spec has nothing left open: every open question has an answer, and nothing is marked (proposed) or (waiting on id:…).' },
  S9: { file: 'spec', text: 'Rules and examples avoid vague words (fast, easy, intuitive…). Warning only.' },
  I1: { file: 'screens', text: 'The screen index names the spec version it was built from, and it matches the spec. It can only be ready if the spec is.' },
  I2: { file: 'screens', text: 'Every screen has a known type, personas, an entry point, what it covers, and a wireframe.' },
  I3: { file: 'screens', text: 'Every screen has each required state: a wireframe, unchanged with a reason (only on a screen that already exists), or n/a with a reason.' },
  I4: { file: 'screens', text: 'Every interaction has a trigger and a result.' },
  I5: { file: 'screens', text: 'Every flow names one persona, steps through declared screens, taps something shown on each step, and says what it covers.' },
  I6: { file: 'screens', text: 'Every rule is covered by a screen or a flow (directly or through its requirement).' },
  I7: { file: 'screens', text: 'Every persona with requirements has at least one flow.' },
  I8: { file: 'screens', text: 'Wireframes only use the known building blocks. Warning only.' },
  I9: { file: 'screens', text: 'Persona names and rule titles match the spec (the check copies them with --sync).' },
  I10: { file: 'screens', text: 'A ready screen index has nothing left open: every question for product has an answer.' },
  I11: { file: 'screens', text: 'Every edge case and error example in the spec (⚠️ ❌) says where it shows: a screen, a state or a flow (--sync lists them).' },
  D1: { file: 'design', text: 'The design spec names the screen index version it was built from, and it matches. It can only be ready if the index is.' },
  D2: { file: 'design', text: 'Every screen in the index has a design entry.' },
  D3: { file: 'design', text: 'Every state the screen index asks to draw has a frame link, or n/a with a reason.' },
  D4: { file: 'design', text: 'Every acceptance case names one persona, the rules it covers, its steps and what to expect.' },
  D5: { file: 'design', text: 'Every rule has at least one acceptance case.' },
  D6: { file: 'design', text: 'Every persona with requirements has at least one acceptance case.' },
};

/** @type {[string, RegExp][]} */
const SPEC_SECTIONS = [
  ['Problem', /problem/i],
  ['Goals and success metrics', /goal|success/i],
  ['Personas', /persona/i],
  ['Requirements', /requirement/i],
  ['Permissions', /permission/i],
  ['Data and privacy', /privacy|data/i],
  ['Analytics', /analytic|tracking|events/i],
  ['Rollout', /rollout|release|launch/i],
  ['Out of scope', /out of scope|non-goal/i],
  ['Open questions', /question/i],
];

const KINDS = { spec: 'spec', 'product-spec': 'spec', 'screen-index': 'screens', screens: 'screens', 'design-spec': 'design', design: 'design' };
const LABEL = { spec: 'Product spec', screens: 'Screen index', design: 'Design spec' };
/** Item types that declare an id, and the file that declares them. */
const DECLARES = { persona: 'spec', requirement: 'spec', rule: 'spec', question: 'spec', screen: 'screens', flow: 'screens', case: 'design' };
const COUNT_LABEL = { persona: 'personas', requirement: 'requirements', rule: 'rules', example: 'examples', question: 'questions', screen: 'screens', state: 'states to draw', interaction: 'interactions', flow: 'flows', case: 'acceptance cases' };
/** A template placeholder: <words>, not an HTML tag with attributes or a closing tag. */
const PLACEHOLDER_TAG = /<[A-Za-z][^<>=\/]*>/;

/**
 * @typedef {'persona' | 'requirement' | 'rule' | 'question' | 'screen' | 'interaction' | 'flow' | 'entry' | 'case'} ItemType
 * @typedef {{ type: ItemType, id: string | null, badId?: string, misplaced?: boolean, title: string, line: number, own: string[], parent?: string, examples?: string[], who?: string, priority?: string, data?: any }} Item
 * @typedef {{ file: string, kind: string, meta: Record<string, string>, items: Item[], sections: { title: string, lines: string[] }[], text: string, raw: string, data?: any, parseError?: string }} Doc
 * @typedef {{ rule: string, severity: 'error' | 'warning', file: string, where?: string, message: string }} Finding
 */

/** @param {string} text */
function frontMatter(text) {
  /** @type {Record<string, string>} */
  const meta = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta, head: '', body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, head: m[0], body: text.slice(m[0].length) };
}

/** What a `##` section holds, for each kind of file. @param {string} kind @param {string} title */
function sectionRole(kind, title) {
  if (kind === 'spec') return /persona/i.test(title) ? 'personas' : /requirement/i.test(title) ? 'requirements' : /question/i.test(title) ? 'questions' : '';
  if (kind === 'screens') return /screen/i.test(title) ? 'screens' : /flow/i.test(title) ? 'flows' : '';
  if (kind === 'design') return /acceptance|case/i.test(title) ? 'cases' : /screen|frame/i.test(title) ? 'entries' : '';
  return '';
}

/** Lines with fenced code blanked out, so examples inside code blocks are never read as content. @param {string[]} lines */
function visible(lines) {
  let inFence = false;
  return lines.map(l => {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return ''; }
    return inFence ? '' : l;
  });
}

/** Split a line into its title and trailing id. @param {string} s */
function splitId(s) {
  const m = s.match(ID_TAG_END);
  const rest = m ? s.slice(0, m.index) : s;
  return {
    title: rest.replace(/`id:[^`]*`/g, '').trim(),
    id: m && SLUG.test(m[1]) ? m[1] : null,
    badId: m && !SLUG.test(m[1]) ? m[1] : undefined,
    misplaced: !m && ID_TAG_ANY.test(rest),
  };
}

/** A persona list item's name: the bold part, or the text before a dash or colon. @param {string} s */
function personaTitle(s) {
  const bold = s.match(/^\*\*(.+?)\*\*/);
  return (bold ? bold[1] : s.split(/\s+[—–-]\s+|:\s/)[0]).trim();
}

/** The data block of a screen-index.html, or null when the file has none. Throws on invalid JSON. @param {string} html */
export function indexData(html) {
  const m = html.match(DATA_BLOCK);
  return m ? JSON.parse(m[2]) : null;
}

/** JSON laid out for people: anything short stays on one line. @param {any} v @param {string} [pad] @returns {string} */
function layout(v, pad = '') {
  const flat = JSON.stringify(v);
  if (flat === undefined) return 'null';
  if (v === null || typeof v !== 'object' || flat.length + pad.length <= 100) return flat;
  const inner = pad + '  ';
  if (Array.isArray(v)) return `[\n${v.map(x => inner + layout(x, inner)).join(',\n')}\n${pad}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${layout(x, inner)}`).join(',\n')}\n${pad}}`;
}

/** screen-index.html with its data block replaced. @param {string} html @param {any} data */
export function withIndexData(html, data) {
  return html.replace(DATA_BLOCK, (_, open, _old, close) => `${open}\n${layout(data).replace(/<\//g, '<\\/')}\n${close}`);
}

/** A screen index: everything comes from the JSON data block. @param {string} file @param {string} text @returns {Doc} */
function parseIndex(file, text) {
  /** @type {any} */
  let data = null;
  let parseError;
  try { data = indexData(text); } catch (err) { parseError = err instanceof Error ? err.message : String(err); }
  const base = { file, items: [], sections: [], text: '', raw: text };
  if (parseError) return { ...base, kind: 'screens', meta: {}, parseError };
  if (!data || typeof data !== 'object') return { ...base, kind: '', meta: {} };
  const str = (/** @type {any} */ v) => (v === undefined || v === null ? '' : String(v));
  /** @type {Record<string, string>} */
  const meta = { kind: str(data.kind), feature: str(data.feature), title: str(data.title), version: str(data.version), status: str(data.status) };
  if (data.specVersion !== undefined) meta.spec_version = str(data.specVersion);
  if (Array.isArray(data.requiredStates)) meta.required_states = data.requiredStates.join(', ');
  /** @type {Item[]} */
  const items = [];
  /** @param {ItemType} type @param {any} x @param {string} title @param {string} [parent] */
  const make = (type, x, title, parent) => {
    const raw = typeof x.id === 'string' ? x.id : '';
    items.push({ type, id: SLUG.test(raw) ? raw : null, badId: raw && !SLUG.test(raw) ? raw : undefined, title: str(title), line: 0, own: [], parent, data: x });
  };
  for (const s of Array.isArray(data.screens) ? data.screens : []) {
    make('screen', s, s.title || s.id);
    for (const x of Array.isArray(s.interactions) ? s.interactions : []) make('interaction', x, x.trigger || '(no trigger)', s.id || s.title);
  }
  for (const f of Array.isArray(data.flows) ? data.flows : []) make('flow', f, f.title || f.id);
  return { ...base, kind: KINDS[/** @type {keyof typeof KINDS} */ (meta.kind.toLowerCase())] || 'screens', meta, items, data };
}

/** Parse one handoff file. @param {string} file @param {string} text @returns {Doc} */
export function parseDoc(file, text) {
  if (/\.html?$/i.test(file) || DATA_BLOCK.test(text)) return parseIndex(file, text);
  const { meta, body } = frontMatter(text);
  const kind = KINDS[/** @type {keyof typeof KINDS} */ ((meta.kind || '').toLowerCase())] || '';
  const lines = visible(body.split(/\r?\n/));
  /** @type {{ title: string, start: number, lines: string[] }[]} */
  const sections = [];
  lines.forEach((l, i) => {
    const m = l.match(/^##\s+(.*)$/);
    if (m) sections.push({ title: m[1].trim(), start: i + 1, lines: [] });
  });
  sections.forEach((s, k) => { s.lines = lines.slice(s.start, k + 1 < sections.length ? sections[k + 1].start - 1 : lines.length); });

  /** @type {Item[]} */
  const items = [];
  /** @param {ItemType} type @param {string} raw @param {number} line @param {string[]} own @param {Partial<Item>} [extra] */
  const make = (type, raw, line, own, extra = {}) => {
    const { title, id, badId, misplaced } = splitId(raw);
    const it = /** @type {Item} */ ({ type, id, badId, misplaced, title, line, own, ...extra });
    items.push(it);
    return it;
  };

  for (const sec of sections) {
    const role = sectionRole(kind, sec.title);
    if (!role) continue;
    const L = sec.lines;
    const heads = L.map((l, i) => (/^###\s+/.test(l) ? i : -1)).filter(i => i >= 0);
    const blocks = heads.map((h, k) => ({ head: L[h].replace(/^###\s+/, ''), line: sec.start + h + 1, body: L.slice(h + 1, k + 1 < heads.length ? heads[k + 1] : L.length) }));

    if (role === 'personas') {
      // Personas are list items (`- **Name** — who they are `id:x``) or ### headings with fields.
      L.slice(0, heads.length ? heads[0] : L.length).forEach((l, i) => {
        const m = l.match(/^[-*]\s+(.*)$/);
        if (m) {
          const it = make('persona', m[1], sec.start + i + 1, [m[1]]);
          it.title = personaTitle(it.title);
        }
      });
      for (const b of blocks) make('persona', b.head, b.line, b.body);
    } else if (role === 'requirements') {
      /** Numbered rules and their indented examples. A rule with no parent applies everywhere. @param {string[]} body @param {number} base line number of body[0] @param {string} parent */
      const parseRules = (body, base, parent) => {
        /** @type {Item | null} */
        let rule = null;
        body.forEach((l, i) => {
          const r = l.match(/^\d+[.)]\s+(.*)$/);
          if (r) { rule = make('rule', r[1], base + i, [l], { parent, examples: [] }); return; }
          if (!rule) return;
          const ex = l.match(/^\s+[-*+]\s+(.*)$/);
          if (ex) rule.examples?.push(ex[1].trim());
          else if (/^\s{2,}\S/.test(l) && rule.examples?.length) rule.examples[rule.examples.length - 1] += ' ' + l.trim();
          else if (l.trim() && !/^\s/.test(l)) rule = null;
        });
      };
      parseRules(L.slice(0, heads.length ? heads[0] : L.length), sec.start + 1, '');
      for (const b of blocks) {
        const req = make('requirement', b.head, b.line, b.body);
        const firstRule = b.body.findIndex(l => /^\d+[.)]\s+/.test(l));
        const pre = (firstRule < 0 ? b.body : b.body.slice(0, firstRule)).join('\n');
        req.who = fieldIn(pre, 'who|personas?');
        req.priority = fieldIn(pre, 'priority');
        parseRules(b.body, b.line + 1, req.id || req.title);
      }
    } else {
      const type = /** @type {ItemType} */ ({ questions: 'question', screens: 'screen', flows: 'flow', entries: 'entry', cases: 'case' }[role]);
      for (const b of blocks) {
        if (type !== 'screen') { make(type, b.head, b.line, b.body); continue; }
        // A screen's own fields stop at its first #### interaction.
        const ints = b.body.map((l, i) => (/^####\s+/.test(l) ? i : -1)).filter(i => i >= 0);
        const scr = make('screen', b.head, b.line, b.body.slice(0, ints.length ? ints[0] : b.body.length));
        ints.forEach((h, k) => make('interaction', b.body[h].replace(/^####\s+/, ''), b.line + h + 1, b.body.slice(h + 1, k + 1 < ints.length ? ints[k + 1] : b.body.length), { parent: scr.id || scr.title }));
      }
    }
  }
  return { file, kind, meta, items, sections: sections.map(s => ({ title: s.title, lines: s.lines })), text: body, raw: text };
}

/** The value of `**Who:** …` or `- Who: …` in a block of text, up to the next · or line end. @param {string} text @param {string} names */
function fieldIn(text, names) {
  const m = text.match(new RegExp(String.raw`(?:^|[·|\n])[ \t]*(?:[-*][ \t]+)?\**(?:${names})\**[ \t]*:[ \t]*\**[ \t]*([^·|\n]*)`, 'i'));
  return m ? m[1].replace(/\*+/g, '').trim() : '';
}

/**
 * `- Key: value` fields in an item's own lines. A field with indented bullets
 * underneath also collects them as `sub` (`- name: value` pairs) and `list`.
 * @param {string[]} lines
 */
function fields(lines) {
  /** @type {Record<string, { value: string, sub: Record<string, string>, list: string[] }>} */
  const out = {};
  /** @type {{ value: string, sub: Record<string, string>, list: string[] } | null} */
  let cur = null;
  for (const raw of lines) {
    const top = raw.match(/^[-*]\s+(?:\*\*)?([A-Za-z][\w /&()-]*?)(?:\*\*)?\s*:\s*(.*)$/);
    if (top) {
      cur = { value: top[2].trim(), sub: {}, list: [] };
      out[top[1].trim().toLowerCase()] = cur;
      continue;
    }
    const nested = raw.match(/^\s{2,}(?:[-*]|\d+[.)])\s+(.*)$/);
    if (nested && cur) {
      const item = nested[1].trim();
      cur.list.push(item);
      const kv = item.match(/^(?:\*\*)?([A-Za-z][\w /-]*?)(?:\*\*)?\s*:\s*(.*)$/);
      if (kv) cur.sub[kv[1].trim().toLowerCase()] = kv[2].trim();
      continue;
    }
    if (raw.trim() && !/^\s/.test(raw)) cur = null;
  }
  return out;
}

/** Ids listed in a field: `Covers: seat-limit, resend`. @param {string} s */
const idList = s => String(s || '').split(/[,\s]+/).map(x => x.replace(/[`*]/g, '').replace(/^id:/, '').trim()).filter(Boolean);
/** Names listed in a field: `Who: Workspace owner, Workspace member`. @param {string} s */
const nameList = s => String(s || '').replace(PROPOSED, '').split(/,|;|·|\band\b/).map(x => x.replace(/[`*]/g, '').replace(/^id:/, '').trim()).filter(Boolean);
/** @param {string} s */
const filled = s => !!s && !PLACEHOLDER.test(s.trim());
/** @param {Doc} d */
const isReady = d => (d.meta.status || '').toLowerCase() === 'ready';
/** n/a needs a reason after it. @param {string} s */
const naWithReason = s => /^n\/?a\b/i.test(s.trim()) && s.trim().replace(/^n\/?a\b[\s—:–-]*/i, '').length >= 3;
/** @param {string} s */
const isNa = s => /^n\/?a\b/i.test(s.trim());
/** @param {string} s */
const short = s => (s.length > 60 ? s.slice(0, 57) + '…' : s);
/** How a finding names an item: its title, and its id when it has one. @param {Item} it */
const named = it => `"${short(it.title)}"${it.id ? ` (${it.id})` : ''}`;
/** @param {string | undefined} answer */
const unanswered = answer => !answer || UNANSWERED.test(answer.trim());

/** @param {Doc[]} docs */
export function check(docs) {
  /** @type {Finding[]} */
  const findings = [];
  /** @param {string} rule @param {Doc} d @param {string} message @param {string} [where] @param {'error' | 'warning'} [severity] */
  const add = (rule, d, message, where, severity = 'error') => findings.push({ rule, severity, file: d.file, where, message });

  const byKind = (/** @type {string} */ k) => docs.find(d => d.kind === k);
  const spec = byKind('spec');
  const screens = byKind('screens');
  const design = byKind('design');

  /** @type {Map<string, Item>} */
  const declared = new Map();
  for (const d of docs) {
    if (d.parseError) {
      add('F1', d, `The screen-index data block isn't valid JSON: ${d.parseError}`);
      continue;
    }
    const where = d.data ? 'The data block' : 'Front matter';
    for (const k of ['kind', 'feature', 'version', 'status']) if (!d.meta[k]) add('F1', d, `${where} is missing "${k}".`);
    if (d.meta.status && !['draft', 'ready'].includes(d.meta.status.toLowerCase())) add('F1', d, `status must be draft or ready (found "${d.meta.status}").`);
    for (const it of d.items) {
      if (!(it.type in DECLARES)) continue;
      if (!it.id) {
        add('F5', d, it.misplaced ? `${named(it)}: the id must come last on the line (put "(proposed)" or "(waiting on …)" before it).`
          : it.badId !== undefined ? `${named(it)} has a malformed id (id:${it.badId}). Use lowercase words joined by hyphens.`
          : `The ${it.type} ${named(it)} has no id. Add \`id:short-name\` at the end of its line, or run with --add-ids.`, short(it.title));
        continue;
      }
      if (declared.has(it.id)) add('F2', d, `id:${it.id} is used more than once.`, it.id);
      else declared.set(it.id, it);
    }
    const hits = d.data ? strings(d.data).filter(l => PLACEHOLDER_TAG.test(l)) : visible(d.raw.split(/\r?\n/)).filter(l => PLACEHOLDER_TAG.test(l)).map(l => l.trim());
    if (hits.length) add('F4', d, `${hits.length} template placeholder line(s) left, e.g. "${hits[0].slice(0, 80)}".`);
  }

  const personas = spec ? spec.items.filter(i => i.type === 'persona') : [];
  const reqs = spec ? spec.items.filter(i => i.type === 'requirement') : [];
  const rules = spec ? spec.items.filter(i => i.type === 'rule') : [];
  /** @param {string} n */
  const findPersona = n => personas.find(p => p.id === n || p.title.toLowerCase() === n.toLowerCase());
  /** Personas named by at least one requirement. */
  const activePersonas = new Set(reqs.flatMap(r => nameList(r.who || '').map(findPersona).filter(Boolean).map(p => /** @type {Item} */ (p).id || /** @type {Item} */ (p).title)));
  /** Rule ids a Covers list reaches: rules directly, or every rule of a listed requirement. @param {string[]} ids */
  const rulesCovered = ids => ids.flatMap(id => (reqs.some(r => r.id === id) ? rules.filter(r => r.parent === id).map(r => r.id) : [id]));

  /** Check a Covers list points at the spec. @param {Doc} d @param {Item} it @param {string[]} ids @param {boolean} [rulesOnly] */
  const checkCovers = (d, it, ids, rulesOnly = false) => {
    if (!spec) return;
    for (const id of ids) {
      const target = declared.get(id);
      if (!target || !['rule', 'requirement'].includes(target.type)) add('F3', d, `${named(it)} covers id:${id}, which isn't a requirement or rule in the spec.`, it.id || it.title);
      else if (rulesOnly && target.type !== 'rule') add('F3', d, `${named(it)} covers the requirement ${id}; name the rules it proves instead.`, it.id || it.title);
    }
  };
  /** Check persona names point at the spec's personas. @param {Doc} d @param {Item} it @param {string[]} names */
  const checkPersonas = (d, it, names) => {
    if (!spec) return;
    for (const n of names) if (!findPersona(n)) add('F3', d, `${named(it)} names "${n}", which isn't a persona in the spec.`, it.id || it.title);
  };

  if (spec) {
    for (const [name, re] of SPEC_SECTIONS) {
      const sec = spec.sections.find(s => re.test(s.title));
      if (!sec) add('S1', spec, `Missing the "${name}" section.`);
      else if (name !== 'Open questions' && !sec.lines.some(l => l.trim() && !/^\s*<!--.*-->\s*$/.test(l))) add('S1', spec, `The "${sec.title}" section is empty. Fill it in, or write "n/a — <why>".`);
    }
    if (!personas.length) add('S2', spec, 'No personas listed (- **Name** — who they are `id:short-name` under Personas).');
    for (const r of reqs) {
      const names = nameList(r.who || '');
      if (!names.length) add('S3', spec, `${named(r)} doesn't say who it is for (**Who:** a persona).`, r.id || r.title);
      for (const n of names) if (!findPersona(n)) add('S3', spec, `${named(r)} is for "${n}", which isn't in Personas.`, r.id || r.title);
      if (!/^(must|should|could)\b/i.test((r.priority || '').replace(/\*+/g, '').trim())) add('S3', spec, `${named(r)} has no priority (**Priority:** must, should or could).`, r.id || r.title);
      const mine = rules.filter(x => x.parent === (r.id || r.title));
      if (!mine.length) add('S4', spec, `${named(r)} has no rules (a numbered list under it).`, r.id || r.title);
      for (const x of mine) if (!x.examples?.length) add('S4', spec, `The rule ${named(x)} has no examples (indented bullets: situation → what happens).`, x.id || x.title);
      if (mine.length && !mine.some(x => x.examples?.some(e => EDGE_OR_ERROR.test(e)))) add('S6', spec, `${named(r)} only has happy-path examples. Add an edge case (⚠️) or error (❌).`, r.id || r.title, 'warning');
    }
    for (const x of rules.filter(r => r.parent === '')) if (!x.examples?.length) add('S4', spec, `The rule ${named(x)} has no examples (indented bullets: situation → what happens).`, x.id || x.title);
    for (const m of visible(spec.text.split(/\r?\n/)).join('\n').matchAll(OPEN_REF)) {
      if (!declared.has(m[1])) add('F3', spec, `"${short(m[0])})" points at id:${m[1]}, which isn't in the spec.`, m[1]);
    }
    for (const x of rules) {
      for (const e of x.examples || []) {
        if (!(/→|->/.test(e) || (/\bgiven\b/i.test(e) && /\bthen\b/i.test(e)))) add('S5', spec, `An example of ${named(x)} doesn't say what happens (situation → result): "${short(e)}"`, x.id || x.title);
      }
      vague(x, [x.title, ...(x.examples || [])].join('\n'));
    }
    const perms = spec.sections.find(s => /permission/i.test(s.title));
    if (perms && personas.length) {
      const rows = perms.lines.filter(l => /^\s*\|/.test(l));
      const header = (rows[0] || '').toLowerCase();
      const missingCols = personas.filter(p => !(p.id && header.includes(p.id)) && !header.includes(p.title.toLowerCase())).map(p => p.title);
      if (!rows.length) add('S7', spec, 'The Permissions section has no table (rows: actions, columns: personas).');
      else {
        if (missingCols.length) add('S7', spec, `The permissions table has no column for ${missingCols.join(', ')}.`);
        const width = (rows[0] || '').split('|').length;
        rows.slice(2).forEach(row => {
          const cells = row.split('|').slice(1, -1).map(c => c.trim());
          if (cells.some(c => !filled(c)) || row.split('|').length < width) add('S7', spec, `Permissions row "${cells[0] || row.trim()}" has empty cells.`);
        });
      }
    }
    if (isReady(spec)) for (const o of openItems(spec)) add('S8', spec, `${o}: a ready spec has nothing left open. Settle it, or set status back to draft.`);
  }

  if (screens && !screens.parseError) {
    if (spec) {
      const built = screens.meta.spec_version;
      if (!built) add('I1', screens, 'The screen index is missing "specVersion" (the spec version it was built from).');
      else if (spec.meta.version && built !== spec.meta.version) add('I1', screens, `Built from spec version ${built}, but the spec is now version ${spec.meta.version}. Update the index.`);
      if (isReady(screens) && !isReady(spec)) add('I1', screens, 'The index is marked ready, but the spec is still a draft. Keep the index a draft until the spec is ready.');
    }
    const states = requiredStates(screens);
    const scrs = screens.items.filter(i => i.type === 'screen');
    const screenIds = new Set(scrs.map(s => s.id).filter(Boolean));
    for (const s of scrs) {
      const x = s.data || {};
      const where = s.id || s.title;
      if (!SCREEN_TYPES.includes(x.type)) add('I2', screens, `${named(s)} has ${x.type ? `an unknown type "${x.type}"` : 'no type'} (one of ${SCREEN_TYPES.join(', ')}).`, where);
      if (!Array.isArray(x.personas) || !x.personas.length) add('I2', screens, `${named(s)} doesn't list its personas.`, where);
      if (!filled(x.entry || '')) add('I2', screens, `${named(s)} doesn't say how people get there ("entry").`, where);
      if (!Array.isArray(x.covers) || !x.covers.length) add('I2', screens, `${named(s)} doesn't list the rules it covers ("covers").`, where);
      if (!Array.isArray(x.wireframe) || !x.wireframe.length) add('I2', screens, `${named(s)} has no wireframe.`, where);
      checkPersonas(screens, s, Array.isArray(x.personas) ? x.personas : []);
      checkCovers(screens, s, Array.isArray(x.covers) ? x.covers : []);
      if (x.type === 'panel' && x.inside && !screenIds.has(x.inside)) add('F3', screens, `${named(s)} is inside "${x.inside}", which isn't a screen in the index.`, where);
      for (const st of STATELESS_TYPES.has(x.type) ? [] : states.filter(st => st !== 'default')) {
        const v = (x.states || {})[st];
        if (!v) add('I3', screens, `${named(s)} doesn't cover the "${st}" state (a wireframe, "unchanged" or "na", each with a reason).`, where);
        else if (v.na !== undefined) { if (!reason(v.na)) add('I3', screens, `${named(s)} marks "${st}" n/a without a reason.`, where); }
        else if (v.unchanged !== undefined) {
          if (x.change !== 'update') add('I3', screens, `${named(s)} is new, so its "${st}" state can't be unchanged: draw it, or mark it n/a with a reason.`, where);
          else if (!reason(v.unchanged)) add('I3', screens, `${named(s)} marks "${st}" unchanged without saying what stays as it is.`, where);
        }
        else if (!Array.isArray(v.wireframe) || !v.wireframe.length) add('I3', screens, `${named(s)} state "${st}" has no wireframe.`, where);
      }
      const unknown = [...new Set(wireframes(x).flatMap(blockKinds).filter(k => !BLOCKS.includes(k)))];
      if (unknown.length) add('I8', screens, `${named(s)} uses unknown building blocks (${unknown.join(', ')}); they draw as placeholders.`, where, 'warning');
    }
    for (const i of screens.items.filter(x => x.type === 'interaction')) {
      const x = i.data || {};
      if (!filled(x.trigger || '')) add('I4', screens, `An interaction on ${i.parent} has no trigger.`, i.parent);
      if (!filled(x.result || '')) add('I4', screens, `The interaction ${named(i)} has no result.`, i.parent);
      if (x.to && !screenIds.has(x.to)) add('F3', screens, `The interaction ${named(i)} goes to "${x.to}", which isn't a screen in the index.`, i.parent);
    }
    const flows = screens.items.filter(i => i.type === 'flow');
    for (const fl of flows) {
      const x = fl.data || {};
      const where = fl.id || fl.title;
      const who = typeof x.persona === 'string' && x.persona.trim() ? [x.persona.trim()] : [];
      if (!who.length) add('I5', screens, `The flow ${named(fl)} must name exactly one persona ("persona").`, where);
      checkPersonas(screens, fl, who);
      const steps = Array.isArray(x.steps) ? x.steps : [];
      if (!steps.length) add('I5', screens, `The flow ${named(fl)} has no steps.`, where);
      steps.forEach((/** @type {any} */ st, k) => {
        const target = scrs.find(s => s.id === st.screen);
        if (!target) add('I5', screens, `The flow ${named(fl)} steps through "${st.screen}", which isn't a screen in the index.`, where);
        else if (st.state && st.state !== 'default' && !(target.data.states || {})[st.state]?.wireframe) add('I5', screens, `The flow ${named(fl)} shows ${named(target)} in the "${st.state}" state, which has no wireframe.`, where);
        else if (st.tap && k < steps.length - 1) {
          const want = String(st.tap).trim().toLowerCase();
          if (!labels(stepBlocks(target.data, st.state)).some(l => l.trim().toLowerCase() === want)) add('I5', screens, `Step ${k + 1} of the flow ${named(fl)} taps "${st.tap}", but nothing on that wireframe of ${named(target)} has that label.`, where);
        }
      });
      const covers = Array.isArray(x.covers) ? x.covers : [];
      if (!covers.length) add('I5', screens, `The flow ${named(fl)} doesn't list the rules it covers ("covers").`, where);
      checkCovers(screens, fl, covers);
    }
    if (spec) {
      const coverage = new Set(rulesCovered([...scrs, ...flows].flatMap(it => (Array.isArray(it.data?.covers) ? it.data.covers : []))));
      for (const r of rules) if (r.id && !coverage.has(r.id)) add('I6', screens, `The rule ${named(r)} is not covered by any screen or flow.`, r.id);
      const withFlow = new Set(flows.map(fl => findPersona(String(fl.data?.persona || ''))).filter(Boolean).map(p => /** @type {Item} */ (p).id || /** @type {Item} */ (p).title));
      for (const p of activePersonas) if (!withFlow.has(p)) add('I7', screens, `The persona ${p} has requirements but no flow.`, p);
      const want = specNames(spec);
      for (const key of /** @type {const} */ (['personas', 'rules'])) {
        const have = screens.data?.[key] && typeof screens.data[key] === 'object' ? screens.data[key] : {};
        const off = [...Object.keys(want[key]).filter(id => have[id] !== want[key][id]), ...Object.keys(have).filter(id => !(id in want[key]))];
        if (off.length) add('I9', screens, `${off.length} ${key === 'personas' ? 'persona name(s)' : 'rule title(s)'} differ from the spec (first: ${off[0]}). Run the check with --sync to copy them.`);
      }
      const listed = Array.isArray(screens.data?.cases) ? screens.data.cases : [];
      const wanted = specCases(spec);
      const key = (/** @type {any} */ c) => `${c?.rule} ${c?.example}`;
      const missing = wanted.filter(c => !listed.some((/** @type {any} */ l) => key(l) === key(c)));
      const stale = listed.filter((/** @type {any} */ l) => !wanted.some(c => key(c) === key(l)));
      if (missing.length || stale.length) add('I11', screens, `The case list is out of date with the spec (${missing.length} edge case(s) or error(s) missing, ${stale.length} no longer in the spec). Run the check with --sync.`);
      const flowIds = new Set(flows.map(f => f.id).filter(Boolean));
      for (const c of listed.filter((/** @type {any} */ l) => !stale.includes(l))) {
        const where = Array.isArray(c.where) ? c.where : [];
        const label = `The example "${short(String(c.example))}" (${c.rule})`;
        if (!where.length) { add('I11', screens, `${label} isn't placed yet: say where it shows (a screen, screen/state or flow).`, c.rule); continue; }
        for (const w of where) {
          const [sid, st] = String(w).split('/');
          const target = scrs.find(x => x.id === sid);
          const ok = st ? !!target && (st === 'default' || !!(target.data.states || {})[st]) : !!target || flowIds.has(sid);
          if (!ok) add('I11', screens, `${label} is placed at "${w}", which isn't a screen, state or flow in the index.`, c.rule);
        }
      }
    }
    if (isReady(screens)) for (const o of openItems(screens)) add('I10', screens, `${o}: a ready screen index has nothing left open. Answer it, or set status back to draft.`);
  }

  if (design) {
    const entries = design.items.filter(i => i.type === 'entry');
    if (screens && !screens.parseError) {
      const built = design.meta.index_version;
      if (!built) add('D1', design, 'Front matter is missing "index_version" (the screen index version this design was built from).');
      else if (screens.meta.version && built !== screens.meta.version) add('D1', design, `Built from screen index version ${built}, but the index is now version ${screens.meta.version}. Update the design spec.`);
      if (isReady(design) && !isReady(screens)) add('D1', design, 'The design spec is marked ready, but the screen index is still a draft. Keep the design spec a draft until the index is ready.');
      const scrs = screens.items.filter(i => i.type === 'screen');
      for (const e of entries) if (!scrs.some(s => (e.id && s.id === e.id) || s.title.toLowerCase() === e.title.toLowerCase())) add('F3', design, `The design entry ${named(e)} doesn't match a screen in the screen index.`, e.id || e.title);
      for (const s of scrs) {
        const entry = entries.find(e => (s.id && e.id === s.id) || e.title.toLowerCase() === s.title.toLowerCase());
        if (!entry) {
          add('D2', design, `The screen ${named(s)} has no design entry.`, s.id || s.title);
          continue;
        }
        const ef = fields(entry.own);
        const frames = ef.frames;
        if (!frames && !filled(ef.frame?.value || '')) {
          add('D3', design, `The screen ${named(s)} has no "- Frames:" list.`, s.id || s.title);
          continue;
        }
        if (!frames) continue;
        for (const st of statesToDraw(screens, s)) {
          const v = frames.sub[st];
          if (v === undefined) add('D3', design, `The screen ${named(s)} has no frame for the "${st}" state.`, s.id || s.title);
          else if (isNa(v) ? !naWithReason(v) : !filled(v)) add('D3', design, `The screen ${named(s)} "${st}" frame needs a link, or n/a with a reason.`, s.id || s.title);
        }
      }
    }
    const cases = design.items.filter(i => i.type === 'case');
    for (const c of cases) {
      const f = fields(c.own);
      const who = nameList(f.persona?.value || f.personas?.value || '');
      if (who.length !== 1) add('D4', design, `The case ${named(c)} must name exactly one persona (- Persona: …).`, c.id || c.title);
      checkPersonas(design, c, who);
      const covers = idList(f.covers?.value || '');
      if (!covers.length) add('D4', design, `The case ${named(c)} does not list the rules it covers (- Covers: rule ids).`, c.id || c.title);
      checkCovers(design, c, covers, true);
      if (!f.steps || (!f.steps.list.length && !filled(f.steps.value))) add('D4', design, `The case ${named(c)} has no "- Steps:".`, c.id || c.title);
      if (!filled(f.expect?.value || '') && !(f.expect?.list.length)) add('D4', design, `The case ${named(c)} has no "- Expect:".`, c.id || c.title);
    }
    if (spec) {
      const covered = new Set(cases.flatMap(c => idList(fields(c.own).covers?.value || '')));
      for (const r of rules) if (r.id && !covered.has(r.id)) add('D5', design, `The rule ${named(r)} has no acceptance case.`, r.id);
      const withCase = new Set(cases.flatMap(c => nameList(fields(c.own).persona?.value || '').map(findPersona).filter(Boolean).map(p => /** @type {Item} */ (p).id || /** @type {Item} */ (p).title)));
      for (const p of activePersonas) if (!withCase.has(p)) add('D6', design, `The persona ${p} has requirements but no acceptance case.`, p);
    }
  }

  return { findings, summary: summarize(docs, findings) };

  /** @param {Item} it @param {string} text */
  function vague(it, text) {
    if (!spec) return;
    const hits = VAGUE.filter(w => new RegExp(String.raw`(?<![\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\w-])`, 'i').test(text));
    if (hits.length) add('S9', spec, `The rule ${named(it)} uses vague wording (${hits.join(', ')}). Say what is measured or seen.`, it.id || it.title, 'warning');
  }
}

/** @param {Doc} screens */
function requiredStates(screens) {
  const required = (screens.meta.required_states || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return required.length ? required : DEFAULT_STATES;
}

/** The states of a screen that need a design: required ones that aren't n/a or unchanged, plus any extra drawn state. @param {Doc} screens @param {Item} s */
function statesToDraw(screens, s) {
  const x = s.data || {};
  const st = x.states || {};
  const required = STATELESS_TYPES.has(x.type) ? ['default'] : requiredStates(screens);
  const extra = Object.keys(st).filter(k => !required.includes(k) && Array.isArray(st[k]?.wireframe));
  return [...required.filter(k => k === 'default' || !(st[k]?.na !== undefined || st[k]?.unchanged !== undefined)), ...extra];
}

/** Every wireframe of a screen: its own and its states'. @param {any} x @returns {any[]} */
const wireframes = x => [x.wireframe, ...Object.values(x.states || {}).map((/** @type {any} */ v) => v?.wireframe)].filter(Array.isArray);
/** The block kinds used in a wireframe, including blocks nested in rows, columns and cards. @param {any[]} blocks @returns {string[]} */
function blockKinds(blocks) {
  return blocks.flatMap(b => {
    if (!Array.isArray(b)) return ['(not a block)'];
    const [k, a] = b;
    if (k === 'row' || k === 'card') return [k, ...blockKinds(Array.isArray(a) ? a : [])];
    if (k === 'cols') return [k, ...(Array.isArray(a) ? a : []).flatMap(c => blockKinds(Array.isArray(c) ? c : []))];
    if (k === 'radio') return [k, ...(Array.isArray(a) ? a : []).flatMap(o => (Array.isArray(o) ? blockKinds(o.slice(1)) : []))];
    return [String(k)];
  });
}
/** Every string in a JSON value. @param {any} v @returns {string[]} */
const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
/** A reason is a few real words. @param {any} v */
const reason = v => typeof v === 'string' && v.trim().length >= 3 && filled(v);

/** The wireframe a flow step shows: the state's own, or the screen's default. @param {any} x @param {string} [state] */
const stepBlocks = (x, state) => {
  const v = state && state !== 'default' ? (x.states || {})[state] : null;
  return Array.isArray(v?.wireframe) ? v.wireframe : Array.isArray(x.wireframe) ? x.wireframe : [];
};
/** Everything a flow step can tap in a wireframe; screen-index.html marks the same elements. @param {any[]} blocks @returns {string[]} */
function labels(blocks) {
  return blocks.flatMap(b => {
    if (!Array.isArray(b)) return [];
    const [k, a, c] = b;
    const str = (/** @type {any} */ v) => (v === undefined || v === null ? [] : [String(v)]);
    switch (k) {
      case 'btn': case 'h': case 'field': case 'select': case 'date': case 'days': case 'toggle': case 'check': return str(a);
      case 'row': case 'card': return labels(Array.isArray(a) ? a : []);
      case 'cols': return (Array.isArray(a) ? a : []).flatMap(col => labels(Array.isArray(col) ? col : []));
      case 'radio': return (Array.isArray(a) ? a : []).flatMap(o => (Array.isArray(o) ? [...str(o[0]), ...labels(o.slice(1))] : str(o)));
      case 'tabs': return (Array.isArray(a) ? a : []).map(String);
      case 'list': return (Array.isArray(a) ? a : []).flatMap(row => (Array.isArray(row) ? row.map(String) : str(row)));
      case 'menu': return ['More', ...(c ? (Array.isArray(a) ? a : []).map(String) : [])];
      default: return [];
    }
  });
}

/** Persona names and requirement and rule titles from the spec, by id, as the screen index shows them. @param {Doc} spec */
function specNames(spec) {
  /** @type {{ personas: Record<string, string>, rules: Record<string, string> }} */
  const out = { personas: {}, rules: {} };
  for (const it of spec.items) {
    if (!it.id) continue;
    if (it.type === 'persona') out.personas[it.id] = it.title;
    else if (it.type === 'requirement' || it.type === 'rule') out.rules[it.id] = it.title.replace(/\.$/, '');
  }
  return out;
}

/** Every edge case and error example in the spec (⚠️ or ❌), with the id of its rule. @param {Doc} spec */
function specCases(spec) {
  return spec.items.filter(i => i.type === 'rule' && i.id).flatMap(r => (r.examples || []).filter(e => EDGE_OR_ERROR.test(e)).map(e => ({ rule: /** @type {string} */ (r.id), example: e })));
}

/**
 * The screen index brought in line with the spec: persona names and rule titles
 * copied over, and the case list holding every edge case and error example, in
 * spec order, keeping where each one was already placed.
 * @param {string} html @param {Doc} spec
 */
export function syncIndexNames(html, spec) {
  const data = indexData(html);
  if (!data) return { text: html, changed: false };
  const want = specNames(spec);
  const old = Array.isArray(data.cases) ? data.cases : [];
  const cases = specCases(spec).map(c => {
    const prev = old.find((/** @type {any} */ o) => o?.rule === c.rule && o?.example === c.example);
    return { ...c, where: Array.isArray(prev?.where) ? prev.where : [] };
  });
  const before = JSON.stringify([data.personas, data.rules, data.cases]);
  data.personas = want.personas;
  data.rules = want.rules;
  data.cases = cases;
  const changed = JSON.stringify([data.personas, data.rules, data.cases]) !== before;
  return { text: changed ? withIndexData(html, data) : html, changed };
}

/** @param {any} q */
const questionOpen = q => !q || typeof q !== 'object' || unanswered(typeof q.answer === 'string' ? q.answer : '');

/**
 * What is still open in a file, one line each: the spec's unanswered questions and
 * lines marked (proposed) or (waiting on id:x); the screen index's unanswered questions.
 * @param {Doc} d @returns {string[]}
 */
function openItems(d) {
  if (d.kind === 'screens') return (Array.isArray(d.data?.questions) ? d.data.questions : []).filter(questionOpen).map((/** @type {any} */ q) => `Question for product: "${short(String(q?.question ?? q))}"`);
  if (d.kind !== 'spec') return [];
  const questions = d.items.filter(i => i.type === 'question' && unanswered(fields(i.own).answer?.value)).map(q => `Open question: ${named(q)}`);
  const marked = visible(d.text.split(/\r?\n/)).filter(l => PROPOSED.test(l)).map(l => {
    const text = l.replace(/^[\s#*>|-]+|\d+[.)]\s+|`id:[^`]*`/g, '').trim();
    return `${/\(waiting on/i.test(l) ? 'Waiting on a question' : 'Proposed'}: "${text.length > 140 ? text.slice(0, 137) + '…' : text}"`;
  });
  return [...questions, ...marked];
}

/** @param {Doc[]} docs @param {Finding[]} findings */
function summarize(docs, findings) {
  return ['spec', 'screens', 'design'].map(kind => {
    const d = docs.find(x => x.kind === kind);
    if (!d) return { kind, label: LABEL[/** @type {keyof typeof LABEL} */ (kind)], present: false };
    const mine = findings.filter(f => f.file === d.file);
    const errors = mine.filter(f => f.severity === 'error').length;
    const status = (d.meta.status || 'draft').toLowerCase();
    /** Not settled yet: unanswered questions, (proposed) and (waiting on …) items. A file can be error-free and still open. */
    const open = openItems(d);
    /** @type {Record<string, number>} */
    const counts = {};
    for (const it of d.items) if (it.type !== 'entry') counts[it.type] = (counts[it.type] || 0) + 1;
    const examples = d.items.reduce((n, it) => n + (it.examples?.length || 0), 0);
    if (examples) counts.example = examples;
    if (d.data) {
      const drawn = d.items.filter(i => i.type === 'screen').reduce((n, s) => n + statesToDraw(d, s).length, 0);
      if (drawn) counts.state = drawn;
    }
    return {
      kind, label: LABEL[/** @type {keyof typeof LABEL} */ (kind)], present: true, file: d.file, version: d.meta.version || '?', status,
      errors, warnings: mine.length - errors, open: open.length, openItems: open,
      counts: Object.fromEntries(Object.keys(COUNT_LABEL).filter(k => counts[k]).map(k => [k, counts[k]])),
      /** Nothing to fix and nothing open: ready to be agreed and marked ready. */
      complete: errors === 0 && open.length === 0,
      readyToHandOff: errors === 0 && open.length === 0 && status === 'ready',
    };
  });
}

/** The .md files a list of folders and files names. @param {string[]} targets */
function listFiles(targets) {
  /** @type {string[]} */
  const files = [];
  for (const t of targets) {
    const st = fs.statSync(t, { throwIfNoEntry: false });
    if (!st) throw new Error(`No such file or folder: ${t}`);
    if (st.isDirectory()) for (const name of fs.readdirSync(t).sort()) {
      if (/\.(md|html)$/.test(name)) files.push(path.join(t, name));
    }
    else files.push(t);
  }
  return files;
}

/** Load handoff files from folders or paths. Files without a known `kind` are skipped. @param {string[]} targets */
export function loadDocs(targets) {
  return listFiles(targets).map(f => parseDoc(f, fs.readFileSync(f, 'utf8'))).filter(d => d.kind);
}

const STOP = new Set('a an the to of for and or but can cant can\'t is are be by with their they them you your we our us in on at it its than that this so as from into when who whose what which where why how there should would could will do does dont don\'t not no once if any all get gets have has'.split(' '));
/** A short id made from a title: its first few meaningful words. @param {string} title @param {Set<string>} taken */
function idFor(title, taken) {
  const words = title.toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9\s'-]/g, ' ').split(/[\s-]+/).map(w => w.replace(/'/g, '')).filter(Boolean);
  const meaningful = words.filter(w => !STOP.has(w));
  const base = (meaningful.length ? meaningful : words).slice(0, 3).join('-') || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Add an id to every line that should have one and doesn't. Ids already in the
 * file are never changed. @param {string} text @param {Set<string>} [taken] ids already used in the feature's files
 */
export function addIds(text, taken = new Set()) {
  const { meta, head, body } = frontMatter(text);
  const kind = KINDS[/** @type {keyof typeof KINDS} */ ((meta.kind || '').toLowerCase())] || '';
  const lines = body.split('\n');
  const vis = visible(lines.map(l => l.replace(/\r$/, '')));
  let role = '';
  let seenHeading = false;
  let added = 0;
  vis.forEach((l, i) => {
    const sec = l.match(/^##\s+(.*)$/);
    if (sec) { role = sectionRole(kind, sec[1]); seenHeading = false; return; }
    if (!role || role === 'entries') return;
    const h3 = l.match(/^###\s+(.*)$/);
    let target = null;
    if (h3) { seenHeading = true; target = h3[1]; }
    else if (role === 'personas' && !seenHeading && /^[-*]\s+/.test(l)) target = personaTitle(l.replace(/^[-*]\s+/, ''));
    else if (role === 'requirements' && /^\d+[.)]\s+/.test(l)) target = l.replace(/^\d+[.)]\s+/, '');
    if (target === null || ID_TAG_ANY.test(l)) return;
    const eol = lines[i].endsWith('\r') ? '\r' : '';
    lines[i] = `${l.replace(/\s+$/, '')} \`id:${idFor(target.replace(PROPOSED, ''), taken)}\`${eol}`;
    added++;
  });
  return { text: head + lines.join('\n'), added };
}

/** Add an id to every screen and flow in a screen index that lacks one. @param {string} html @param {Set<string>} [taken] */
export function addIndexIds(html, taken = new Set()) {
  const data = indexData(html);
  let added = 0;
  for (const x of [...(data?.screens || []), ...(data?.flows || [])]) {
    if (x && !x.id) { x.id = idFor(String(x.title || 'item'), taken); added++; }
  }
  return { text: added ? withIndexData(html, data) : html, added };
}

/** Human-readable report. @param {ReturnType<typeof check>} res */
export function report({ findings, summary }) {
  const out = [];
  for (const s of summary) {
    if (!s.present) {
      out.push(`${s.label}: not started`);
      continue;
    }
    const counts = Object.entries(s.counts || {}).map(([k, n]) => `${n} ${COUNT_LABEL[/** @type {keyof typeof COUNT_LABEL} */ (k)]}`).join(', ');
    const kinds = [['question', /^(Open question|Question for product)/], ['proposal', /^Proposed/], ['waiting on a question', /^Waiting/]]
      .map(([name, re]) => [name, (s.openItems || []).filter((/** @type {string} */ o) => /** @type {RegExp} */ (re).test(o)).length])
      .filter(([, n]) => n).map(([name, n]) => `${n} ${name === 'waiting on a question' ? name : n === 1 ? name : name + 's'}`);
    const extras = [s.open ? `${s.open} still open (${kinds.join(', ')})` : '', s.warnings ? `${s.warnings} warning(s)` : ''].filter(Boolean).join(', ');
    const verdict = s.errors ? `${s.errors} to fix${extras ? `, ${extras}` : ''}`
      : s.open ? `well-formed, ${extras}`
      : `complete${extras ? `, ${extras}` : ''}${s.status === 'ready' ? '' : '; set status: ready once everyone agrees'}`;
    out.push(`${s.label} v${s.version} (${s.status}): ${verdict}${counts ? `  [${counts}]` : ''}`);
    for (const f of findings.filter(x => x.file === s.file)) out.push(`  ${f.severity === 'error' ? '✗' : '!'} ${f.rule} ${f.message}`);
    if (s.openItems?.length) {
      out.push('  Still open:');
      for (const o of s.openItems) out.push(`    - ${o}`);
    }
  }
  const present = summary.filter(s => s.present);
  const blocked = present.filter(s => !s.readyToHandOff);
  const why = (/** @type {any} */ s) => (s.errors ? `${s.errors} to fix` : s.open ? `${s.open} still open` : 'draft');
  out.push('');
  out.push(!present.length ? 'No handoff files found (front matter needs kind: spec | screen-index | design-spec).'
    : blocked.length ? `Not ready to hand off: ${blocked.map(s => `${s.label} (${why(s)})`).join(', ')}.`
    : `Ready to hand off: ${present.map(s => s.label).join(', ')}.`);
  return out.join('\n');
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const json = argv.includes('--json');
  const fix = argv.includes('--add-ids');
  const sync = argv.includes('--sync');
  const targets = argv.filter(a => !['--json', '--add-ids', '--sync'].includes(a));
  if (!targets.length) {
    console.error('usage: node check.mjs <folder or files…> [--add-ids] [--sync] [--json]');
    return 2;
  }
  let docs;
  try {
    if (fix) {
      const files = listFiles(targets).map(f => ({ f, text: fs.readFileSync(f, 'utf8') })).filter(x => parseDoc(x.f, x.text).kind);
      const taken = new Set(files.flatMap(x => parseDoc(x.f, x.text).items.map(i => i.id).filter(/** @returns {id is string} */ id => !!id)));
      for (const { f, text } of files) {
        const res = parseDoc(f, text).data ? addIndexIds(text, taken) : addIds(text, taken);
        if (!res.added) continue;
        fs.writeFileSync(f, res.text);
        if (!json) console.log(`Added ${res.added} id(s) to ${f}`);
      }
    }
    if (sync) {
      const spec = loadDocs(targets).find(d => d.kind === 'spec');
      for (const f of listFiles(targets).filter(x => /\.html?$/i.test(x))) {
        if (!spec) break;
        const res = syncIndexNames(fs.readFileSync(f, 'utf8'), spec);
        if (!res.changed) continue;
        fs.writeFileSync(f, res.text);
        if (!json) console.log(`Copied persona names, rule titles and edge cases from the spec into ${f}`);
      }
    }
    docs = loadDocs(targets);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const res = check(docs);
  console.log(json ? JSON.stringify(res, null, 2) : report(res));
  return res.findings.some(f => f.severity === 'error') || !docs.length ? 1 : 0;
}

// Run when called as a script. Compare real paths: /tmp and many home folders are symlinks on macOS.
const real = (/** @type {string} */ p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
