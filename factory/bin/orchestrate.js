#!/usr/bin/env node
// orchestrate doctor [path] [--verify] [--json]   can the factory run this repo/workspace?
// orchestrate init [path] [--write]               propose (or write) .orchestrate/factory.json
// orchestrate check <name> [args]                  built-in checks for factory.json "checks"
import fs from 'node:fs';
import path from 'node:path';
import { BUILTINS } from '../src/lib/checks.js';
import { doctor, suggestContract } from '../src/lib/doctor.js';
import { CONTRACT_FILE } from '../src/lib/repoContract.js';
import { git } from '../src/lib/git.js';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(a => a.startsWith('--')));
const positional = rest.filter(a => !a.startsWith('--'));

function usage(code = 0) {
  console.log(`usage:
  orchestrate doctor [path] [--verify] [--json]
  orchestrate init [path] [--write]
  orchestrate check <name> [args]   (${Object.keys(BUILTINS).join(', ')})`);
  process.exit(code);
}

if (cmd === 'doctor') {
  const res = await doctor({ cwd: path.resolve(positional[0] || '.'), verify: flags.has('--verify') });
  if (flags.has('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(res.report);
    console.log(`\n${res.ok ? (res.ready ? 'Ready: every stage can run.' : `Runnable. Optional stages unavailable: ${res.needsDecision.join(', ')}.`) : `Not runnable yet: fix ${res.blocking.join(', ')}.`}`);
  }
  process.exit(res.ok ? 0 : 1);
} else if (cmd === 'init') {
  const root = path.resolve(positional[0] || '.');
  const { contract, notes } = suggestContract(root);
  const file = path.join(root, CONTRACT_FILE);
  const json = JSON.stringify(contract, null, 2) + '\n';
  if (flags.has('--write')) {
    if (fs.existsSync(file)) {
      console.error(`${CONTRACT_FILE} already exists; not overwriting. Remove it or edit it by hand.`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
    console.log(`wrote ${file}`);
  } else console.log(json);
  for (const n of notes) console.log(`note: ${n}`);
} else if (cmd === 'check') {
  const [name, ...args] = positional.slice(0);
  const builtin = BUILTINS[name];
  if (!builtin) {
    console.error(`unknown check "${name}". Available:\n${Object.values(BUILTINS).map(b => `  ${b.usage}\n      ${b.description}`).join('\n')}`);
    process.exit(2);
  }
  const cwd = process.cwd();
  const head = process.env.ORCH_HEAD_SHA || git(cwd, ['rev-parse', 'HEAD']);
  const base = process.env.ORCH_BASE_SHA
    || git(cwd, ['merge-base', 'HEAD', 'origin/HEAD'], { allowFail: true })
    || git(cwd, ['rev-parse', 'HEAD~1'], { allowFail: true })
    || head;
  const testCases = (process.env.ORCH_TEST_CASES || '').split(',').map(s => s.trim()).filter(Boolean);
  const res = builtin.run({ cwd, base, head, args: [...args, ...[...flags]], testCases });
  console.log(res.summary);
  process.exit(res.ok ? 0 : 1);
} else usage(cmd ? 2 : 0);
