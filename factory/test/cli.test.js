// @ts-check
// The CLI and its install lifecycle, end to end: pack a release, install it with
// install.sh into a throwaway HOME that has the pre-CLI setup, drive the factory
// through the launcher, then uninstall.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} home @param {string[]} args @param {{ input?: string, env?: Record<string, string>, cwd?: string }} [o] */
function cli(home, args, o = {}) {
  const res = spawnSync(path.join(home, '.t3-sdlc', 'bin', 't3-sdlc'), args, {
    input: o.input,
    cwd: o.cwd || home,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, T3_SDLC_HOME: '', ORCHESTRATE_HOME: '', ORCHESTRATE_CONTENT: '', PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}`, ...o.env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

/** @param {string} p */
const isLink = p => fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

test('install.sh: release install migrates the old setup, the CLI drives the factory, uninstall cleans up', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't3-sdlc-cli-'));
  const home = path.join(tmp, 'home');
  // Pre-CLI setup: state in ~/.orchestrate, a factory MCP entry, a stale skill link, a user's own skill folder.
  fs.mkdirSync(path.join(home, '.orchestrate', 'runs', 'r1'), { recursive: true });
  fs.writeFileSync(path.join(home, '.orchestrate', 'runs', 'r1', 'run.json'), '{}');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { factory: { command: 'node', args: ['/x/factory/bin/factory-mcp.js'] }, mine: { command: 'keep' } } }));
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "m"\n\n[mcp_servers.factory]\ncommand = "node"\nargs = ["/x/factory/bin/factory-mcp.js"]\n\n[mcp_servers.mine]\ncommand = "keep"\n');
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'generate-brief'), { recursive: true });
  fs.symlinkSync('/gone/plugin/skills/orchestrate-repo', path.join(home, '.claude', 'skills', 'orchestrate-repo'));

  const dist = path.join(tmp, 'dist');
  execFileSync('sh', [path.join(ROOT, 'scripts', 'pack.sh'), 'v9.9.9'], { cwd: ROOT, stdio: 'pipe' });
  fs.mkdirSync(dist);
  fs.copyFileSync(path.join(ROOT, 'dist', 't3-sdlc.tar.gz'), path.join(dist, 't3-sdlc.tar.gz'));
  const out = execFileSync('sh', [path.join(ROOT, 'install.sh')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, T3_SDLC_TARBALL: path.join(dist, 't3-sdlc.tar.gz'), T3_SDLC_HOME: '', ORCHESTRATE_HOME: '', ORCHESTRATE_CONTENT: '', PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}` },
  });
  assert.match(out, /t3-sdlc 9\.9\.9 installed/);
  assert.match(out, /skipped .*generate-brief/, "a user's real folder is never replaced");

  const t3 = path.join(home, '.t3-sdlc');
  assert.ok(fs.existsSync(path.join(t3, 'runs', 'r1', 'run.json')), 'runs moved from ~/.orchestrate');
  assert.ok(!fs.existsSync(path.join(home, '.orchestrate')));
  const cursor = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(cursor.mcpServers), ['mine']);
  const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  assert.ok(!toml.includes('factory') && toml.includes('[mcp_servers.mine]'));
  for (const dir of ['.agents/skills', '.claude/skills']) {
    assert.ok(isLink(path.join(home, dir, 'orchestrate')), `${dir}/orchestrate linked`);
    assert.ok(!fs.existsSync(path.join(home, dir, 'orchestrate-repo')), 'internal skill not linked');
  }
  assert.ok(!isLink(path.join(home, '.claude', 'skills', 'orchestrate-repo')), 'stale link removed');

  // The launcher: guide, skills, search, exec.
  assert.match(cli(home, []).out, /t3-sdlc 9\.9\.9/);
  const skill = cli(home, ['skill', 'orchestrate-repo']).out;
  assert.ok(skill.includes(`${t3}/bin/t3-sdlc exec`), 'skill text points at the installed launcher');
  assert.ok(JSON.parse(cli(home, ['search', 'start', 'a', 'run']).out).some((/** @type {any} */ c) => c.path === 'orchestrator.start'));
  const who = cli(home, ['exec', '-'], { input: 'async () => factory.meta.whoami()' });
  assert.equal(who.code, 0, who.err);
  assert.equal(JSON.parse(who.out).result.version, '9.9.9');
  const bad = cli(home, ['exec', 'async () => factory.run.read({ runId: "nope", path: "x" })']);
  assert.equal(bad.code, 1);
  assert.equal(JSON.parse(bad.out).ok, false);

  // A sandboxed thread cannot write the state folder.
  const ro = path.join(tmp, 'ro');
  fs.mkdirSync(ro, { mode: 0o500 });
  const denied = cli(home, ['exec', 'async () => 1'], { env: { T3_SDLC_HOME: path.join(ro, 'state') } });
  assert.equal(denied.code, 3);
  assert.match(JSON.parse(denied.out).error, /needs full access/);

  // Uninstall keeps runs; --purge removes everything.
  assert.equal(cli(home, ['uninstall']).code, 0);
  assert.ok(!fs.existsSync(path.join(home, '.agents', 'skills', 'orchestrate')));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'generate-brief')), "the user's own folder stays");
  assert.ok(fs.existsSync(path.join(t3, 'runs', 'r1')) && !fs.existsSync(path.join(t3, 'app')));
  execFileSync(process.execPath, [path.join(ROOT, 'factory', 'bin', 't3-sdlc.js'), 'uninstall', '--purge'], { env: { ...process.env, HOME: home, T3_SDLC_HOME: '', ORCHESTRATE_HOME: '' }, stdio: 'pipe' });
  assert.ok(!fs.existsSync(t3));
});

test('install --dev links the checkout; update refuses and points at git pull', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't3-sdlc-dev-'));
  const env = { ...process.env, HOME: tmp, T3_SDLC_HOME: '', ORCHESTRATE_HOME: '', ORCHESTRATE_CONTENT: '' };
  execFileSync(process.execPath, [path.join(ROOT, 'factory', 'bin', 't3-sdlc.js'), 'install', '--dev'], { env, stdio: 'pipe' });
  assert.equal(fs.realpathSync(path.join(tmp, '.t3-sdlc', 'app')), fs.realpathSync(ROOT));
  assert.equal(fs.realpathSync(path.join(tmp, '.agents', 'skills', 'orchestrate')), fs.realpathSync(path.join(ROOT, 'skills', 'orchestrate')));
  const res = cli(tmp, ['update']);
  assert.equal(res.code, 1);
  assert.match(res.out, /git pull/);
});
