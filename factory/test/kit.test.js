// @ts-check
// The role kit: handoff checker, its documentation, the skill copies and the install guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, addIds, check, loadDocs, parseDoc } from '../../kit/check.mjs';
import { kitFiles, kitSkills } from '../../scripts/sync-kit.mjs';
import { SKILLS } from '../src/lib/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE = path.join(ROOT, 'examples/acme/handoff');
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Check the example with some files edited. @param {Record<string, (text: string) => string>} edits */
function checkEdited(edits) {
  const docs = ['spec.md', 'screen-index.md', 'design-spec.md'].map(name => {
    let text = fs.readFileSync(path.join(EXAMPLE, name), 'utf8');
    if (edits[name]) {
      const next = edits[name](text);
      assert.notEqual(next, text, `edit to ${name} changed nothing`);
      text = next;
    }
    return parseDoc(name, text);
  });
  return check(docs).findings;
}

test('the Acme example is a complete handoff with no warnings', () => {
  const { findings, summary } = check(loadDocs([EXAMPLE]));
  assert.deepEqual(findings, []);
  assert.deepEqual(summary.map(s => s.readyToHandOff), [true, true, true]);
});

const BREAKS = /** @type {[string, string, Record<string, (t: string) => string>][]} */ ([
  ['F1', 'status is not draft or ready', { 'spec.md': t => t.replace('status: ready', 'status: done') }],
  ['F2', 'an id used twice', { 'spec.md': t => t.replace('`id:resend`', '`id:revoke`') }],
  ['F3', 'a screen covering an id the spec lacks', { 'screen-index.md': t => t.replace('- Covers: revoke\n', '- Covers: revoke, no-such-rule\n') }],
  ['F3', 'a screen naming an unknown persona', { 'screen-index.md': t => t.replace('- Personas: member\n', '- Personas: guest\n') }],
  ['F3', 'a case covering a requirement instead of rules', { 'design-spec.md': t => t.replace('- Covers: resend\n', '- Covers: manage-pending\n') }],
  ['F4', 'a template placeholder is left', { 'spec.md': t => t.replace('Uses a laptop, mostly Chrome.', '<where they use the product>') }],
  ['F5', 'a rule without an id', { 'spec.md': t => t.replace(' `id:seat-limit`', '') }],
  ['F5', 'an id that is not last on its line', { 'spec.md': t => t.replace("2. You can't invite more people than you have free seats. `id:seat-limit`", "2. `id:seat-limit` You can't invite more people than you have free seats.") }],
  ['F5', 'a malformed id', { 'spec.md': t => t.replace('`id:seat-limit`', '`id:Seat Limit`') }],
  ['S1', 'an empty required section', { 'spec.md': t => t.replace(/(## Rollout\n)[\s\S]*?(?=## Out of scope)/, '$1\n') }],
  ['S2', 'no personas', { 'spec.md': t => t.replace(/^- \*\*(Workspace owner|Workspace member|Invited person)\*\*.*\n/gm, '') }],
  ['S3', 'a requirement without a priority', { 'spec.md': t => t.replace(' · **Priority:** should', '') }],
  ['S3', 'a requirement for someone who is not a persona', { 'spec.md': t => t.replace('**Who:** Invited person', '**Who:** Guest') }],
  ['S4', 'a rule without examples', { 'spec.md': t => t.replace(/(2\. An invite can be resent[^\n]*\n)(?: {3}- [^\n]*\n)+/, '$1') }],
  ['S5', 'an example that does not say what happens', { 'spec.md': t => t.replace('the owner enters 2 addresses → Send invites works.', 'the owner enters 2 addresses and Send invites works.') }],
  ['S6', 'a requirement with only happy-path examples', { 'spec.md': t => t.replace('⚠️ The owner chooses Revoke, then Cancel', '✅ The owner chooses Revoke, then Cancel').replace('⚠️ The owner resent it a minute ago', '✅ The owner resent it a minute ago') }],
  ['S7', 'a persona missing from the permissions table', { 'spec.md': t => t.replace('| Workspace member | Invited person |', '| Workspace member | Guest |') }],
  ['S8', 'an unanswered question in a ready spec', { 'spec.md': t => t.replace('- Answer: 14 days, matching the password reset link.\n', '') }],
  ['S8', '"not decided yet" in a ready spec', { 'spec.md': t => t.replace('- Answer: 14 days, matching the password reset link.', '- Answer: not decided yet') }],
  ['S8', 'a (proposed) item in a ready spec', { 'spec.md': t => t.replace('3. Old or revoked links say what to do next.', '3. Old or revoked links say what to do next (proposed).') }],
  ['S9', 'vague wording in an example', { 'spec.md': t => t.replace('within 1 minute', 'quickly') }],
  ['I1', 'a stale spec version', { 'screen-index.md': t => t.replace('spec_version: 2', 'spec_version: 1') }],
  ['I1', 'a ready index built on a draft spec', { 'spec.md': t => t.replace('status: ready', 'status: draft') }],
  ['I2', 'a screen without an entry point', { 'screen-index.md': t => t.replace('- Entry: Invite people on the Members page\n', '') }],
  ['I3', 'a missing state', { 'screen-index.md': t => t.replace('  - loading: skeleton rows for members and pending invites\n', '') }],
  ['I3', 'n/a without a reason', { 'screen-index.md': t => t.replace('  - denied: n/a — every member can ask', '  - denied: n/a') }],
  ['I4', 'an interaction without a result', { 'screen-index.md': t => t.replace(/- Result: the row shows "Resent just now".*\n/, '') }],
  ['I5', 'a flow with two personas', { 'screen-index.md': t => t.replace('- Persona: member\n', '- Persona: member, owner\n') }],
  ['I5', 'a flow whose steps name no screen', { 'screen-index.md': t => t.replace(/(### Invitee joins[\s\S]*?- Steps:\n)[\s\S]*?(?=- Covers)/, '$1  1. Opens the email and joins\n') }],
  ['I6', 'a rule no screen or flow covers', { 'screen-index.md': t => t.replaceAll('- Covers: join\n', '- Covers: join-existing, join-new\n') }],
  ['I7', 'a persona without a flow', { 'screen-index.md': t => t.replace(/### Invitee joins[\s\S]*$/, '') }],
  ['D1', 'a stale index version', { 'design-spec.md': t => t.replace('index_version: 1', 'index_version: 0') }],
  ['D1', 'a ready design spec built on a draft index', { 'screen-index.md': t => t.replace('status: ready', 'status: draft') }],
  ['D2', 'a screen without a design entry', { 'design-spec.md': t => t.replace(/### Revoke confirmation[\s\S]*?(?=### Request invite dialog)/, '') }],
  ['D3', 'a state without a frame', { 'design-spec.md': t => t.replace('  - error: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=20-4\n', '') }],
  ['D4', 'a case without steps', { 'design-spec.md': t => t.replace('- Steps:\n  1. Choose Resend on an invite older than 10 minutes\n', '') }],
  ['D5', 'a rule without a case', { 'design-spec.md': t => t.replace(/### Second owner opens a decided request[\s\S]*$/, '') }],
  ['D6', 'a persona without a case', { 'design-spec.md': t => t.replace(/### Member asks an owner to invite someone[\s\S]*?(?=### )/, '') }],
]);

for (const [rule, what, edits] of BREAKS) {
  test(`${rule} catches ${what}`, () => {
    const findings = checkEdited(edits);
    assert.ok(findings.some(f => f.rule === rule), `expected ${rule}, got ${JSON.stringify(findings.map(f => `${f.rule}: ${f.message}`))}`);
    assert.equal(findings.find(f => f.rule === rule)?.severity, ['S6', 'S9'].includes(rule) ? 'warning' : 'error');
  });
}

test('every rule has a test that breaks it', () => {
  const tested = new Set(BREAKS.map(([rule]) => rule));
  assert.deepEqual(Object.keys(RULES).filter(r => !tested.has(r)), []);
});

test('a well-formed draft with open questions is not ready to hand off', () => {
  const spec = read('examples/acme/handoff/spec.md').replace('status: ready', 'status: draft')
    .replace('- Answer: 14 days, matching the password reset link.', '- Due: before design starts')
    .replace('3. Old or revoked links say what to do next.', '3. Old or revoked links say what to do next (proposed).');
  const res = check([parseDoc('spec.md', spec)]);
  assert.deepEqual(res.findings.filter(f => f.severity === 'error'), []);
  assert.equal(res.summary[0].open, 2);
  assert.equal(res.summary[0].readyToHandOff, false);
});

test('--add-ids fills in missing ids from the titles and never changes existing ones', () => {
  const original = read('examples/acme/handoff/spec.md');
  const stripped = original.replace(' `id:seat-limit`', '').replace(' `id:owner`', '').replace(' `id:invite-expiry`', '');
  const first = addIds(stripped, new Set(parseDoc('spec.md', stripped).items.map(i => i.id).filter(Boolean)));
  assert.equal(first.added, 3);
  assert.match(first.text, /free seats\. `id:invite-more-people`/);
  assert.match(first.text, /\*\*Workspace owner\*\* — .* `id:workspace-owner`/);
  assert.match(first.text, /### How long should an invite stay valid\? `id:long-invite-stay`/);
  assert.equal(first.text.replace(/ `id:(invite-more-people|workspace-owner|long-invite-stay)`/g, ''), stripped);
  const second = addIds(first.text);
  assert.equal(second.added, 0);
  assert.equal(second.text, first.text);
});

test('the checker runs when called through a symlinked path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-link-'));
  try {
    fs.symlinkSync(path.join(ROOT, 'kit'), path.join(tmp, 'kit'));
    const r = spawnSync(process.execPath, [path.join(tmp, 'kit/check.mjs'), EXAMPLE], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Ready to hand off: Product spec, Screen index, Design spec\./);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the blank templates are caught as unfinished', () => {
  for (const name of ['spec.md', 'screen-index.md', 'design-spec.md']) {
    const findings = check([parseDoc(name, read(`kit/templates/${name}`))]).findings;
    assert.ok(findings.some(f => f.rule === 'F4'), `${name}: placeholders`);
    assert.ok(findings.some(f => f.rule === 'F5'), `${name}: missing ids`);
  }
});

test('a file checked alone is not blamed for ids another file declares', () => {
  for (const name of ['screen-index.md', 'design-spec.md']) assert.deepEqual(check(loadDocs([path.join(EXAMPLE, name)])).findings, [], name);
});

test('every rule is documented in FORMAT.md with the same wording', () => {
  const format = read('kit/FORMAT.md');
  for (const [id, { text }] of Object.entries(RULES)) assert.ok(format.includes(`**${id}** ${text}`), `FORMAT.md is missing or rewords ${id}: ${text}`);
});

test('every kit skill carries an up-to-date copy of the kit (run scripts/sync-kit.mjs)', () => {
  const files = kitFiles(ROOT);
  for (const skill of kitSkills(ROOT)) {
    for (const { from, to } of files) {
      const copy = path.join(ROOT, 'skills', skill, 'kit', to);
      assert.ok(fs.existsSync(copy), `missing ${path.relative(ROOT, copy)}`);
      assert.equal(fs.readFileSync(copy, 'utf8'), read(from), `${path.relative(ROOT, copy)} is out of date`);
    }
  }
});

test('kit skills are well-formed, registered and installable on their own', () => {
  const roles = JSON.parse(read('kit/roles.json'));
  const install = read('INSTALL.md');
  const named = new Set([...Object.values(roles.stages).flatMap((/** @type {any} */ s) => s.skills), ...roles.always]);
  for (const skill of roles.kitSkills) {
    const md = read(`skills/${skill}/SKILL.md`);
    assert.match(md, new RegExp(`^---\\nname: ${skill}\\ndescription: .{40,}\\n---\\n`), `${skill}/SKILL.md front matter`);
    assert.ok(SKILLS[skill]?.kit, `${skill} is not registered as a kit skill in paths.js`);
    assert.ok(named.has(skill), `${skill} is not assigned to a stage in roles.json`);
    assert.ok(install.includes(`\`${skill}\``), `INSTALL.md does not mention ${skill}`);
    const nested = [];
    const walk = (/** @type {string} */ dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'SKILL.md' && dir !== path.join(ROOT, 'skills', skill)) nested.push(p);
      }
    };
    walk(path.join(ROOT, 'skills', skill));
    assert.deepEqual(nested, [], `${skill} has a nested SKILL.md, which some tools load as a second skill`);
    for (const ref of md.matchAll(/`((?:kit|references)\/[^`*<]+?)`/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'skills', skill, ref[1])), `${skill}/SKILL.md refers to ${ref[1]}, which is not in the skill folder`);
    }
  }
  for (const stage of Object.values(roles.stages)) for (const s of /** @type {any} */ (stage).skills) assert.ok(roles.kitSkills.includes(s));
  for (const id of [...Object.keys(roles.roles), ...Object.keys(roles.stages)]) assert.ok(install.includes(`(\`${id}\`)`), `INSTALL.md does not give the id ${id}`);
});

test('t3-sdlc spec check reports and exits like the standalone checker', () => {
  const bin = path.join(ROOT, 'factory/bin/t3-sdlc.js');
  const ok = spawnSync(process.execPath, [bin, 'spec', 'check', EXAMPLE], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Ready to hand off: Product spec, Screen index, Design spec\./);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  try {
    fs.writeFileSync(path.join(tmp, 'spec.md'), read('kit/templates/spec.md'));
    const bad = spawnSync(process.execPath, [bin, 'spec', 'check', tmp, '--json'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.ok(JSON.parse(bad.stdout).findings.some((/** @type {any} */ f) => f.rule === 'F4'));
    const standalone = spawnSync(process.execPath, [path.join(ROOT, 'kit/check.mjs'), tmp], { encoding: 'utf8' });
    assert.equal(standalone.status, 1);
    assert.match(standalone.stdout, /Not ready to hand off: Product spec\./);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(spawnSync(process.execPath, [bin, 'spec', 'check'], { encoding: 'utf8' }).status, 2);
});
