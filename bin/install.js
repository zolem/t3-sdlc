#!/usr/bin/env node
// Installs the orchestrate factory for every T3 harness on this machine:
//   1. installs the factory MCP server's dependencies
//   2. registers the `factory` MCP server with Claude Code, Codex, OpenCode and Cursor
//      (backing up each config first under ~/.orchestrate/backups/<timestamp>/)
//   3. optionally links the skills (orchestrate, generate-brief) into ~/.claude/skills
//      and ~/.agents/skills for local development (plugin installs do this otherwise)
//
// Usage: node bin/install.js [--dry-run] [--link-skills] [--uninstall] [--only=claude,codex,opencode,cursor]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACTORY_BIN = path.join(ROOT, 'factory', 'bin', 'factory-mcp.js');
const NODE = process.execPath;
const HOME = os.homedir();
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const UNINSTALL = args.has('--uninstall');
const LINK = args.has('--link-skills');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : ['claude', 'codex', 'opencode', 'cursor'];
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const BACKUP_DIR = path.join(process.env.ORCHESTRATE_HOME || path.join(HOME, '.orchestrate'), 'backups', STAMP);

const log = (/** @type {string} */ m) => console.log(m);
const has = (/** @type {string} */ cmd) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** @param {string} file */
function backup(file) {
  if (!fs.existsSync(file) || DRY) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, file.replace(HOME, '').replace(/^\//, '').replace(/\//g, '__'));
  fs.copyFileSync(file, dest);
  log(`  backup → ${dest}`);
}

/** @param {string} file @param {string} content */
function write(file, content) {
  if (DRY) return log(`  (dry run) would write ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function installDeps() {
  log('• factory dependencies');
  if (DRY) return log('  (dry run) would run npm ci in factory/');
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(ROOT, 'factory'), stdio: 'inherit' });
}

function claude() {
  log('• Claude Code');
  if (!has('claude')) return log('  skipped: `claude` CLI not found');
  backup(path.join(HOME, '.claude.json'));
  if (DRY) return log(`  (dry run) would run: claude mcp add --scope user factory -- ${NODE} ${FACTORY_BIN}`);
  try {
    execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'factory'], { stdio: 'ignore' });
  } catch {}
  if (!UNINSTALL) execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'factory', '--', NODE, FACTORY_BIN], { stdio: 'inherit' });
}

function codex() {
  log('• Codex');
  const file = path.join(HOME, '.codex', 'config.toml');
  if (!fs.existsSync(path.dirname(file))) return log('  skipped: ~/.codex not found');
  backup(file);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const stripped = text.replace(/\n?\[mcp_servers\.factory\][\s\S]*?(?=\n\[|$)/, '').trimEnd();
  const block = `\n\n[mcp_servers.factory]\ncommand = "${NODE}"\nargs = ["${FACTORY_BIN}"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 1800\n`;
  write(file, UNINSTALL ? `${stripped}\n` : `${stripped}${block}`);
}

function opencode() {
  log('• OpenCode');
  if (!has('opencode')) return log('  skipped: `opencode` CLI not found');
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'opencode', 'opencode.json');
  backup(file);
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { $schema: 'https://opencode.ai/config.json' };
  cfg.mcp ??= {};
  cfg.mcp.servers ??= {};
  delete cfg.mcp.factory;
  if (UNINSTALL) delete cfg.mcp.servers.factory;
  else cfg.mcp.servers.factory = { type: 'local', command: [NODE, FACTORY_BIN], disabled: false, timeout: { catalog: 30000, execution: 1800000 } };
  write(file, JSON.stringify(cfg, null, 2) + '\n');
}

function cursor() {
  log('• Cursor');
  const file = path.join(HOME, '.cursor', 'mcp.json');
  if (!fs.existsSync(path.dirname(file))) return log('  skipped: ~/.cursor not found');
  backup(file);
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  cfg.mcpServers ??= {};
  if (UNINSTALL) delete cfg.mcpServers.factory;
  else cfg.mcpServers.factory = { command: NODE, args: [FACTORY_BIN] };
  write(file, JSON.stringify(cfg, null, 2) + '\n');
}

function linkSkills() {
  log('• skills (symlinks for local development)');
  for (const dir of [path.join(HOME, '.claude', 'skills'), path.join(HOME, '.agents', 'skills')]) {
    for (const skill of fs.readdirSync(path.join(ROOT, 'plugin', 'skills'))) {
      const link = path.join(dir, skill);
      const target = path.join(ROOT, 'plugin', 'skills', skill);
      if (DRY) {
        log(`  (dry run) ${UNINSTALL ? 'remove' : 'link'} ${link} → ${target}`);
        continue;
      }
      const existing = fs.lstatSync(link, { throwIfNoEntry: false });
      if (existing && !existing.isSymbolicLink()) {
        log(`  skipped ${link}: a real directory is there; remove it to link`);
        continue;
      }
      if (existing) fs.unlinkSync(link);
      if (!UNINSTALL) {
        fs.mkdirSync(dir, { recursive: true });
        fs.symlinkSync(target, link);
        log(`  ${link} → ${target}`);
      }
    }
  }
}

if (!UNINSTALL) installDeps();
const steps = { claude, codex, opencode, cursor };
for (const name of ONLY) steps[/** @type {keyof typeof steps} */ (name)]?.();
if (LINK) linkSkills();
log(`\n${UNINSTALL ? 'Removed' : 'Installed'} the factory MCP (${FACTORY_BIN}).${fs.existsSync(BACKUP_DIR) ? ` Config backups: ${BACKUP_DIR}` : ''}`);
if (!UNINSTALL) log('Restart T3 (or open new threads) so harnesses pick up the server. Then run /orchestrate (Claude) or $orchestrate (Codex) in a target repo.');
