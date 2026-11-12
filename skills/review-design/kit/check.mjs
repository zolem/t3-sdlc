#!/usr/bin/env node
// @ts-check
// Completeness check for the role kit's handoff files: the product spec, the
// screen index and the design spec. It reads what the files declare and reports
// what is missing before a file can be handed to the next role.
//
// No dependencies, one file, Node 18+, so a skill can ship a copy and run it
// anywhere code can run. Agents that cannot run code apply the same rules by
// hand from FORMAT.md (kept in sync with RULES below by a test).
//
//   node check.mjs <folder or files…> [--add-ids] [--json]
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
/** Marks something the PM has not confirmed yet: "(proposed)" or "(proposed, see …)". */
const PROPOSED = /\(proposed\b[^)]*\)/i;
/** An id written last on its line: `id:seat-limit`. */
const ID_TAG_END = /\s*`id:([^`]*)`\s*$/;
const ID_TAG_ANY = /`id:([^`]*)`/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Example markers: ✅ normal case, ⚠️ edge case, ❌ error. */
const EDGE_OR_ERROR = /^(?:⚠|❌|✖|edge(?: case)?:|error:)/i;

/** Every rule, with the file it guards. FORMAT.md documents the same ids. */
export const RULES = {
  F1: { file: 'any', text: 'Front matter has kind, feature, version and status (draft or ready).' },
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
  S8: { file: 'spec', text: 'Every open question is answered, or has an owner and a due date. A spec is only ready to hand off with no unanswered questions and nothing still marked (proposed).' },
  S9: { file: 'spec', text: 'Rules and examples avoid vague words (fast, easy, intuitive…). Warning only.' },
  I1: { file: 'screens', text: 'The screen index names the spec version it was built from, and it matches the spec. It can only be ready if the spec is.' },
  I2: { file: 'screens', text: 'Every screen has a type, personas, an entry point, what it covers, and its states.' },
  I3: { file: 'screens', text: 'Every screen lists each required state, or marks it n/a with a reason.' },
  I4: { file: 'screens', text: 'Every interaction has a trigger and a result.' },
  I5: { file: 'screens', text: 'Every flow names one persona, steps through declared screens, and what it covers.' },
  I6: { file: 'screens', text: 'Every rule is covered by a screen or a flow (directly or through its requirement).' },
  I7: { file: 'screens', text: 'Every persona with requirements has at least one flow.' },
  D1: { file: 'design', text: 'The design spec names the screen index version it was built from, and it matches. It can only be ready if the index is.' },
  D2: { file: 'design', text: 'Every screen in the index has a design entry.' },
  D3: { file: 'design', text: 'Every required state of every screen has a frame link, or n/a with a reason.' },
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
const COUNT_LABEL = { persona: 'personas', requirement: 'requirements', rule: 'rules', example: 'examples', question: 'questions', screen: 'screens', interaction: 'interactions', flow: 'flows', case: 'acceptance cases' };
/** A template placeholder: <words>, not an HTML tag with attributes or a closing tag. */
const PLACEHOLDER_TAG = /<[A-Za-z][^<>=\/]*>/;

/**
 * @typedef {'persona' | 'requirement' | 'rule' | 'question' | 'screen' | 'interaction' | 'flow' | 'entry' | 'case'} ItemType
 * @typedef {{ type: ItemType, id: string | null, badId?: string, misplaced?: boolean, title: string, line: number, own: string[], parent?: string, examples?: string[], who?: string, priority?: string }} Item
 * @typedef {{ file: string, kind: string, meta: Record<string, string>, items: Item[], sections: { title: string, lines: string[] }[], text: string, raw: string }} Doc
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

/** Parse one handoff file. @param {string} file @param {string} text @returns {Doc} */
export function parseDoc(file, text) {
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
      for (const b of blocks) {
        const req = make('requirement', b.head, b.line, b.body);
        const firstRule = b.body.findIndex(l => /^\d+[.)]\s+/.test(l));
        const pre = (firstRule < 0 ? b.body : b.body.slice(0, firstRule)).join('\n');
        req.who = fieldIn(pre, 'who|personas?');
        req.priority = fieldIn(pre, 'priority');
        /** @type {Item | null} */
        let rule = null;
        b.body.forEach((l, i) => {
          const r = l.match(/^\d+[.)]\s+(.*)$/);
          if (r) { rule = make('rule', r[1], b.line + i + 1, [l], { parent: req.id || req.title, examples: [] }); return; }
          if (!rule) return;
          const ex = l.match(/^\s+[-*+]\s+(.*)$/);
          if (ex) rule.examples?.push(ex[1].trim());
          else if (/^\s{2,}\S/.test(l) && rule.examples?.length) rule.examples[rule.examples.length - 1] += ' ' + l.trim();
          else if (l.trim() && !/^\s/.test(l)) rule = null;
        });
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
    for (const k of ['kind', 'feature', 'version', 'status']) if (!d.meta[k]) add('F1', d, `Front matter is missing "${k}".`);
    if (d.meta.status && !['draft', 'ready'].includes(d.meta.status.toLowerCase())) add('F1', d, `status must be draft or ready (found "${d.meta.status}").`);
    for (const it of d.items) {
      if (!(it.type in DECLARES)) continue;
      if (!it.id) {
        add('F5', d, it.misplaced ? `${named(it)}: the id must come last on the line.`
          : it.badId !== undefined ? `${named(it)} has a malformed id (id:${it.badId}). Use lowercase words joined by hyphens.`
          : `The ${it.type} ${named(it)} has no id. Add \`id:short-name\` at the end of its line, or run with --add-ids.`, short(it.title));
        continue;
      }
      if (declared.has(it.id)) add('F2', d, `id:${it.id} is used more than once.`, it.id);
      else declared.set(it.id, it);
    }
    const hits = visible(d.raw.split(/\r?\n/)).filter(l => PLACEHOLDER_TAG.test(l)).map(l => l.trim());
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
    const ready = isReady(spec);
    for (const q of spec.items.filter(i => i.type === 'question')) {
      const f = fields(q.own);
      if (!unanswered(f.answer?.value)) continue;
      if (ready) add('S8', spec, `The question ${named(q)} is unanswered, and a ready spec has no open questions.`, q.id || q.title);
      else if (!filled(f.owner?.value || '') || !filled(f.due?.value || '')) add('S8', spec, `The question ${named(q)} needs an answer, or an owner and a due date.`, q.id || q.title);
    }
    if (ready) for (const l of proposedLines(spec)) add('S8', spec, `Still marked (proposed): "${short(l)}". Confirm it with the PM before the spec is ready.`);
  }

  if (screens) {
    if (spec) {
      const built = screens.meta.spec_version;
      if (!built) add('I1', screens, 'Front matter is missing "spec_version" (the spec version this index was built from).');
      else if (spec.meta.version && built !== spec.meta.version) add('I1', screens, `Built from spec version ${built}, but the spec is now version ${spec.meta.version}. Update the index.`);
      if (isReady(screens) && !isReady(spec)) add('I1', screens, 'The index is marked ready, but the spec is still a draft. Keep the index a draft until the spec is ready.');
    }
    const states = requiredStates(screens);
    const scrs = screens.items.filter(i => i.type === 'screen');
    for (const s of scrs) {
      const f = fields(s.own);
      const type = (f.type?.value || '').toLowerCase();
      for (const k of ['type', 'personas', 'entry', 'covers']) if (!filled(f[k]?.value || '') && !(k === 'personas' && filled(f.persona?.value || ''))) add('I2', screens, `${named(s)} is missing "- ${k[0].toUpperCase() + k.slice(1)}:".`, s.id || s.title);
      checkPersonas(screens, s, nameList(f.personas?.value || f.persona?.value || ''));
      checkCovers(screens, s, idList(f.covers?.value || ''));
      if (STATELESS_TYPES.has(type)) continue;
      if (!f.states) {
        add('I2', screens, `${named(s)} has no "- States:" list.`, s.id || s.title);
        continue;
      }
      for (const st of states) {
        const v = f.states.sub[st];
        if (v === undefined) add('I3', screens, `${named(s)} does not cover the "${st}" state (describe it, or "n/a — why").`, s.id || s.title);
        else if (isNa(v) ? !naWithReason(v) : !filled(v)) add('I3', screens, `${named(s)} state "${st}" needs a description, or n/a with a reason.`, s.id || s.title);
      }
    }
    for (const i of screens.items.filter(x => x.type === 'interaction')) {
      const f = fields(i.own);
      if (!filled(f.trigger?.value || '')) add('I4', screens, `The interaction ${named(i)} has no "- Trigger:".`, i.title);
      if (!filled(f.result?.value || '')) add('I4', screens, `The interaction ${named(i)} has no "- Result:".`, i.title);
    }
    const flows = screens.items.filter(i => i.type === 'flow');
    /** @param {string} step */
    const stepScreens = step => scrs.filter(s => (s.id && step.includes(s.id)) || step.toLowerCase().includes(s.title.toLowerCase()));
    for (const fl of flows) {
      const f = fields(fl.own);
      const who = nameList(f.persona?.value || f.personas?.value || '');
      if (who.length !== 1) add('I5', screens, `The flow ${named(fl)} must name exactly one persona (- Persona: …).`, fl.id || fl.title);
      checkPersonas(screens, fl, who);
      const steps = [f.steps?.value || '', ...(f.steps?.list || [])].filter(Boolean);
      if (!steps.some(st => stepScreens(st).length)) add('I5', screens, `The flow ${named(fl)} has no steps through declared screens (- Steps: then the screens it passes through, by title).`, fl.id || fl.title);
      const covers = idList(f.covers?.value || '');
      if (!covers.length) add('I5', screens, `The flow ${named(fl)} does not say what it covers (- Covers: rule ids).`, fl.id || fl.title);
      checkCovers(screens, fl, covers);
    }
    if (spec) {
      const coverage = new Set(rulesCovered([...scrs, ...flows].flatMap(it => idList(fields(it.own).covers?.value || ''))));
      for (const r of rules) if (r.id && !coverage.has(r.id)) add('I6', screens, `The rule ${named(r)} is not covered by any screen or flow.`, r.id);
      const withFlow = new Set(flows.flatMap(fl => nameList(fields(fl.own).persona?.value || '').map(findPersona).filter(Boolean).map(p => /** @type {Item} */ (p).id || /** @type {Item} */ (p).title)));
      for (const p of activePersonas) if (!withFlow.has(p)) add('I7', screens, `The persona ${p} has requirements but no flow.`, p);
    }
  }

  if (design) {
    const entries = design.items.filter(i => i.type === 'entry');
    if (screens) {
      const built = design.meta.index_version;
      if (!built) add('D1', design, 'Front matter is missing "index_version" (the screen index version this design was built from).');
      else if (screens.meta.version && built !== screens.meta.version) add('D1', design, `Built from screen index version ${built}, but the index is now version ${screens.meta.version}. Update the design spec.`);
      if (isReady(design) && !isReady(screens)) add('D1', design, 'The design spec is marked ready, but the screen index is still a draft. Keep the design spec a draft until the index is ready.');
      const scrs = screens.items.filter(i => i.type === 'screen');
      for (const e of entries) if (!scrs.some(s => (e.id && s.id === e.id) || s.title.toLowerCase() === e.title.toLowerCase())) add('F3', design, `The design entry ${named(e)} doesn't match a screen in the screen index.`, e.id || e.title);
      const states = requiredStates(screens);
      for (const s of scrs) {
        const entry = entries.find(e => (s.id && e.id === s.id) || e.title.toLowerCase() === s.title.toLowerCase());
        if (!entry) {
          add('D2', design, `The screen ${named(s)} has no design entry.`, s.id || s.title);
          continue;
        }
        const sf = fields(s.own);
        const type = (sf.type?.value || '').toLowerCase();
        const ef = fields(entry.own);
        const frames = ef.frames;
        if (!frames && !filled(ef.frame?.value || '')) {
          add('D3', design, `The screen ${named(s)} has no "- Frames:" list.`, s.id || s.title);
          continue;
        }
        if (STATELESS_TYPES.has(type) || !frames) continue;
        const indexStates = sf.states?.sub || {};
        for (const st of states) {
          if (indexStates[st] !== undefined && isNa(indexStates[st])) continue;
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

/** Lines still marked (proposed), outside code. @param {Doc} d */
function proposedLines(d) {
  return visible(d.text.split(/\r?\n/)).filter(l => PROPOSED.test(l)).map(l => l.replace(/^[\s#*>|-]+|\d+[.)]\s+/g, '').trim());
}

/** @param {Doc[]} docs @param {Finding[]} findings */
function summarize(docs, findings) {
  return ['spec', 'screens', 'design'].map(kind => {
    const d = docs.find(x => x.kind === kind);
    if (!d) return { kind, label: LABEL[/** @type {keyof typeof LABEL} */ (kind)], present: false };
    const mine = findings.filter(f => f.file === d.file);
    const errors = mine.filter(f => f.severity === 'error').length;
    const status = (d.meta.status || 'draft').toLowerCase();
    /** Still waiting on the PM: unanswered questions and unconfirmed (proposed) items. A file can be error-free and still waiting. */
    const open = kind !== 'spec' ? 0 : d.items.filter(i => i.type === 'question' && unanswered(fields(i.own).answer?.value)).length + proposedLines(d).length;
    /** @type {Record<string, number>} */
    const counts = {};
    for (const it of d.items) if (it.type !== 'entry') counts[it.type] = (counts[it.type] || 0) + 1;
    const examples = d.items.reduce((n, it) => n + (it.examples?.length || 0), 0);
    if (examples) counts.example = examples;
    return {
      kind, label: LABEL[/** @type {keyof typeof LABEL} */ (kind)], present: true, file: d.file, version: d.meta.version || '?', status,
      errors, warnings: mine.length - errors, open,
      counts: Object.fromEntries(Object.keys(COUNT_LABEL).filter(k => counts[k]).map(k => [k, counts[k]])),
      readyToHandOff: errors === 0 && open === 0,
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
      if (name.endsWith('.md')) files.push(path.join(t, name));
    }
    else files.push(t);
  }
  return files;
}

/** Load handoff files from folders or paths. Files without a known `kind` are skipped. @param {string[]} targets */
export function loadDocs(targets) {
  return listFiles(targets).map(f => parseDoc(f, fs.readFileSync(f, 'utf8'))).filter(d => d.kind);
}

const STOP = new Set('a an the to of for and or but can cant can\'t is are be by with their they them you your in on at it its than that this so as from into when who what how should do does dont don\'t not no once if any all'.split(' '));
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
    else if (role === 'requirements' && seenHeading && /^\d+[.)]\s+/.test(l)) target = l.replace(/^\d+[.)]\s+/, '');
    if (target === null || ID_TAG_ANY.test(l)) return;
    const eol = lines[i].endsWith('\r') ? '\r' : '';
    lines[i] = `${l.replace(/\s+$/, '')} \`id:${idFor(target.replace(PROPOSED, ''), taken)}\`${eol}`;
    added++;
  });
  return { text: head + lines.join('\n'), added };
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
    const extras = [s.open ? `${s.open} still open (unanswered questions or proposed items)` : '', s.warnings ? `${s.warnings} warning(s)` : ''].filter(Boolean).join(', ');
    const verdict = s.errors ? `${s.errors} to fix${extras ? `, ${extras}` : ''}` : s.open ? `well-formed, ${extras}` : `complete${extras ? `, ${extras}` : ''}`;
    out.push(`${s.label} v${s.version} (${s.status}): ${verdict}${counts ? `  [${counts}]` : ''}`);
    for (const f of findings.filter(x => x.file === s.file)) out.push(`  ${f.severity === 'error' ? '✗' : '!'} ${f.rule} ${f.message}`);
  }
  const present = summary.filter(s => s.present);
  const blocked = present.filter(s => !s.readyToHandOff);
  out.push('');
  out.push(!present.length ? 'No handoff files found (front matter needs kind: spec | screen-index | design-spec).'
    : blocked.length ? `Not ready to hand off: ${blocked.map(s => s.label).join(', ')}.`
    : `Ready to hand off: ${present.map(s => s.label).join(', ')}.`);
  return out.join('\n');
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const json = argv.includes('--json');
  const fix = argv.includes('--add-ids');
  const targets = argv.filter(a => a !== '--json' && a !== '--add-ids');
  if (!targets.length) {
    console.error('usage: node check.mjs <folder or files…> [--add-ids] [--json]');
    return 2;
  }
  let docs;
  try {
    if (fix) {
      const files = listFiles(targets).map(f => ({ f, text: fs.readFileSync(f, 'utf8') })).filter(x => parseDoc(x.f, x.text).kind);
      const taken = new Set(files.flatMap(x => parseDoc(x.f, x.text).items.map(i => i.id).filter(/** @returns {id is string} */ id => !!id)));
      for (const { f, text } of files) {
        const res = addIds(text, taken);
        if (!res.added) continue;
        fs.writeFileSync(f, res.text);
        if (!json) console.log(`Added ${res.added} id(s) to ${f}`);
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
