// @ts-check
// A repo's contract with the factory (.orchestrate/factory.json), and the
// optional workspace file that groups several repos into one run
// (.orchestrate/workspace.json in the repo you run /orchestrate from).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONTRACT_FILE = '.orchestrate/factory.json';
export const WORKSPACE_FILE = '.orchestrate/workspace.json';

const CONTRACT_KEYS = new Set(['$schema', 'version', 'setup', 'checks', 'app', 'docs', 'context']);
const APP_KEYS = new Set(['up', 'down', 'url', 'urlPattern', 'ready', 'readyTimeoutSec', 'env']);
const CHECK_KEYS = new Set(['id', 'run', 'timeoutSec', 'description']);

/** @param {string} root */
export function contractPath(root) {
  return path.join(root, CONTRACT_FILE);
}

/**
 * Read a contract. Returns { contract: null } when the file does not exist.
 * @param {string} root
 * @returns {{ contract: any, errors: string[], warnings: string[] }}
 */
export function readContract(root) {
  const file = contractPath(root);
  if (!fs.existsSync(file)) return { contract: null, errors: [], warnings: [] };
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { contract: null, errors: [`${CONTRACT_FILE} is not valid JSON: ${err instanceof Error ? err.message : err}`], warnings: [] };
  }
  return { contract, ...validateContract(contract) };
}

/** Back-compat helper: the contract or null; throws when invalid. @param {string} root */
export function loadContract(root) {
  const { contract, errors } = readContract(root);
  if (errors.length) throw new Error(`${contractPath(root)}: ${errors.join('; ')}`);
  return contract;
}

/** @param {any} c */
export function validateContract(c) {
  const errors = [];
  const warnings = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { errors: ['must be a JSON object'], warnings };
  for (const k of Object.keys(c)) {
    if (k === 'coverage' || k === 'migrations') errors.push(`"${k}" moved into "checks" as a command, e.g. ${k === 'coverage' ? '{ "id": "coverage", "run": "npm run coverage && orchestrate check changed-lines coverage/lcov.info 80" }' : '{ "id": "migrations", "run": "orchestrate check migrations \'migrations/*.up.sql\' --require-down" }'}`);
    else if (!CONTRACT_KEYS.has(k)) warnings.push(`unknown key "${k}" is ignored`);
  }
  if (c.setup !== undefined && (typeof c.setup !== 'string' || !c.setup.trim())) errors.push('"setup" must be a non-empty command string');
  if (c.checks !== undefined) {
    if (!Array.isArray(c.checks)) errors.push('"checks" must be an array of { "id", "run" }');
    else {
      const ids = new Set();
      c.checks.forEach((/** @type {any} */ chk, /** @type {number} */ i) => {
        if (!chk || typeof chk !== 'object') return errors.push(`checks[${i}] must be an object`);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(chk.id || '')) errors.push(`checks[${i}].id must be kebab-case (e.g. "lint")`);
        else if (ids.has(chk.id)) errors.push(`checks[${i}].id "${chk.id}" is duplicated`);
        else ids.add(chk.id);
        if (typeof chk.run !== 'string' || !chk.run.trim()) errors.push(`checks[${i}].run must be a command string`);
        for (const k of Object.keys(chk)) if (!CHECK_KEYS.has(k)) warnings.push(`checks[${i}]: unknown key "${k}"`);
      });
    }
  }
  if (c.app !== undefined) {
    const a = c.app;
    if (!a || typeof a !== 'object') errors.push('"app" must be an object');
    else {
      if (typeof a.up !== 'string' || !a.up.trim()) errors.push('"app.up" must be a command that starts the app');
      if (!a.url && !a.urlPattern) errors.push('"app" needs "url" (may use {port}) or "urlPattern" (regex with one group, matched against the app output)');
      if (a.env && typeof a.env !== 'object') errors.push('"app.env" must be an object of strings');
      for (const k of Object.keys(a)) if (!APP_KEYS.has(k)) warnings.push(`app: unknown key "${k}"`);
    }
  }
  if (c.docs !== undefined && (typeof c.docs !== 'object' || (c.docs.dir !== undefined && typeof c.docs.dir !== 'string'))) errors.push('"docs" must be { "dir": "docs/features" }');
  return { errors, warnings };
}

/** @param {string} p @param {string} base */
function expandPath(p, base) {
  const home = p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
  return path.resolve(base, home);
}

/**
 * The repos a run spans. Without a workspace file it is just the primary repo.
 * @param {string} primaryRoot
 * @returns {{ name: string | null, file: string | null, repos: { name: string, root: string, primary: boolean }[], app: any, errors: string[] }}
 */
export function readWorkspace(primaryRoot) {
  const file = path.join(primaryRoot, WORKSPACE_FILE);
  const fallbackName = path.basename(primaryRoot).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!fs.existsSync(file)) return { name: null, file: null, repos: [{ name: fallbackName, root: primaryRoot, primary: true }], app: null, errors: [] };
  const errors = [];
  let ws;
  try {
    ws = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { name: null, file, repos: [{ name: fallbackName, root: primaryRoot, primary: true }], app: null, errors: [`${WORKSPACE_FILE} is not valid JSON: ${err instanceof Error ? err.message : err}`] };
  }
  const repos = [];
  const entries = Object.entries(ws.repos || {});
  if (!entries.length) errors.push(`${WORKSPACE_FILE} needs "repos": { "<name>": { "path": "<path>" } }`);
  let primaryName = null;
  for (const [name, r] of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) errors.push(`workspace repo name "${name}" must be kebab-case`);
    const root = expandPath(/** @type {any} */ (r)?.path || '.', primaryRoot);
    if (root === primaryRoot) primaryName = name;
    repos.push({ name, root, primary: root === primaryRoot });
  }
  if (!primaryName) repos.unshift({ name: fallbackName, root: primaryRoot, primary: true });
  if (ws.app) {
    const { errors: appErrors } = validateContract({ app: ws.app });
    errors.push(...appErrors.map(e => `workspace ${e}`));
  }
  return { name: ws.name || null, file, repos, app: ws.app || null, errors };
}

/** Env var name for a workspace repo's checkout path. @param {string} name */
export function repoEnvVar(name) {
  return `ORCH_REPO_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}
