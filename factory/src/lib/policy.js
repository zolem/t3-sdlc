// @ts-check
// Role → provider/model routing. Layers, lowest to highest precedence:
//   org   <content>/policy/org.json          (bundled; set from evals)
//   user  ~/.t3-sdlc/policy.json
//   repo  <repo>/.orchestrate/policy.json
//   run   overrides passed to orchestrator.start
// A role entry in a higher layer replaces that role's `targets` wholesale and
// merges the remaining keys.

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_ROOT, readJson } from './store.js';

/**
 * @typedef {{ providerInstanceId: string, model: string, options?: Record<string, string | boolean> }} Target
 * @typedef {{ targets: Target[], panel?: number, avoidFamilyOf?: string, isolation?: 'shared' | 'worktree', note?: string }} RolePolicy
 * @typedef {{ version: number, roles: Record<string, RolePolicy>, settings?: Record<string, unknown> }} Policy
 * @typedef {{ available: Record<string, string[]>, options: Record<string, Record<string, string[]>> }} Availability
 */

/**
 * Model family, used to guarantee reviewers come from a different lineage than
 * the author. Heuristic on model ids because provider instances (Cursor,
 * OpenCode) can serve many families.
 * @param {Target} target
 */
export function familyOf(target) {
  const m = target.model.toLowerCase();
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku') || m.includes('fable')) return 'anthropic';
  if (m.startsWith('gpt') || m.includes('/gpt') || m.includes('codex') || /\bo\d/.test(m)) return 'openai';
  if (m.includes('gemini')) return 'google';
  if (m.includes('grok')) return 'xai';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('glm') || m.includes('zai')) return 'zai';
  if (m.includes('kimi') || m.includes('moonshot')) return 'moonshot';
  if (m.includes('nemotron') || m.includes('nvidia')) return 'nvidia';
  if (m.includes('composer')) return 'cursor';
  if (m.includes('muse')) return 'muse';
  return `${target.providerInstanceId}:${m}`;
}

/** @param {Policy | undefined} base @param {Partial<Policy> | undefined} layer */
function mergePolicy(base, layer) {
  if (!layer) return base;
  /** @type {Policy} */
  const out = { version: layer.version ?? base?.version ?? 1, roles: { ...(base?.roles || {}) } };
  if (base?.settings || layer.settings) out.settings = { ...(base?.settings || {}), ...(layer.settings || {}) };
  for (const [role, entry] of Object.entries(layer.roles || {})) {
    out.roles[role] = { ...(out.roles[role] || { targets: [] }), ...entry };
  }
  return out;
}

/**
 * @param {{ home: string, repo?: string, overrides?: Partial<Policy> }} opts
 */
export function loadPolicy({ home, repo, overrides }) {
  /** @type {{ layer: string, file: string }[]} */
  const sources = [];
  const layers = [
    { layer: 'org', file: path.join(CONTENT_ROOT, 'policy', 'org.json') },
    { layer: 'user', file: path.join(home, 'policy.json') },
    ...(repo ? [{ layer: 'repo', file: path.join(repo, '.orchestrate', 'policy.json') }] : []),
  ];
  /** @type {Policy | undefined} */
  let policy;
  for (const l of layers) {
    if (!fs.existsSync(l.file)) continue;
    policy = mergePolicy(policy, readJson(l.file));
    sources.push(l);
  }
  if (overrides) {
    policy = mergePolicy(policy, overrides);
    sources.push({ layer: 'run', file: '(orchestrator.start overrides)' });
  }
  if (!policy) throw new Error('No policy found; expected policy/org.json in the factory content root');
  validatePolicy(policy);
  return { policy, sources };
}

/** @param {Policy} policy */
export function validatePolicy(policy) {
  for (const [role, entry] of Object.entries(policy.roles)) {
    if (!Array.isArray(entry.targets) || entry.targets.length === 0) throw new Error(`policy.roles.${role}.targets must be a non-empty array`);
    for (const t of entry.targets) {
      if (!t.providerInstanceId || !t.model) throw new Error(`policy.roles.${role}: every target needs providerInstanceId and model`);
    }
  }
}

/**
 * Reduce the orchestrator_capabilities payload to what routing needs. A model
 * listed without an `options` array has unknown options, so its policy options
 * are passed through rather than dropped.
 * @param {any} capabilities
 * @returns {Availability}
 */
export function availabilityFrom(capabilities) {
  /** @type {Availability} */
  const out = { available: {}, options: {} };
  for (const p of capabilities?.providers || []) {
    if (!p.canRunChildTask) continue;
    out.available[p.providerInstanceId] = (p.models || []).map((/** @type {any} */ m) => m.id);
    for (const m of p.models || []) {
      if (!Array.isArray(m.options)) continue;
      /** @type {Record<string, string[]>} */
      const opts = {};
      for (const o of m.options) opts[o.id] = o.type === 'boolean' ? ['true', 'false'] : (o.options || []).map((/** @type {any} */ x) => x.id);
      out.options[`${p.providerInstanceId}/${m.id}`] = opts;
    }
  }
  return out;
}

/**
 * Availability from a list of "providerInstanceId/model" strings the
 * orchestrator confirmed. Options are unknown, so they pass through.
 * @param {string[]} list
 * @returns {Availability}
 */
export function availabilityFromList(list) {
  /** @type {Availability} */
  const out = { available: {}, options: {} };
  for (const entry of list) {
    const i = entry.indexOf('/');
    if (i <= 0) throw new Error(`available: "${entry}" is not "providerInstanceId/model"`);
    (out.available[entry.slice(0, i)] ||= []).push(entry.slice(i + 1));
  }
  return out;
}

/**
 * Every distinct "providerInstanceId/model" the policy can route to.
 * @param {Policy} policy
 */
export function policyTargets(policy) {
  return [...new Set(Object.values(policy.roles).flatMap(r => r.targets.map(t => `${t.providerInstanceId}/${t.model}`)))];
}

/**
 * Drop options the model does not advertise so a stale policy never breaks a dispatch.
 * @param {Target} t @param {Availability | undefined} av
 * @returns {{ target: Target, dropped: string[] }}
 */
function sanitizeOptions(t, av) {
  const known = av?.options[`${t.providerInstanceId}/${t.model}`];
  if (!known || !t.options) return { target: t, dropped: [] };
  /** @type {Record<string, string | boolean>} */
  const options = {};
  const dropped = [];
  for (const [k, v] of Object.entries(t.options)) {
    if (known[k] && known[k].includes(String(v))) options[k] = v;
    else dropped.push(`${k}=${v}`);
  }
  return { target: { ...t, options }, dropped };
}

/** @param {Target} t @param {Availability | undefined} av */
function isAvailable(t, av) {
  if (!av) return true;
  return (av.available[t.providerInstanceId] || []).includes(t.model);
}

/**
 * Pick targets for a role.
 * @param {{ policy: Policy, role: string, availability?: Availability, avoidFamilies?: string[], count?: number }} opts
 * @returns {{ targets: (Target & { family: string })[], fallbacks: (Target & { family: string })[], skipped: string[], warnings: string[] }}
 */
export function resolveTargets({ policy, role, availability, avoidFamilies = [], count }) {
  const entry = policy.roles[role];
  if (!entry) throw new Error(`No policy for role "${role}". Known roles: ${Object.keys(policy.roles).join(', ')}`);
  const want = count ?? entry.panel ?? 1;
  const distinct = want > 1;
  /** @type {(Target & { family: string })[]} */
  const chosen = [];
  /** @type {(Target & { family: string })[]} */
  const fallbacks = [];
  const skipped = [];
  const warnings = [];
  const usedFamilies = new Set();
  for (const raw of entry.targets) {
    const family = familyOf(raw);
    if (!isAvailable(raw, availability)) {
      skipped.push(`${raw.providerInstanceId}/${raw.model} (unavailable)`);
      continue;
    }
    if (avoidFamilies.includes(family)) {
      skipped.push(`${raw.providerInstanceId}/${raw.model} (same family as author: ${family})`);
      continue;
    }
    const { target, dropped } = sanitizeOptions(raw, availability);
    if (dropped.length) warnings.push(`${raw.model}: dropped unsupported options ${dropped.join(', ')}`);
    const resolved = { ...target, family };
    if (chosen.length < want && !(distinct && usedFamilies.has(family))) {
      chosen.push(resolved);
      usedFamilies.add(family);
    } else {
      fallbacks.push(resolved);
    }
  }
  if (chosen.length < want) {
    throw new Error(`Role "${role}" needs ${want} target(s) from distinct families but only ${chosen.length} qualify. Skipped: ${skipped.join('; ') || 'none'}`);
  }
  return { targets: chosen, fallbacks, skipped, warnings };
}
