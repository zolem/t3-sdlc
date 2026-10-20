// @ts-check
// Where t3-sdlc lives. One folder owns everything:
//   ~/.t3-sdlc/app      the release (or a symlink to a checkout, for development)
//   ~/.t3-sdlc/bin      the `t3-sdlc` launcher agents call
//   ~/.t3-sdlc/runs     run state, plus ledger.jsonl, policy.json, roles/ overlays, backups/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** State root. T3_SDLC_HOME wins; ORCHESTRATE_HOME is the pre-CLI name. */
export function homeDir() {
  return process.env.T3_SDLC_HOME || process.env.ORCHESTRATE_HOME || path.join(os.homedir(), '.t3-sdlc');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The app root: the folder holding roles/, policy/, skills/ and factory/. Same layout in a checkout and a release. Overridable for tests and forks. */
export const APP_ROOT = process.env.ORCHESTRATE_CONTENT || path.resolve(HERE, '..', '..', '..');

/** Holds the `orchestrate` shim that factory.json checks call. Always next to this code. */
export const FACTORY_BIN = path.resolve(HERE, '..', '..', 'bin');

export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0-dev';
  }
})();

/** The command agents should run: the installed launcher when present, else whatever is on PATH. */
export function cliCommand() {
  const launcher = path.join(homeDir(), 'bin', 't3-sdlc');
  return fs.existsSync(launcher) ? launcher : 't3-sdlc';
}

/** Skills shipped in the app. Internal ones are served by `t3-sdlc skill <name>` but not linked into agent skill folders. */
export const SKILLS = {
  orchestrate: { linked: true },
  'orchestrate-setup': { linked: true },
  'generate-brief': { linked: true },
  'orchestrate-run': { linked: false },
  'orchestrate-repo': { linked: false },
};

/** @param {string} name */
export function skillFile(name) {
  return path.join(APP_ROOT, 'skills', name, 'SKILL.md');
}
