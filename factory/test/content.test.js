// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONTRACTS } from '../src/lib/contracts.js';
import { loadPolicy, resolveTargets } from '../src/lib/policy.js';

const ROOT = new URL('../../', import.meta.url);

test('every role in the contracts has a brief and an org policy entry', () => {
  const { policy } = loadPolicy({ home: '/nonexistent-home' });
  for (const role of Object.keys(CONTRACTS)) {
    const brief = new URL(`roles/${role}.md`, ROOT);
    assert.ok(fs.existsSync(brief), `missing roles/${role}.md`);
    assert.match(fs.readFileSync(brief, 'utf8'), /^---\nversion: /, `roles/${role}.md needs version frontmatter`);
    assert.ok(resolveTargets({ policy, role }).targets.length > 0, `no policy for ${role}`);
  }
});

test('org policy keeps niche models out of defaults', () => {
  const org = JSON.parse(fs.readFileSync(new URL('policy/org.json', ROOT), 'utf8'));
  const models = Object.values(org.roles).flatMap((/** @type {any} */ r) => r.targets.map((/** @type {any} */ t) => t.model));
  assert.deepEqual(models.filter(m => /fable|astra/i.test(m)), []);
});
