// @ts-check
// The explainer pages the human reads at the two gates. The model writes a small
// JSON document (explainers/<mode>.json): the judgment calls only, plus Mermaid
// before/after diagrams. The factory validates it, renders the diagrams to inline
// SVG (no network in the webview), and fills everything it already knows (slices,
// test coverage, checks, review results, screenshots) into one fixed template.

import { renderMermaidSVG } from 'beautiful-mermaid';
import { testCaseIds } from './contracts.js';
import { THEME_FALLBACK } from './theme.js';

/**
 * @typedef {{ run: any, exists: (rel: string) => boolean, read: (rel: string) => string, list: (prefix: string) => string[], abs: (rel: string) => string }} PageCtx
 */

const LEVELS = ['high', 'medium', 'low'];
const DIAGRAM_HEAD = /^\s*(sequenceDiagram|graph\s+(TD|TB|LR|RL|BT)|flowchart\s+(TD|TB|LR|RL|BT)|stateDiagram(-v2)?|erDiagram|classDiagram)\b/;
// Mark nodes `class X added` / `changed` / `removed` in flowcharts; the factory supplies the styles.
const CLASS_DEFS = ['classDef added stroke:var(--chart-2),stroke-width:2.5px', 'classDef changed stroke:var(--chart-3),stroke-width:2.5px', 'classDef removed stroke:var(--chart-5),stroke-width:2px,stroke-dasharray:5 4'];

/** @param {unknown} s */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
/** Escape, then allow `code` and **bold**. @param {unknown} s */
const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
/** @param {any[]} xs @param {(x: any) => string} f */
const each = (xs, f) => (xs || []).map(f).join('');
/** @param {string[] | undefined} xs */
const bullets = xs => (xs?.length ? `<ul>${each(xs, x => `<li>${md(x)}</li>`)}</ul>` : '');

/**
 * Render one Mermaid diagram to themed inline SVG. Throws with a readable message.
 * @param {string} src
 */
export function renderDiagram(src) {
  const text = String(src || '').trim();
  if (!DIAGRAM_HEAD.test(text)) throw new Error(`must start with sequenceDiagram, flowchart LR/TD, stateDiagram-v2, erDiagram or classDiagram (got "${text.split('\n')[0].slice(0, 40)}")`);
  const flow = /^\s*(graph|flowchart)\b/.test(text);
  const used = flow && /\bclass\s+[\w,\s]+\s+(added|changed|removed)\b|:::(added|changed|removed)\b/.test(text);
  const svg = renderMermaidSVG(used ? `${text}\n  ${CLASS_DEFS.join('\n  ')}` : text, {
    bg: 'var(--background)', fg: 'var(--foreground)', accent: 'var(--chart-1)', transparent: true,
  });
  if (!/<svg[\s>]/.test(svg)) throw new Error('did not render');
  // The page is shown offline; drop the web-font import and use the host font.
  return svg.replace(/@import url\([^)]*\);?/g, '').replace(/font-family:\s*'Inter'[^;]*;/g, 'font-family: var(--font-sans, system-ui, sans-serif);');
}

/** @param {unknown} v */
const str = v => typeof v === 'string' && v.trim().length > 0;

/**
 * @param {string} at @param {any} d @param {string[]} errors
 */
function diagramErrors(at, d, errors) {
  if (!d || typeof d !== 'object') return void errors.push(`${at} must be an object`);
  if (!str(d.title)) errors.push(`${at}.title is required`);
  if (!str(d.after)) errors.push(`${at}.after (Mermaid) is required`);
  for (const k of ['before', 'after']) {
    if (d[k] === undefined || d[k] === null || d[k] === '') continue;
    if (String(d[k]).split('\n').length > 40) errors.push(`${at}.${k} is over 40 lines; split it or drop detail (aim for 12 nodes or fewer)`);
    try {
      renderDiagram(d[k]);
    } catch (err) {
      errors.push(`${at}.${k} does not render: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Slices as planned (plan gate: slices.json) or built (stack gate: run.slices). @param {PageCtx} ctx */
function slicesOf(ctx) {
  if (ctx.run.slices?.length) return ctx.run.slices;
  return ctx.exists('slices.json') ? JSON.parse(ctx.read('slices.json')).slices || [] : [];
}

/** @param {PageCtx} ctx */
function planTestIds(ctx) {
  return ctx.exists('test-plan.md') ? testCaseIds(ctx.read('test-plan.md')) : [];
}

/**
 * Validate explainers/<mode>.json. Returns errors (empty when valid).
 * @param {'plan' | 'stack'} mode @param {any} doc @param {PageCtx} ctx
 */
export function explainerErrors(mode, doc, ctx) {
  /** @type {string[]} */
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`explainers/${mode}.json must be a JSON object`];
  const required = mode === 'plan' ? ['intent', 'outcome'] : ['built'];
  for (const k of required) if (!str(doc[k])) errors.push(`${k} is required (plain language)`);
  if (!Array.isArray(doc.diagrams) || doc.diagrams.length === 0) errors.push('diagrams needs at least one before/after diagram of how the system changes (a sequenceDiagram or flowchart)');
  else {
    doc.diagrams.forEach((/** @type {any} */ d, /** @type {number} */ i) => diagramErrors(`diagrams[${i}]`, d, errors));
    if (!doc.diagrams.some((/** @type {any} */ d) => /^\s*(sequenceDiagram|graph|flowchart)\b/.test(String(d?.after || '')))) errors.push('at least one diagram must be a sequenceDiagram or flowchart showing the changed flow');
  }
  const arrays = mode === 'plan' ? ['needsYourCall', 'decisions', 'risks', 'engineering'] : ['needsYourCall', 'divergences', 'followUps'];
  const shape = arrays.filter(k => doc[k] !== undefined && !Array.isArray(doc[k])).map(k => `${k} must be an array (use [] when there is nothing)`);
  if (shape.length) return [...errors, ...shape];
  for (const [i, n] of (doc.needsYourCall || []).entries()) if (!str(n?.title) || !str(n?.detail)) errors.push(`needsYourCall[${i}] needs title and detail`);
  for (const k of ['divergences', 'followUps']) for (const [i, x] of (doc[k] || []).entries()) if (!str(x)) errors.push(`${k}[${i}] must be a non-empty string`);
  for (const [i, e] of (doc.engineering || []).entries()) if (!str(e?.heading) || !Array.isArray(e?.items)) errors.push(`engineering[${i}] needs heading and items: string[]`);
  for (const [i, d] of (doc.decisions || []).entries()) if (d?.alternatives !== undefined && !Array.isArray(d.alternatives)) errors.push(`decisions[${i}].alternatives must be an array`);

  const slices = slicesOf(ctx);
  const cards = new Map((Array.isArray(doc.slices) ? doc.slices : []).map((/** @type {any} */ c) => [Number(c?.n), c]));
  if (!Array.isArray(doc.slices)) errors.push('slices must be an array with one entry per slice');
  for (const s of slices) {
    const c = cards.get(s.n);
    if (!c) {
      errors.push(`slices is missing slice ${s.n} (${s.title})`);
      continue;
    }
    if (mode === 'plan' && !str(c.story)) errors.push(`slices[n=${s.n}].story is required: why it comes here and what it unlocks`);
    if (mode === 'stack' && (!str(c.whatChanged) || !str(c.whyThisWay))) errors.push(`slices[n=${s.n}] needs whatChanged and whyThisWay`);
    if (!Array.isArray(c.verify) || c.verify.length === 0) errors.push(`slices[n=${s.n}].verify needs 1-4 concrete things a reviewer should check`);
    if (c.focus !== undefined && !Array.isArray(c.focus)) errors.push(`slices[n=${s.n}].focus must be an array of paths`);
  }
  for (const n of cards.keys()) if (!slices.some((/** @type {any} */ s) => s.n === n)) errors.push(`slices has n=${n}, which is not a slice in this run`);

  const tcs = planTestIds(ctx);
  const tests = new Map((Array.isArray(doc.tests) ? doc.tests : []).filter((/** @type {any} */ t) => t && typeof t === 'object').map((/** @type {any} */ t) => [t.id, t]));
  if (!Array.isArray(doc.tests)) errors.push('tests must list every test case: { id, what, why }');
  const missing = tcs.filter(id => !tests.has(id));
  if (missing.length) errors.push(`tests is missing: ${missing.join(', ')}`);
  for (const [id, t] of tests) {
    if (!tcs.includes(id)) errors.push(`tests has "${id}", which is not in test-plan.md`);
    else if (!str(t.what) || !str(t.why)) errors.push(`tests ${id} needs what (the behaviour, in plain words) and why (what would go wrong without it)`);
  }
  if (mode === 'plan') {
    for (const [i, r] of (doc.risks || []).entries()) if (!str(r?.risk) || !LEVELS.includes(r?.level)) errors.push(`risks[${i}] needs risk and level (${LEVELS.join('|')})`);
    for (const [i, d] of (doc.decisions || []).entries()) if (!str(d?.choice) || !str(d?.why)) errors.push(`decisions[${i}] needs choice and why`);
  } else if (doc.risk && !(Number.isInteger(doc.risk.level) && doc.risk.level >= 1 && doc.risk.level <= 5)) errors.push('risk.level must be an integer 1-5');
  return errors;
}

const CSS = `
:root{color-scheme:light dark}
body{font-family:var(--font-sans,system-ui,sans-serif);color:var(--foreground);margin:0;line-height:1.5;font-size:14px}
h1{font-size:20px;margin:0 0 6px;font-weight:650}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-foreground);margin:26px 0 10px;font-weight:600}
h3{font-size:15px;margin:0;font-weight:600}
p{margin:6px 0}.lead{font-size:15px}.muted{color:var(--muted-foreground)}
code{font-family:var(--font-mono,ui-monospace,monospace);font-size:12.5px;background:color-mix(in srgb,var(--foreground) 7%,transparent);padding:1px 4px;border-radius:4px}
.card{border:1px solid var(--border);border-radius:var(--radius,8px);padding:12px 14px;margin:10px 0;background:var(--card,transparent)}
.call{border-left:3px solid var(--chart-4)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{border:1px solid var(--border);border-radius:var(--radius,8px);padding:10px 12px}
.kpi b{display:block;font-size:20px;font-weight:650}.kpi span{color:var(--muted-foreground);font-size:12px}
.chip{display:inline-block;font-size:11.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--border);color:var(--muted-foreground);margin-right:4px;white-space:nowrap}
.chip.ok{color:var(--chart-2);border-color:color-mix(in srgb,var(--chart-2) 50%,transparent)}
.chip.bad{color:var(--chart-5);border-color:color-mix(in srgb,var(--chart-5) 50%,transparent)}
.chip.warn{color:var(--chart-4);border-color:color-mix(in srgb,var(--chart-4) 50%,transparent)}
.diagram{overflow-x:auto}.diagram svg{max-width:100%;height:auto}
.diagram .label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-foreground);margin-bottom:4px}
.legend{font-size:12px;color:var(--muted-foreground)}.legend i{display:inline-block;width:14px;height:0;border-top:2.5px solid;vertical-align:middle;margin:0 4px 0 10px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{color:var(--muted-foreground);font-weight:600;font-size:12px}td code{white-space:nowrap}
ul{margin:6px 0;padding-left:18px}li{margin:3px 0}
.verify{margin-top:8px}.verify b{font-size:12px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.05em}
.shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.shots figure{margin:0;max-width:280px}.shots img{max-width:100%;border:1px solid var(--border);border-radius:6px}.shots figcaption{font-size:11.5px;color:var(--muted-foreground)}
details{margin-top:24px}summary{cursor:pointer;color:var(--muted-foreground);font-weight:600}
`;

/** @param {string} title @param {string} body */
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${THEME_FALLBACK}${CSS}</style></head><body>${body}</body></html>`;

/** @param {any[]} diagrams */
function diagramsHtml(diagrams) {
  const marked = diagrams.some(d => /\b(added|changed|removed)\b/.test(`${d.before || ''}${d.after}`));
  return each(diagrams, d => {
    const panes = [d.before ? ['Before', d.before] : null, [d.before ? 'After' : '', d.after]].filter(Boolean);
    return `<div class="card"><h3>${md(d.title)}</h3>${d.caption ? `<p class="muted">${md(d.caption)}</p>` : ''}<div class="grid">${each(panes, ([label, src]) => {
      let svg;
      try {
        svg = renderDiagram(src);
      } catch (err) {
        svg = `<pre>${esc(src)}</pre>`;
      }
      return `<div class="diagram">${label ? `<div class="label">${label}</div>` : ''}${svg}</div>`;
    })}</div></div>`;
  }) + (marked ? '<p class="legend">Highlighted:<i style="color:var(--chart-2)"></i>added<i style="color:var(--chart-3)"></i>changed<i style="color:var(--chart-5);border-top-style:dashed"></i>removed</p>' : '');
}

/** Stack order as a small flowchart: dependency edges, one lane per repo. @param {any[]} slices */
function stackDiagram(slices) {
  const repos = [...new Set(slices.map(s => s.repo).filter(Boolean))];
  const label = (/** @type {any} */ s) => `S${s.n}["${s.n}. ${String(s.title).replace(/"/g, "'")}"]`;
  const lines = ['flowchart LR'];
  if (repos.length > 1) {
    for (const r of repos) lines.push(`  subgraph ${r.replace(/[^\w]/g, '_')}["${r}"]`, ...slices.filter(s => s.repo === r).map(s => `    ${label(s)}`), '  end');
  } else lines.push(...slices.map(s => `  ${label(s)}`));
  const edges = new Set();
  slices.forEach((s, i) => {
    const prev = slices.slice(0, i).reverse().find(p => p.repo === s.repo);
    if (prev) edges.add(`  S${prev.n} --> S${s.n}`);
    for (const d of s.dependsOn || []) if (slices.find(p => p.n === d)?.repo !== s.repo) edges.add(`  S${d} -.-> S${s.n}`);
  });
  lines.push(...edges);
  try {
    return `<div class="diagram">${renderDiagram(lines.join('\n'))}</div>`;
  } catch {
    return '';
  }
}

/** @param {any} s @param {Map<string, any>} tests */
function caseRows(s, tests) {
  return (s.testCases || []).map((/** @type {string} */ id) => ({ id, t: tests.get(id), auto: (s.tests || []).find((/** @type {any} */ x) => x.id === id) }));
}

/**
 * The plan gate page.
 * @param {any} doc @param {PageCtx} ctx
 */
export function planPage(doc, ctx) {
  const { run } = ctx;
  const slices = slicesOf(ctx);
  const tests = new Map((doc.tests || []).map((/** @type {any} */ t) => [t.id, t]));
  const cards = new Map((doc.slices || []).map((/** @type {any} */ c) => [Number(c.n), c]));
  const owner = new Map(slices.flatMap((/** @type {any} */ s) => caseRows(s, tests).map(r => [r.id, { s }])));
  const multi = Object.keys(run.repos || {}).length > 1;
  const body = `
<h1>${esc(run.title)}</h1>
<p class="lead">${md(doc.intent)}</p>
<p>${md(doc.outcome)}</p>
${doc.needsYourCall?.length ? `<h2>Needs your call</h2>${each(doc.needsYourCall, n => `<div class="card call"><h3>${md(n.title)}</h3><p>${md(n.detail)}</p>${n.default ? `<p class="muted">If nobody objects: ${md(n.default)}</p>` : ''}</div>`)}` : ''}
<h2>How the system changes</h2>
${diagramsHtml(doc.diagrams || [])}
<h2>The plan, in order</h2>
${stackDiagram(slices)}
${each(slices, s => {
    const c = cards.get(s.n) || {};
    const rows = caseRows(s, tests);
    return `<div class="card"><h3>${s.n}. ${md(s.title)}</h3><p>${multi ? `<span class="chip">${esc(s.repo)}</span>` : ''}<span class="chip">${esc(s.layer)}</span>${s.ui ? '<span class="chip warn">users see this</span>' : ''}</p><p>${md(s.summary)}</p><p class="muted">${md(c.story || s.why)}</p>${rows.length ? `<p class="muted">Tests: ${rows.map(r => `<code>${esc(r.id)}</code>`).join(', ')}</p>` : ''}<div class="verify"><b>Verify</b>${bullets(c.verify)}</div></div>`;
  })}
<h2>Tests, and why each exists</h2>
<p class="muted">Every case is run through by the manual tester once the feature is built; each engineer decides which of their cases to automate against regressions.</p>
<table><tr><th>Test</th><th>What it proves</th><th>Why we need it</th><th>Slice</th></tr>
${each(doc.tests || [], t => {
    const o = owner.get(t.id);
    return `<tr><td><code>${esc(t.id)}</code></td><td>${md(t.what)}</td><td>${md(t.why)}</td><td>${o ? `slice ${o.s.n}` : '<span class="chip bad">unassigned</span>'}</td></tr>`;
  })}</table>
${doc.decisions?.length ? `<h2>Decisions</h2><table><tr><th>Choice</th><th>Why</th><th>Alternatives</th></tr>${each(doc.decisions, d => `<tr><td>${md(d.choice)}</td><td>${md(d.why)}</td><td>${md((d.alternatives || []).join('; '))}</td></tr>`)}</table>` : ''}
${doc.risks?.length ? `<h2>Risks</h2>${each([...doc.risks].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)), r => `<div class="card"><span class="chip ${r.level === 'high' ? 'bad' : r.level === 'medium' ? 'warn' : ''}">${esc(r.level)}</span> ${md(r.risk)}${r.mitigation ? `<p class="muted">${md(r.mitigation)}</p>` : ''}</div>`)}` : ''}
<details><summary>For engineers</summary>
${each(doc.engineering || [], e => `<h2>${md(e.heading)}</h2>${bullets(e.items)}`)}
<h2>Run files</h2><p class="muted">Run <code>${esc(run.id)}</code>: <code>requirements.md</code>, <code>context.md</code>, <code>architecture.md</code>, <code>test-plan.md</code>, <code>slices.json</code>.</p>
</details>`;
  return page(`Plan: ${run.title}`, body);
}

/** Checks recorded on a commit. @param {PageCtx} ctx @param {string | null} sha */
function checksOf(ctx, sha) {
  if (!sha || !ctx.exists(`checks/${sha}.json`)) return null;
  return JSON.parse(ctx.read(`checks/${sha}.json`));
}

/** What the fix rounds changed, per slice: the feature-fix reports' addressed entries with the finding they answer. @param {PageCtx} ctx */
function troubleSpots(ctx) {
  const { run } = ctx;
  /** @type {Map<number, any[]>} */
  const out = new Map();
  /** @type {Map<string, any>} */
  const findings = new Map();
  for (let r = 1; ctx.exists(`reviews/feature-r${r}.json`); r++) for (const f of JSON.parse(ctx.read(`reviews/feature-r${r}.json`)).blocking || []) findings.set(f.id, f);
  for (const d of run.dispatches.filter((/** @type {any} */ x) => x.mode === 'feature-fix' && x.status === 'done')) {
    for (const a of d.report.addressed || []) {
      const n = Number(a.slice);
      if (!out.has(n)) out.set(n, []);
      out.get(n)?.push({ ...a, finding: findings.get(a.id) });
    }
  }
  return out;
}

/**
 * The PR stack gate page.
 * @param {any} doc @param {PageCtx} ctx
 */
export function stackPage(doc, ctx) {
  const { run } = ctx;
  const slices = run.slices;
  const multi = Object.keys(run.repos || {}).length > 1;
  const tests = new Map((doc.tests || []).map((/** @type {any} */ t) => [t.id, t]));
  const cards = new Map((doc.slices || []).map((/** @type {any} */ c) => [Number(c.n), c]));
  const owner = new Map(slices.flatMap((/** @type {any} */ s) => caseRows(s, tests).map(r => [r.id, { s, auto: r.auto }])));
  const review = ctx.exists(`reviews/feature-r${run.feature.round}.json`) ? JSON.parse(ctx.read(`reviews/feature-r${run.feature.round}.json`)) : { blocking: [], minor: [] };
  const checks = new Map(slices.map((/** @type {any} */ s) => [s.n, checksOf(ctx, s.headSha)]));
  const passing = [...checks.values()].filter(c => c?.ok).length;
  const validated = run.dispatches.filter((/** @type {any} */ d) => d.role === 'manual-tester' && d.status === 'done');
  const lastValidation = validated[validated.length - 1];
  // Latest result per case across the run-throughs (a re-check only re-runs some cases).
  /** @type {Map<string, any>} */
  const results = new Map();
  for (const d of validated) for (const c of d.report?.cases || []) results.set(c.id, c);
  const browserOpen = review.blocking.filter((/** @type {any} */ f) => f.source === 'validate').length;
  const spots = troubleSpots(ctx);
  const shots = ctx.list('screenshots/').filter(p => /\.(png|jpe?g|gif|webp)$/i.test(p));
  const accepted = run.feature.accepted ? review.blocking : [];
  const calls = [
    ...accepted.map((/** @type {any} */ f) => ({ title: `Accepted open finding: ${f.title}`, detail: `${f.severity} — ${f.detail}${f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : ''}. Raised by ${f.raisedBy}.`, default: 'Ships as is unless you request changes.' })),
    ...(doc.needsYourCall || []),
  ];
  const risk = doc.risk?.level;
  const body = `
<h1>${esc(run.title)}</h1>
<p class="lead">${md(doc.built)}</p>
<div class="kpis">
<div class="kpi"><b>${risk ? `${risk}/5` : '—'}</b><span>review risk${doc.risk?.why ? `: ${md(doc.risk.why)}` : ''}</span></div>
<div class="kpi"><b>${passing}/${slices.length}</b><span>slices with passing checks on their final commit</span></div>
<div class="kpi"><b>${review.blocking.length ? `${review.blocking.length} open` : 'clean'}</b><span>feature review after ${Math.max(0, run.feature.round - 1)} fix round(s); ${review.minor.length} minor follow-up(s)</span></div>
<div class="kpi"><b>${lastValidation ? `${[...results.values()].filter(c => c.result === 'pass').length}/${(doc.tests || []).length}` : 'skipped'}</b><span>test cases passed in the browser run-through${lastValidation ? ` (${esc(lastValidation.target.model)})` : ''}${browserOpen ? `; ${browserOpen} open issue(s)` : ''}</span></div>
<div class="kpi"><b>${slices.flatMap((/** @type {any} */ s) => s.tests || []).filter((/** @type {any} */ x) => x.automated).length}/${(doc.tests || []).length}</b><span>test cases automated against regressions</span></div>
</div>
${calls.length ? `<h2>Needs your call</h2>${each(calls, n => `<div class="card call"><h3>${md(n.title)}</h3><p>${md(n.detail)}</p>${n.default ? `<p class="muted">If nobody objects: ${md(n.default)}</p>` : ''}</div>`)}` : ''}
<h2>How the system changed</h2>
${diagramsHtml(doc.diagrams || [])}
<h2>The PR stack, bottom up</h2>
${stackDiagram(slices)}
${each(slices, s => {
    const c = cards.get(s.n) || {};
    const chk = checks.get(s.n);
    const mine = shots.filter(p => p.split('/').pop()?.startsWith(`slice-${s.n}-`));
    const fixed = spots.get(s.n) || [];
    return `<div class="card"><h3>${s.n}. ${md(s.title)}</h3>
<p>${multi ? `<span class="chip">${esc(s.repo)}</span>` : ''}<code>${esc(s.branch)}</code> ${chk ? each(chk.checks || [], (/** @type {any} */ x) => `<span class="chip ${x.ok ? 'ok' : 'bad'}">${esc(x.id)}</span>`) : '<span class="chip warn">no checks recorded</span>'}</p>
<p>${md(c.whatChanged)}</p><p class="muted">${md(c.whyThisWay)}</p>
${c.focus?.length ? `<p class="muted">Start with ${c.focus.map((/** @type {string} */ f) => `<code>${esc(f)}</code>`).join(', ')}</p>` : ''}
<div class="verify"><b>Verify</b>${bullets(c.verify)}</div>
${fixed.length ? `<div class="verify"><b>Fixed after review</b><ul>${each(fixed, a => `<li>${a.finding ? `${md(a.finding.title)} <span class="muted">(${esc(a.finding.severity)}, ${esc(a.finding.raisedBy)})</span>: ` : `<code>${esc(a.id)}</code>: `}${md(a.how)}</li>`)}</ul></div>` : ''}
${c.rewrittenLater ? `<p class="muted">Rewritten later in the stack: ${md(c.rewrittenLater)}</p>` : ''}
${mine.length ? `<div class="shots">${each(mine, p => `<figure><img src="${esc(ctx.abs(p))}" alt=""><figcaption>${esc(p.split('/').pop())}</figcaption></figure>`)}</div>` : ''}
</div>`;
  })}
<h2>Tests, and why each exists</h2>
<table><tr><th>Test</th><th>What it proves</th><th>Why we need it</th><th>Regression protection</th><th>Run-through</th></tr>
${each(doc.tests || [], t => {
    const o = owner.get(t.id);
    const r = results.get(t.id);
    const run_ = r ? `<span class="chip ${r.result === 'pass' ? 'ok' : r.result === 'fail' ? 'bad' : 'warn'}">${esc(r.result)}</span>${r.note ? ` <span class="muted">${md(r.note)}</span>` : ''}` : '<span class="chip warn">not run</span>';
    const how = !o ? '—' : o.auto?.automated ? `automated <span class="muted">${md(o.auto.where)}</span>${checks.get(o.s.n)?.ok ? ' <span class="chip ok">passing</span>' : ' <span class="chip bad">no passing run</span>'}` : o.auto ? `manual only <span class="muted">${md(o.auto.why)}</span>` : '—';
    return `<tr><td><code>${esc(t.id)}</code></td><td>${md(t.what)}</td><td>${md(t.why)}</td><td>slice ${o ? o.s.n : '?'}: ${how}</td><td>${run_}</td></tr>`;
  })}</table>
${doc.divergences?.length ? `<h2>Different from the plan</h2>${bullets(doc.divergences)}` : ''}
${doc.followUps?.length || review.minor.length ? `<h2>Follow-ups</h2>${bullets(doc.followUps)}${review.minor.length ? `<ul>${each(review.minor, f => `<li><span class="chip">${esc(f.severity)}</span>${md(f.title)}${f.file ? ` <code>${esc(f.file)}</code>` : ''}</li>`)}</ul>` : ''}` : ''}
<details><summary>Review details</summary>
<p class="muted">Panel: ${esc(Object.values((ctx.exists('reviews/feature-r1.json') ? JSON.parse(ctx.read('reviews/feature-r1.json')).by : review.by) || {}).join(', ') || 'n/a')}. Review rounds: ${run.feature.round}. Run <code>${esc(run.id)}</code>.</p>
</details>`;
  return page(`PR stack: ${run.title}`, body);
}
