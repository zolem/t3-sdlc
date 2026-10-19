// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BUILTINS, runChecks } from '../src/lib/checks.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.invalid']);
  git(dir, ['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, 'migrations'));
  fs.writeFileSync(path.join(dir, 'migrations', '001_a.up.sql'), 'create table a(id int);');
  fs.writeFileSync(path.join(dir, 'migrations', '001_a.down.sql'), 'drop table a;');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { a: '1' } }));
  fs.writeFileSync(path.join(dir, 'src.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'coverage/\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'init']);
  return { dir, base: git(dir, ['rev-parse', 'HEAD']) };
}

/** @param {string} dir @param {Record<string, string>} files */
function commit(dir, files) {
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'change']);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** @param {string} name @param {{ cwd: string, base: string, head: string }} ctx @param {string[]} [args] @param {string[]} [testCases] */
const run = (name, ctx, args = [], testCases = []) => BUILTINS[name].run({ ...ctx, args, testCases });

test('built-ins flag secrets, focused tests, edited migrations, missing down files and lockfile drift', () => {
  const { dir, base } = repo();
  const head = commit(dir, {
    'src.js': 'export const a = 1;\nconst key = "AKIAABCDEFGHIJKLMNOP";\n',
    'test/a.test.js': 'it.only("x", () => {})\n',
    'migrations/001_a.up.sql': 'create table a(id int, b int);',
    'migrations/002_b.up.sql': 'create table b(id int);',
    'package.json': JSON.stringify({ name: 'x', dependencies: { a: '2' } }),
  });
  const ctx = { cwd: dir, base, head };
  assert.match(run('secrets', ctx).summary, /AWS access key/);
  assert.match(run('hygiene', ctx).summary, /focused test/);
  const mig = run('migrations', ctx, ['migrations/*.up.sql', '--require-down']);
  assert.equal(mig.ok, false);
  assert.match(mig.summary, /001_a\.up\.sql is an existing migration/);
  assert.match(mig.summary, /002_b\.up\.sql has no matching down/);
  assert.match(run('lockfile', ctx).summary, /no lockfile changed/);
});

test('traceability uses the slice test cases', () => {
  const { dir, base } = repo();
  const head = commit(dir, { 'test/a.test.js': 'test("TC-001: works", () => {})\n' });
  const res = run('traceability', { cwd: dir, base, head }, [], ['TC-001', 'TC-002']);
  assert.equal(res.ok, false);
  assert.match(res.summary, /TC-002/);
});

test('changed-lines reads lcov and warns about source files the report misses', () => {
  const { dir, base } = repo();
  fs.mkdirSync(path.join(dir, 'coverage'));
  fs.writeFileSync(path.join(dir, 'coverage', 'lcov.info'), ['SF:src.js', 'DA:1,1', 'DA:3,1', 'DA:4,0', 'end_of_record', ''].join('\n'));
  const head = commit(dir, { 'src.js': 'export const a = 1;\nexport function f(x) {\n  if (x) return 1;\n  return 2;\n}\n', 'public/app.js': 'console.log(1)\n' });
  const res = run('changed-lines', { cwd: dir, base, head }, ['coverage/lcov.info', '60']);
  assert.equal(res.ok, false);
  assert.match(res.summary, /50% \(1\/2/);
  assert.match(res.summary, /src\.js:4/);
  assert.match(res.warn || '', /public\/app\.js/);
});

test('runChecks runs repo commands with ORCH_* env and the orchestrate CLI on PATH, and refuses dirty trees', async () => {
  const { dir, base } = repo();
  commit(dir, { 'test/a.test.js': 'test("TC-001: works", () => {})\n' });
  const contract = { checks: [
    { id: 'env', run: 'test -n "$ORCH_BASE_SHA" && test "$ORCH_TEST_CASES" = "TC-001" && test -s "$ORCH_CHANGED_FILES"' },
    { id: 'trace', run: 'orchestrate check traceability' },
    { id: 'fails', run: 'echo boom && exit 3' },
  ] };
  const res = await runChecks({ cwd: dir, base, contract, testCases: ['TC-001'] });
  const by = Object.fromEntries(res.checks.map(c => [c.id, c]));
  assert.equal(by.env.ok, true, JSON.stringify(by.env));
  assert.equal(by.trace.ok, true, JSON.stringify(by.trace));
  assert.equal(by.fails.ok, false);
  assert.match(by.fails.output, /boom/);
  fs.writeFileSync(path.join(dir, 'scratch.txt'), 'x');
  const dirty = await runChecks({ cwd: dir, base, contract });
  assert.equal(dirty.checks[0].id, 'clean-tree');
});
