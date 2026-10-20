// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { explainerErrors, planPage, renderDiagram, stackPage } from '../src/lib/explainer.js';

const files = (/** @type {Record<string, string>} */ map) => ({
  exists: (/** @type {string} */ rel) => rel in map,
  read: (/** @type {string} */ rel) => map[rel],
  list: (/** @type {string} */ prefix) => Object.keys(map).filter(k => k.startsWith(prefix)),
  abs: (/** @type {string} */ rel) => `/runs/x/files/${rel}`,
});

const SLICES = [
  { n: 1, slug: 'pin-column', title: 'Pinned-at column', layer: 'data', summary: 'Adds notes.pinned_at and a 3-pin cap.', why: 'Everything else reads it.', ui: false, repo: 'notes', testCases: ['TC-PN-001', 'TC-PN-002'], spec: 'slices/01.md' },
  { n: 2, slug: 'pin-api', title: 'Pin and unpin endpoints', layer: 'api', summary: 'POST/DELETE /notes/:id/pin.', why: 'The UI calls these.', ui: false, repo: 'notes', dependsOn: [1], testCases: ['TC-PN-003'], spec: 'slices/02.md' },
  { n: 3, slug: 'pin-controls', title: 'Pin controls in the list', layer: 'ui', summary: 'Pin button, pinned section on top.', why: 'What users see.', ui: true, repo: 'notes', dependsOn: [2], testCases: ['TC-PN-004', 'TC-PN-005'], spec: 'slices/03.md' },
];
const TESTPLAN = '# Test plan\nTC-PN-001 TC-PN-002 TC-PN-003 TC-PN-004 TC-PN-005\n';
const SEQ_BEFORE = 'sequenceDiagram\n  participant U as User\n  participant W as Web\n  participant A as API\n  U->>W: open notes\n  W->>A: GET /notes\n  A-->>W: notes by date\n  W-->>U: list';
const SEQ_AFTER = 'sequenceDiagram\n  participant U as User\n  participant W as Web\n  participant A as API\n  U->>W: click pin\n  W->>A: POST /notes/1/pin\n  A->>A: cap check: at most 3 pinned\n  A-->>W: 200 or 409\n  W-->>U: pinned notes on top';
const FLOW = 'flowchart LR\n  L[Notes list] --> P[Pin button]\n  P --> E[POST /pin]\n  E --> C{Under cap?}\n  C --> DB[(notes.pinned_at)]\n  class P,E,C added\n  class L changed';

const PLAN = {
  intent: 'Let people pin up to three notes so the ones they use most stay on top.',
  outcome: 'Pinned notes show first in the list, in pin order. A fourth pin is refused with a clear message. We will know it works when pinned notes survive a reload.',
  needsYourCall: [{ title: 'Cap is 3 pins per user', detail: 'The brief says "a few". Three keeps the list short.', default: 'Ship with 3; it is one constant.' }],
  diagrams: [{ title: 'Pinning a note', caption: 'The new cap check happens in one transaction.', before: SEQ_BEFORE, after: SEQ_AFTER }, { title: 'Parts touched', after: FLOW }],
  slices: [
    { n: 1, story: 'The column and cap come first so the endpoints have something to write.', verify: ['the migration has a down step', 'the cap check and write share one transaction'] },
    { n: 2, story: 'Endpoints next, so the UI has a contract.', verify: ['409 body says why'] },
    { n: 3, story: 'Last, the button and pinned section.', verify: ['keyboard focus after pin'] },
  ],
  tests: [
    { id: 'TC-PN-001', what: 'A note can be pinned and unpinned.', why: 'The core promise.' },
    { id: 'TC-PN-002', what: 'A fourth pin is refused.', why: 'Without it the list fills with pins and the feature stops meaning anything.' },
    { id: 'TC-PN-003', what: 'Pinning someone else\'s note returns 404.', why: 'Ownership: otherwise anyone can reorder your list.' },
    { id: 'TC-PN-004', what: 'Pinned notes render above the rest.', why: 'The visible result users expect.' },
    { id: 'TC-PN-005', what: 'Pins survive a reload and the back button.', why: 'Only a browser shows stale client state.' },
  ],
  decisions: [{ choice: 'Store `pinned_at` on notes', why: 'Ordering by pin time is free.', alternatives: ['a separate pins table'] }],
  risks: [{ risk: 'Concurrent pins could exceed the cap', level: 'medium', mitigation: 'Count and write in one transaction.' }],
  engineering: [{ heading: 'API', items: ['`POST /notes/:id/pin` → 200 | 409 | 404', '`DELETE /notes/:id/pin` → 204'] }],
};

test('diagrams render offline to themed SVG and reject bad input', () => {
  const svg = renderDiagram(FLOW);
  assert.match(svg, /^<svg/);
  assert.doesNotMatch(svg, /googleapis/);
  assert.match(svg, /var\(--chart-2\)/, 'added nodes get the factory style');
  assert.throws(() => renderDiagram('not a diagram'), /must start with/);
});

test('plan JSON is validated against the run: every slice, every test case, renderable diagrams', () => {
  const ctx = { run: { id: 'r', title: 'Pin notes', slices: [], repos: { notes: {} } }, ...files({ 'slices.json': JSON.stringify({ slices: SLICES }), 'test-plan.md': TESTPLAN }) };
  assert.deepEqual(explainerErrors('plan', PLAN, ctx), []);
  const bad = { ...PLAN, slices: PLAN.slices.slice(0, 2), tests: PLAN.tests.slice(1), diagrams: [{ title: 'x', after: 'nope' }] };
  const errs = explainerErrors('plan', bad, ctx).join('\n');
  assert.match(errs, /missing slice 3/);
  assert.match(errs, /tests is missing: TC-PN-001/);
  assert.match(errs, /does not render/);
  const html = planPage(PLAN, ctx);
  assert.match(html, /Needs your call/);
  assert.match(html, /slice 3<\/td>/);
  assert.doesNotMatch(html, /<script/);
  if (process.env.EXPLAINER_OUT) fs.writeFileSync(`${process.env.EXPLAINER_OUT}/plan.html`, html);
});

test('stack page adds checks, fixes after review, accepted findings and screenshots from the run', () => {
  const run = {
    id: 'r', title: 'Pin notes', repos: { notes: {} }, feature: { round: 2, accepted: { round: 2, open: 1 } },
    slices: SLICES.map((s, i) => ({ ...s, branch: `orch/r/0${s.n}-${s.slug}`, headSha: `sha${i}`, tests: s.testCases.map(id => (id === 'TC-PN-005' ? { id, automated: false, why: 'needs a real reload' } : { id, automated: true, where: 'test/pin.test.ts' })) })),
    dispatches: [
      { role: 'manual-tester', status: 'done', target: { model: 'gpt-6-luna' }, report: { cases: PLAN.tests.map(t => ({ id: t.id, result: t.id === 'TC-PN-005' ? 'fail' : 'pass' })) } },
      { mode: 'feature-fix', status: 'done', report: { addressed: [{ id: 'A1', slice: 1, how: 'Moved the count into the insert transaction.' }] } },
    ],
  };
  const map = {
    'test-plan.md': TESTPLAN,
    'checks/sha0.json': JSON.stringify({ ok: true, checks: [{ id: 'lint', ok: true }, { id: 'test', ok: true }] }),
    'checks/sha1.json': JSON.stringify({ ok: true, checks: [{ id: 'lint', ok: true }, { id: 'test', ok: true }] }),
    'checks/sha2.json': JSON.stringify({ ok: true, checks: [{ id: 'lint', ok: true }, { id: 'test', ok: true }] }),
    'reviews/feature-r1.json': JSON.stringify({ blocking: [{ id: 'A1', severity: 'high', title: 'Cap race', detail: 'two tabs can pin a 4th', raisedBy: 'claude-opus-5-5', source: 'a' }], minor: [] }),
    'reviews/feature-r2.json': JSON.stringify({ by: { a: 'claude-opus-5-5' }, blocking: [{ id: 'B2', severity: 'medium', title: 'Unpin focus lost', detail: 'focus jumps to top', raisedBy: 'gpt-6.1-sol', source: 'b' }], minor: [{ id: 'A3', severity: 'low', title: 'Rename helper' }] }),
    'screenshots/feature.validate.r1/slice-3-pinned.png': 'x',
  };
  const doc = {
    built: 'People can pin up to three notes; pinned notes stay on top.', risk: { level: 2, why: 'small, one migration' },
    diagrams: [{ title: 'Pinning a note', before: SEQ_BEFORE, after: SEQ_AFTER }],
    slices: SLICES.map(s => ({ n: s.n, whatChanged: s.summary, whyThisWay: 'per architecture.md', verify: ['the transaction'], focus: ['src/notes/pin.ts:10-40'] })),
    tests: PLAN.tests, divergences: [], followUps: ['Drag to reorder pins'],
  };
  const ctx = { run, ...files(map) };
  assert.deepEqual(explainerErrors('stack', doc, ctx), []);
  assert.match(explainerErrors('stack', { ...doc, followUps: 'none' }, ctx).join('\n'), /followUps must be an array/, 'wrong shapes are rejected, not crashed on');
  const html = stackPage(doc, ctx);
  assert.match(html, /Accepted open finding: Unpin focus lost/);
  assert.match(html, /Fixed after review/);
  assert.match(html, /Moved the count into the insert transaction/);
  assert.match(html, /\/runs\/x\/files\/screenshots\/feature\.validate\.r1\/slice-3-pinned\.png/);
  assert.match(html, /3\/3/);
  assert.match(html, /4\/5<\/b><span>test cases passed/);
  assert.match(html, /manual only <span class="muted">needs a real reload/);
  if (process.env.EXPLAINER_OUT) fs.writeFileSync(`${process.env.EXPLAINER_OUT}/stack.html`, html);
});
