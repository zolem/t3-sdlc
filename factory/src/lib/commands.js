// @ts-check
// Static check that a shell command will resolve in a repo, without running it:
// package-manager scripts exist, make/just targets exist, local scripts are
// executable, and other programs are on PATH. Used by the doctor.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BUILTINS } from './checks.js';

const PM_BUILTIN = {
  npm: new Set(['ci', 'install', 'i', 'test', 't', 'start', 'exec', 'x', 'run', 'run-script', 'pack', 'prune']),
  pnpm: new Set(['install', 'i', 'add', 'exec', 'dlx', 'run', 'test', 't', 'start', 'why', 'store', 'fetch']),
  yarn: new Set(['install', 'add', 'run', 'test', 'start', 'exec', 'dlx', 'workspace', 'workspaces']),
  bun: new Set(['install', 'i', 'add', 'run', 'test', 'x', 'build']),
};

/**
 * First simple command of a shell line, skipping env assignments; null when the
 * line is too dynamic to analyse (subshells, variables in the program name).
 * @param {string} line
 */
export function firstCommand(line) {
  const seg = line.split(/&&|\|\||;|\|/)[0].trim();
  const tokens = (seg.match(/'[^']*'|"[^"]*"|\S+/g) || []).map(t => t.replace(/^['"]|['"]$/g, ''));
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (!tokens.length || /[$`(]/.test(tokens[0])) return null;
  return tokens;
}

/** @param {string} dir */
function packageScripts(dir) {
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).scripts || {};
  } catch {
    return null;
  }
}

/** @param {string} program @param {string} cwd */
function onPath(program, cwd) {
  try {
    execFileSync('/bin/bash', ['-lc', `command -v ${JSON.stringify(program)}`], { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} line shell command as written in factory.json
 * @param {string} cwd repo root
 * @returns {{ ok: boolean | null, how: string }} ok=null means "could not verify statically"
 */
export function resolveCommand(line, cwd) {
  const tokens = firstCommand(line);
  if (!tokens) return { ok: null, how: 'too dynamic to verify without running it' };
  const [prog, ...rest] = tokens;

  if (prog === 'orchestrate') {
    if (rest[0] !== 'check') return { ok: false, how: `"orchestrate ${rest[0] || ''}" is not a check; use "orchestrate check <${Object.keys(BUILTINS).join('|')}>"` };
    return BUILTINS[rest[1]] ? { ok: true, how: `built-in check "${rest[1]}"` } : { ok: false, how: `unknown built-in check "${rest[1]}"; available: ${Object.keys(BUILTINS).join(', ')}` };
  }

  if (prog in PM_BUILTIN) {
    const flagsWithValue = new Set(['--prefix', '-C', '--dir', '--cwd', '--filter', '-F', '-w', '--workspace']);
    let dir = cwd;
    const args = [];
    for (let i = 0; i < rest.length; i++) {
      if (flagsWithValue.has(rest[i])) {
        if (['--prefix', '-C', '--dir', '--cwd'].includes(rest[i])) dir = path.resolve(cwd, rest[i + 1] || '.');
        else return { ok: null, how: `${prog} workspace filter; verify by running it` };
        i++;
      } else if (!rest[i].startsWith('-')) args.push(rest[i]);
    }
    if (!onPath(prog, cwd)) return { ok: false, how: `${prog} is not installed or not on PATH` };
    const [sub, script] = args;
    const scripts = packageScripts(dir);
    const builtins = PM_BUILTIN[/** @type {keyof typeof PM_BUILTIN} */ (prog)];
    /** @type {string | null} */
    let name;
    if (sub === 'run' || sub === 'run-script') name = script;
    else if (sub === 'test' || sub === 't') name = 'test';
    else if (sub === 'start') name = 'start';
    else if (builtins.has(sub)) name = null;
    else if (prog === 'npm') return { ok: false, how: `"npm ${sub}" is not an npm command; did you mean "npm run ${sub}"?` };
    else name = sub;
    if (!name) return { ok: true, how: `${prog} ${sub}` };
    if (!scripts) return { ok: false, how: `no package.json in ${path.relative(cwd, dir) || '.'}` };
    return scripts[name] ? { ok: true, how: `${prog} script "${name}" → ${scripts[name]}` } : { ok: false, how: `package.json${dir !== cwd ? ` in ${path.relative(cwd, dir)}` : ''} has no "${name}" script` };
  }

  if (prog === 'make' || prog === 'just') {
    const target = rest.find(t => !t.startsWith('-'));
    const file = ['justfile', 'Justfile', '.justfile', 'Makefile', 'makefile', 'GNUmakefile'].map(f => path.join(cwd, f)).find(f => fs.existsSync(f) && (prog === 'just') === /justfile$/i.test(f));
    if (!file) return { ok: false, how: `no ${prog === 'make' ? 'Makefile' : 'justfile'} in the repo root` };
    if (!target) return { ok: true, how: `${prog} default target` };
    const has = new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:[^=]*?)?:`, 'm').test(fs.readFileSync(file, 'utf8'));
    return has ? { ok: true, how: `${prog} target "${target}"` } : { ok: false, how: `${path.basename(file)} has no "${target}" target` };
  }

  if (prog.includes('/')) {
    const p = path.resolve(cwd, prog);
    if (!fs.existsSync(p)) return { ok: false, how: `${prog} does not exist` };
    try {
      fs.accessSync(p, fs.constants.X_OK);
    } catch {
      return { ok: false, how: `${prog} is not executable (chmod +x ${prog})` };
    }
    return { ok: true, how: `script ${prog}` };
  }

  return onPath(prog, cwd) ? { ok: true, how: `${prog} found on PATH` } : { ok: false, how: `${prog} is not installed or not on PATH` };
}
