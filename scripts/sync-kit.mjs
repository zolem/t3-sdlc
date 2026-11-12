#!/usr/bin/env node
// Copy the shared kit into every kit skill, so each skill folder works on its own
// when it is copied, zipped or uploaded:
//
//   skills/<skill>/kit/check.mjs        from kit/check.mjs
//   skills/<skill>/kit/FORMAT.md        from kit/FORMAT.md
//   skills/<skill>/kit/templates/…      from kit/templates/
//   skills/<skill>/kit/example/*.md     from examples/acme/handoff/
//
// Edit the sources, then run `node scripts/sync-kit.mjs`. The kit test fails when a copy drifts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source → destination (relative to a skill's kit/ folder) for every shared file. */
export function kitFiles(root = ROOT) {
  /** @type {{ from: string, to: string }[]} */
  const files = [
    { from: 'kit/check.mjs', to: 'check.mjs' },
    { from: 'kit/FORMAT.md', to: 'FORMAT.md' },
  ];
  const walk = (/** @type {string} */ rel) => {
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const r = path.join(rel, name);
      if (fs.statSync(path.join(root, r)).isDirectory()) walk(r);
      else files.push({ from: r, to: path.relative('kit', r) });
    }
  };
  walk('kit/templates');
  for (const name of fs.readdirSync(path.join(root, 'examples/acme/handoff')).sort()) {
    if (name.endsWith('.md')) files.push({ from: `examples/acme/handoff/${name}`, to: `example/${name}` });
  }
  return files;
}

export function kitSkills(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'kit/roles.json'), 'utf8')).kitSkills;
}

function sync() {
  const files = kitFiles();
  for (const skill of kitSkills()) {
    const dest = path.join(ROOT, 'skills', skill, 'kit');
    fs.rmSync(dest, { recursive: true, force: true });
    for (const { from, to } of files) {
      const target = path.join(dest, to);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(ROOT, from), target);
    }
    console.log(`skills/${skill}/kit: ${files.length} files`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) sync();
