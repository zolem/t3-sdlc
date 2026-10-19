// @ts-check
// The t3-sdlc CLI. Agents drive the factory through it, Code Mode style:
//   search — find capabilities without loading the whole catalog into context
//   exec   — run an async arrow function that calls `factory.<module>.<fn>()`
// plus the skills agents follow, the repo doctor, built-in checks, and install/update.

import fs from 'node:fs';
import path from 'node:path';
import { Registry } from './registry.js';
import { runCode } from './sandbox.js';
import { loadModules } from './modules/index.js';
import { BUILTINS } from './lib/checks.js';
import { doctor, suggestContract } from './lib/doctor.js';
import { CONTRACT_FILE } from './lib/repoContract.js';
import { git } from './lib/git.js';
import { SKILLS, VERSION, cliCommand, homeDir, skillFile } from './lib/paths.js';
import { install, uninstall, update } from './install.js';

const FULL_ACCESS = 't3-sdlc needs full access: it keeps run state in ~/.t3-sdlc, outside this checkout, and this thread cannot write there. Switch this thread to Full access in T3 and retry.';

function guide() {
  const cli = cliCommand().replace(process.env.HOME || '\0', '~');
  return `t3-sdlc ${VERSION}: the T3 SDLC factory. You drive it; it decides every step.

Start here
  ${cli} skill orchestrate         run a ticket or brief end to end (you are the foreman)
  ${cli} skill orchestrate-setup   make a repo ready for the factory
  ${cli} skill                     list skills

Call the factory (discover, then run code)
  ${cli} search start a run        keyword search over capabilities
  ${cli} search --code - <<'JS'
  async () => catalog.filter(c => c.module === "run")
  JS
  ${cli} exec - <<'JS'
  async () => factory.orchestrator.next({ runId: "..." })
  JS
    exec runs one async arrow function. Inside, call await factory.<module>.<fn>({ ...args }).
    Chain several calls and return only what you need. It prints {ok, result, logs} as JSON.
    Paths resolve against the shell's cwd; pass --cwd <dir> to change that.
    Always use a quoted heredoc (<<'JS') so the shell leaves the code alone.

Repo tools
  ${cli} doctor [path] [--verify] [--json]   can the factory run this repo? what is missing?
  ${cli} init [path] [--write]               propose .orchestrate/factory.json
  ${cli} check <name>                        built-in checks for factory.json (${Object.keys(BUILTINS).join(', ')})

Install
  ${cli} version | update | uninstall [--purge]
`;
}

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') positional.push(a);
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (['cwd', 'code', 'from-dir', 'version'].includes(k) && argv[i + 1] !== undefined) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

/** Code comes from an argument, `-`, or piped stdin. @param {string | undefined} arg */
function readCode(arg) {
  if (arg && arg !== '-') return arg;
  if (process.stdin.isTTY && arg !== '-') return '';
  return fs.readFileSync(0, 'utf8');
}

function registry() {
  const reg = new Registry();
  for (const mod of loadModules()) reg.add(mod);
  return reg;
}

/** @param {unknown} value */
const print = value => console.log(JSON.stringify(value, null, 2));

/** Probe that this process may write the state root; sandboxed threads cannot. @returns {string | null} why not */
function homeWriteError() {
  const home = homeDir();
  try {
    fs.mkdirSync(home, { recursive: true });
    const probe = path.join(home, `.probe-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return null;
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'EROFS') return FULL_ACCESS;
    return `t3-sdlc cannot write its state folder ${home}: ${err instanceof Error ? err.message : err}`;
  }
}

/** @param {string[]} argv @returns {Promise<number>} exit code */
export async function main(argv) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parse(rest);

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(guide());
      return 0;

    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION);
      return 0;

    case 'search': {
      const reg = registry();
      const code = typeof flags.code === 'string' ? readCode(flags.code) : '';
      if (code) {
        const out = await runCode(code, { registry: reg, ctx: ctx(reg, flags), mode: 'search', timeoutMs: 10_000 });
        print(trim(out, flags));
        return out.ok ? 0 : 1;
      }
      const query = positional.join(' ');
      print(query ? reg.search(query) : reg.overview());
      return 0;
    }

    case 'exec': {
      const code = readCode(positional[0]);
      if (!code.trim()) {
        console.error(`usage: t3-sdlc exec - <<'JS'\nasync () => factory.meta.whoami()\nJS`);
        return 2;
      }
      const writeError = homeWriteError();
      if (writeError) {
        print({ ok: false, error: writeError });
        return 3;
      }
      const reg = registry();
      const out = await runCode(code, { registry: reg, ctx: ctx(reg, flags), mode: 'execute' });
      print(trim(out, flags));
      return out.ok ? 0 : 1;
    }

    case 'skill': {
      const name = positional[0];
      if (!name) {
        for (const [n, s] of Object.entries(SKILLS)) console.log(`${n}${s.linked ? '' : '  (internal)'}`);
        return 0;
      }
      const file = skillFile(name);
      if (!fs.existsSync(file)) {
        console.error(`No skill "${name}". Skills: ${Object.keys(SKILLS).join(', ')}`);
        return 2;
      }
      console.log(fs.readFileSync(file, 'utf8').replaceAll('~/.t3-sdlc/bin/t3-sdlc', cliCommand()));
      return 0;
    }

    case 'doctor': {
      const res = await doctor({ cwd: path.resolve(positional[0] || '.'), verify: !!flags.verify });
      if (flags.json) print(res);
      else {
        console.log(res.report);
        console.log(`\n${res.ok ? (res.ready ? 'Ready: every stage can run.' : `Runnable. Optional stages unavailable: ${res.needsDecision.join(', ')}.`) : `Not runnable yet: fix ${res.blocking.join(', ')}.`}`);
      }
      return res.ok ? 0 : 1;
    }

    case 'init': {
      const root = path.resolve(positional[0] || '.');
      const { contract, notes } = suggestContract(root);
      const file = path.join(root, CONTRACT_FILE);
      const json = JSON.stringify(contract, null, 2) + '\n';
      if (flags.write) {
        if (fs.existsSync(file)) {
          console.error(`${CONTRACT_FILE} already exists; not overwriting. Remove it or edit it by hand.`);
          return 1;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, json);
        console.log(`wrote ${file}`);
      } else console.log(json);
      for (const n of notes) console.log(`note: ${n}`);
      return 0;
    }

    case 'check': {
      const [name, ...args] = positional;
      const builtin = BUILTINS[name];
      if (!builtin) {
        console.error(`unknown check "${name}". Available:\n${Object.values(BUILTINS).map(b => `  ${b.usage}\n      ${b.description}`).join('\n')}`);
        return 2;
      }
      const cwd = process.cwd();
      const head = process.env.ORCH_HEAD_SHA || git(cwd, ['rev-parse', 'HEAD']);
      const base = process.env.ORCH_BASE_SHA
        || git(cwd, ['merge-base', 'HEAD', 'origin/HEAD'], { allowFail: true })
        || git(cwd, ['rev-parse', 'HEAD~1'], { allowFail: true })
        || head;
      const testCases = (process.env.ORCH_TEST_CASES || '').split(',').map(s => s.trim()).filter(Boolean);
      const extra = Object.entries(flags).map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`));
      const res = builtin.run({ cwd, base, head, args: [...args, ...extra], testCases });
      console.log(res.summary);
      return res.ok ? 0 : 1;
    }

    case 'install':
      return install({ fromDir: typeof flags['from-dir'] === 'string' ? flags['from-dir'] : undefined, dev: !!flags.dev });

    case 'update':
      return update({ version: typeof flags.version === 'string' ? flags.version : undefined });

    case 'uninstall':
      return uninstall({ purge: !!flags.purge });

    default:
      console.error(`unknown command "${cmd}"\n`);
      console.error(guide());
      return 2;
  }
}

/** @param {Registry} reg @param {Record<string, string | boolean>} flags */
function ctx(reg, flags) {
  return {
    cwd: typeof flags.cwd === 'string' ? path.resolve(flags.cwd) : process.cwd(),
    home: homeDir(),
    signatures: Object.fromEntries(reg.catalog().map(c => [c.path, c.signature])),
  };
}

/** Call timings are noise for agents; keep them behind --verbose. @param {any} out @param {Record<string, string | boolean>} flags */
function trim(out, flags) {
  if (flags.verbose) return out;
  const { calls, ...rest } = out;
  if (!rest.logs?.length) delete rest.logs;
  return rest;
}
