// @ts-check
// Install, update and uninstall. Everything t3-sdlc owns lives in ~/.t3-sdlc; the
// only things it writes elsewhere are skill symlinks, listed in manifest.json so
// uninstall removes exactly those.
//
//   ~/.t3-sdlc/app          release contents (or a symlink to a checkout with --dev)
//   ~/.t3-sdlc/bin/t3-sdlc  launcher agents call
//   ~/.agents/skills/<s>    → ~/.t3-sdlc/app/skills/<s>   Codex, Cursor, OpenCode
//   ~/.claude/skills/<s>    → ~/.t3-sdlc/app/skills/<s>   Claude Code

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { APP_ROOT, SKILLS, VERSION, homeDir } from './lib/paths.js';

const REPO = process.env.T3_SDLC_REPO || 'zolem/t3-sdlc';
const ASSET = 't3-sdlc.tar.gz';
/** Folders kept on uninstall unless --purge: the user's runs, history and overrides. */
const USER_DATA = ['runs', 'ledger.jsonl', 'policy.json', 'roles', 'backups'];

const log = (/** @type {string} */ m) => console.log(m);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

/** Skill folders and who reads them. ~/.agents/skills is the cross-agent location; Claude Code only reads its own. */
function skillDirs() {
  const h = os.homedir();
  return [
    { dir: path.join(h, '.agents', 'skills'), readers: 'Codex, Cursor, OpenCode' },
    { dir: path.join(h, '.claude', 'skills'), readers: 'Claude' },
  ];
}

/** @param {string} home */
function manifestPath(home) {
  return path.join(home, 'manifest.json');
}

/** @param {string} home */
function readManifest(home) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(home), 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} p */
const lstat = p => fs.lstatSync(p, { throwIfNoEntry: false });

/** @param {string} home */
function launcher(home) {
  const entry = path.join(home, 'app', 'factory', 'bin', 't3-sdlc.js');
  return `#!/bin/sh
# t3-sdlc launcher, written by \`t3-sdlc install\`. Remove with \`t3-sdlc uninstall\`.
NODE="\${T3_SDLC_NODE:-node}"
command -v "$NODE" >/dev/null 2>&1 || { echo "t3-sdlc needs Node.js >= 22 on PATH (or set T3_SDLC_NODE)." >&2; exit 127; }
exec "$NODE" "${entry}" "$@"
`;
}

/**
 * @param {{ fromDir?: string, dev?: boolean }} opts
 * @returns {Promise<number>}
 */
export async function install({ fromDir, dev = false }) {
  const home = homeDir();
  const source = dev ? APP_ROOT : fromDir ? path.resolve(fromDir) : null;
  if (!source) {
    log('Usage: t3-sdlc install --from-dir <unpacked release>   (install.sh does this for you)\n       t3-sdlc install --dev                       (link this checkout, for working on t3-sdlc)');
    return 2;
  }
  if (!fs.existsSync(path.join(source, 'factory', 'bin', 't3-sdlc.js'))) {
    log(`${source} is not a t3-sdlc release (no factory/bin/t3-sdlc.js).`);
    return 2;
  }
  fs.mkdirSync(home, { recursive: true });
  migrateLegacyHome(home);

  // 1. App: copy the release in, or link the checkout.
  const app = path.join(home, 'app');
  const current = lstat(app);
  if (dev) {
    if (current) fs.rmSync(app, { recursive: true, force: true });
    fs.symlinkSync(source, app);
  } else if (path.resolve(source) !== path.resolve(app)) {
    const next = `${app}.next`;
    fs.rmSync(next, { recursive: true, force: true });
    fs.cpSync(source, next, { recursive: true });
    if (current) fs.rmSync(app, { recursive: true, force: true });
    fs.renameSync(next, app);
  }
  const version = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version;

  // 2. Launcher.
  const bin = path.join(home, 'bin', 't3-sdlc');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, launcher(home), { mode: 0o755 });

  // 3. Skill links, plus `t3-sdlc` on PATH when ~/.local/bin is already on it.
  const previous = readManifest(home);
  /** @type {{ link: string, target: string }[]} */
  const links = [];
  /** @type {string[]} */
  const skipped = [];
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const onPath = (process.env.PATH || '').split(path.delimiter).some(p => path.resolve(p) === localBin);
  if (onPath) {
    const link = path.join(localBin, 't3-sdlc');
    const existing = lstat(link);
    if (!existing || existing.isSymbolicLink()) {
      if (existing) fs.unlinkSync(link);
      fs.symlinkSync(bin, link);
      links.push({ link, target: bin });
    } else skipped.push(`${link} (a file is there already)`);
  }
  for (const { dir } of skillDirs()) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, s] of Object.entries(SKILLS)) {
      const link = path.join(dir, name);
      const target = path.join(app, 'skills', name);
      const existing = lstat(link);
      if (!s.linked) {
        // Internal skills are served by `t3-sdlc skill`; drop links an older install left.
        if (existing?.isSymbolicLink()) fs.unlinkSync(link);
        continue;
      }
      if (existing && !existing.isSymbolicLink()) {
        skipped.push(`${link} (a real folder is there; remove it to let t3-sdlc link its skill)`);
        continue;
      }
      if (existing) fs.unlinkSync(link);
      fs.symlinkSync(target, link);
      links.push({ link, target });
    }
  }
  // Links from an older install that this version no longer ships.
  for (const old of previous?.links || []) {
    if (!links.some(l => l.link === old.link) && lstat(old.link)?.isSymbolicLink()) fs.unlinkSync(old.link);
  }

  const removedMcp = removeLegacyMcp(home);
  fs.writeFileSync(manifestPath(home), JSON.stringify({ version, mode: dev ? 'dev' : 'release', installedAt: new Date().toISOString(), launcher: bin, links }, null, 2) + '\n');

  log(`t3-sdlc ${version} installed${dev ? ` (dev: ${home}/app → ${source})` : ''}.`);
  log(`  launcher  ${bin}${onPath ? `  (also ${path.join(localBin, 't3-sdlc')})` : ''}`);
  for (const { dir, readers } of skillDirs()) log(`  skills    ${dir}  (${readers})`);
  for (const s of skipped) log(`  skipped   ${s}`);
  for (const m of removedMcp) log(`  removed   old factory MCP entry from ${m} (backup in ${home}/backups)`);
  const providers = t3Providers();
  if (providers) log(`  T3 providers enabled: ${providers.join(', ')}`);
  log(`\nIn any T3 thread (Full access): "orchestrate ABC-123" or "orchestrate <a brief>". Set a repo up with "set up this repo for t3-sdlc".`);
  return 0;
}

/**
 * @param {{ purge?: boolean }} opts
 * @returns {Promise<number>}
 */
export async function uninstall({ purge = false }) {
  const home = homeDir();
  const manifest = readManifest(home);
  for (const { link, target } of manifest?.links || []) {
    const st = lstat(link);
    if (st?.isSymbolicLink() && fs.readlinkSync(link) === target) fs.unlinkSync(link);
  }
  for (const name of ['app', 'bin', 'manifest.json']) fs.rmSync(path.join(home, name), { recursive: true, force: true });
  if (purge) fs.rmSync(home, { recursive: true, force: true });
  const kept = purge ? [] : USER_DATA.filter(n => fs.existsSync(path.join(home, n)));
  log(`t3-sdlc removed.${kept.length ? ` Kept your data in ${home}: ${kept.join(', ')} (uninstall --purge removes it).` : ''}`);
  return 0;
}

/**
 * Download a release and install it over the current one.
 * @param {{ version?: string }} opts
 * @returns {Promise<number>}
 */
export async function update({ version }) {
  const home = homeDir();
  if (readManifest(home)?.mode === 'dev') {
    log(`This is a dev install linked to ${fs.realpathSync(path.join(home, 'app'))}. Update it with git pull.`);
    return 1;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't3-sdlc-'));
  try {
    const tarball = path.join(tmp, ASSET);
    await download(tarball, version);
    const dir = path.join(tmp, 'app');
    fs.mkdirSync(dir);
    execFileSync('tar', ['-xzf', tarball, '-C', dir]);
    const next = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    if (next === VERSION && !version) log(`Already on ${VERSION}; reinstalling.`);
    return await install({ fromDir: dir });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Public repos download over HTTPS; private ones fall back to an authenticated `gh`. @param {string} file @param {string} [version] */
async function download(file, version) {
  const url = version
    ? `https://github.com/${REPO}/releases/download/${version}/${ASSET}`
    : `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return;
  } catch (err) {
    try {
      execFileSync('gh', ['release', 'download', ...(version ? [version] : []), '--repo', REPO, '--pattern', ASSET, '--output', file, '--clobber'], { stdio: 'pipe' });
    } catch {
      throw new Error(`Could not download ${url} (${err instanceof Error ? err.message : err}), and \`gh release download\` failed too. Is the repo private? Run \`gh auth login\` first.`);
    }
  }
}

/** Earlier versions kept state in ~/.orchestrate. Move it once. @param {string} home */
function migrateLegacyHome(home) {
  const legacy = path.join(os.homedir(), '.orchestrate');
  if (path.resolve(legacy) === path.resolve(home) || !fs.existsSync(legacy)) return;
  for (const name of USER_DATA) {
    const from = path.join(legacy, name);
    const to = path.join(home, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  }
  if (fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy);
  else log(`  note      ${legacy} still has files t3-sdlc no longer uses; delete it when you like.`);
}

/**
 * Earlier versions registered a `factory` MCP server in each harness. The CLI replaces it.
 * Removes only entries that point at factory-mcp.js, after backing the file up.
 * @param {string} home @returns {string[]} files changed
 */
function removeLegacyMcp(home) {
  const h = os.homedir();
  const isOurs = (/** @type {unknown} */ v) => JSON.stringify(v ?? '').includes('factory-mcp.js');
  /** @type {string[]} */
  const changed = [];
  const backupDir = path.join(home, 'backups', `${stamp()}-mcp`);
  const backup = (/** @type {string} */ file) => {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(file, path.join(backupDir, file.replace(h, '').replace(/^\//, '').replace(/\//g, '__')));
  };
  /** @param {string} file @param {(cfg: any) => boolean} edit */
  const json = (file, edit) => {
    if (!fs.existsSync(file)) return;
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    if (!edit(cfg)) return;
    backup(file);
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    changed.push(file);
  };
  // Running Claude sessions rewrite ~/.claude.json, so go through its CLI when there is one.
  const claudeJson = path.join(h, '.claude.json');
  if (fs.existsSync(claudeJson) && isOurs(JSON.parse(fs.readFileSync(claudeJson, 'utf8')).mcpServers?.factory)) {
    backup(claudeJson);
    try {
      execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'factory'], { stdio: 'ignore' });
      changed.push(claudeJson);
    } catch {
      json(claudeJson, cfg => (delete cfg.mcpServers.factory, true));
    }
  }
  json(path.join(h, '.cursor', 'mcp.json'), cfg => {
    if (!isOurs(cfg.mcpServers?.factory)) return false;
    delete cfg.mcpServers.factory;
    return true;
  });
  json(path.join(process.env.XDG_CONFIG_HOME || path.join(h, '.config'), 'opencode', 'opencode.json'), cfg => {
    let hit = false;
    if (isOurs(cfg.mcp?.servers?.factory)) (delete cfg.mcp.servers.factory, (hit = true));
    if (isOurs(cfg.mcp?.factory)) (delete cfg.mcp.factory, (hit = true));
    return hit;
  });
  const toml = path.join(h, '.codex', 'config.toml');
  if (fs.existsSync(toml)) {
    const lines = fs.readFileSync(toml, 'utf8').split('\n');
    const start = lines.findIndex(l => l.trim() === '[mcp_servers.factory]');
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !lines[end].trimStart().startsWith('[')) end++;
      if (lines.slice(start, end).join('\n').includes('factory-mcp.js')) {
        backup(toml);
        lines.splice(start, end - start);
        fs.writeFileSync(toml, lines.join('\n').trimEnd() + '\n');
        changed.push(toml);
      }
    }
  }
  return changed;
}

/** Enabled provider instances in T3's settings, for the install summary. */
function t3Providers() {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.t3', 'userdata', 'settings.json'), 'utf8'));
    return ['claude', ...Object.entries(settings.providerInstances || {}).filter(([, v]) => /** @type {any} */ (v).enabled).map(([, v]) => /** @type {any} */ (v).driver)].filter((x, i, a) => a.indexOf(x) === i);
  } catch {
    return null;
  }
}
