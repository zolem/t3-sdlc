// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { doctor, suggestContract } from '../src/lib/doctor.js';
import { resolveCommand } from '../src/lib/commands.js';

const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.invalid']);
  git(dir, ['config', 'user.name', 'T']);
  for (const [f, c] of Object.entries({ 'README.md': '# x\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

const pkg = JSON.stringify({ name: 'x', scripts: { lint: 'eslint .', test: 'node --test', dev: 'node server.js' } });
const cap = (/** @type {any} */ res, /** @type {string} */ id) => res.capabilities.find((/** @type {any} */ c) => c.id === id);

test('no contract: blocking, with a suggestion built from package scripts', async () => {
  const dir = repo({ 'package.json': pkg, 'package-lock.json': '{}' });
  const res = await doctor({ cwd: dir });
  assert.equal(res.ok, false);
  assert.deepEqual(res.blocking, ['contract']);
  assert.match(res.report, /"setup": "npm ci"/);
  const { contract } = suggestContract(dir);
  assert.deepEqual(contract.checks.slice(0, 2), [{ id: 'lint', run: 'npm run lint' }, { id: 'test', run: 'npm test' }]);
  assert.equal(contract.app.up, 'npm run dev');
});

test('missing scripts and old keys are reported with the stage they block', async () => {
  const dir = repo({
    'package.json': pkg,
    '.orchestrate/factory.json': JSON.stringify({ checks: [{ id: 'types', run: 'npm run typecheck' }, { id: 'test', run: 'npm test' }] }),
  });
  const res = await doctor({ cwd: dir });
  assert.equal(cap(res, 'checks').status, 'invalid');
  assert.match(cap(res, 'checks').detail, /no "typecheck" script/);
  assert.match(cap(res, 'checks').stage, /deterministic gate/);
  assert.equal(cap(res, 'setup').status, 'missing');
  assert.deepEqual(res.needsDecision.sort(), ['browser-validation', 'publish']);

  fs.writeFileSync(path.join(dir, '.orchestrate/factory.json'), JSON.stringify({ checks: [{ id: 'test', run: 'npm test' }], coverage: { run: 'x' } }));
  const old = await doctor({ cwd: dir });
  assert.equal(cap(old, 'contract').status, 'invalid');
  assert.match(cap(old, 'contract').detail, /"coverage" moved into "checks"/);
});

test('only built-in checks is not enough; a valid contract with app is ready apart from publish', async () => {
  const dir = repo({ 'package.json': pkg, '.orchestrate/factory.json': JSON.stringify({ checks: [{ id: 'secrets', run: 'orchestrate check secrets' }] }) });
  assert.match(cap(await doctor({ cwd: dir }), 'checks').detail, /nothing runs your tests/);
  fs.writeFileSync(path.join(dir, '.orchestrate/factory.json'), JSON.stringify({
    setup: 'npm ci',
    checks: [{ id: 'test', run: 'npm test' }, { id: 'secrets', run: 'orchestrate check secrets' }],
    app: { up: 'npm run dev', url: 'http://localhost:{port}', ready: '/health' },
  }));
  const res = await doctor({ cwd: dir, skip: ['publish'] });
  assert.equal(res.ok, true, res.report);
  assert.equal(res.ready, true, res.report);
  assert.equal(res.enabled.browserValidation, true);
});

test('workspace: a repo path that does not exist blocks the run', async () => {
  const dir = repo({
    'package.json': pkg,
    '.orchestrate/factory.json': JSON.stringify({ checks: [{ id: 'test', run: 'npm test' }] }),
    '.orchestrate/workspace.json': JSON.stringify({ repos: { web: { path: '.' }, api: { path: '../does-not-exist' } } }),
  });
  const res = await doctor({ cwd: dir });
  assert.equal(res.ok, false);
  assert.ok(res.capabilities.some((/** @type {any} */ c) => c.repo === 'api' && c.id === 'git' && c.status === 'missing'));
});

test('verify runs the checks on HEAD', async () => {
  const dir = repo({ '.orchestrate/factory.json': JSON.stringify({ checks: [{ id: 'ok', run: 'true' }, { id: 'bad', run: 'echo nope; exit 1' }] }) });
  const res = await doctor({ cwd: dir, verify: true });
  assert.equal(cap(res, 'verify-checks').status, 'failed');
  assert.match(cap(res, 'verify-checks').fix, /nope/);
});

test('resolveCommand understands package managers, make, scripts and PATH', () => {
  const dir = repo({ 'package.json': pkg, Makefile: 'test:\n\techo hi\n', 'scripts/check.sh': '#!/bin/sh\n' });
  assert.equal(resolveCommand('npm run lint', dir).ok, true);
  assert.equal(resolveCommand('npm lint', dir).ok, false);
  assert.equal(resolveCommand('make test', dir).ok, true);
  assert.equal(resolveCommand('make deploy', dir).ok, false);
  assert.match(resolveCommand('./scripts/check.sh', dir).how, /not executable/);
  assert.equal(resolveCommand('orchestrate check secrets', dir).ok, true);
  assert.equal(resolveCommand('no-such-binary-xyz', dir).ok, false);
});
