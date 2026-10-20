// @ts-check
// What each role must produce, and how the factory validates it. Reports are
// checked deterministically: a child cannot claim "done" without the files,
// branches, and passing checks the contract demands.

export const SEVERITIES = /** @type {const} */ (['critical', 'high', 'medium', 'low', 'nit']);
export const BLOCKING = new Set(['critical', 'high', 'medium']);
export const FINDING_CATEGORIES = ['correctness', 'requirements', 'edge-case', 'security', 'data', 'history', 'tests', 'design', 'ux', 'performance', 'docs'];

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {typeof SEVERITIES[number]} severity
 * @property {string} title
 * @property {string} detail
 * @property {string} [category]
 * @property {string} [file]
 * @property {number} [line]
 * @property {number} [slice]
 * @property {string} [steps]
 */

/**
 * @typedef {object} RoleContract
 * @property {'implementation'|'research'|'review'|'design'|'test'|'general'} t3Role
 * @property {'shared'|'worktree'} isolation
 * @property {string} summary                       one line, shown in the ledger and briefs
 * @property {string[]} [outputs]                   run files that must exist when reporting
 * @property {string} reportShape                   TypeScript-ish shape shown in the brief
 * @property {string[]} [capabilities]              factory calls listed in the brief cheat sheet
 */

const REPORT_BASE = '{ runId, dispatchId, summary: string /* 1-3 sentences */';

/** @type {Record<string, Record<string, RoleContract>>} */
export const CONTRACTS = {
  'product-manager': {
    default: {
      t3Role: 'design', isolation: 'shared', summary: 'Brief → requirements with user stories and acceptance criteria.',
      outputs: ['requirements.md'], reportShape: `${REPORT_BASE} }`,
      capabilities: ['run.read', 'run.write', 'dispatch.report'],
    },
  },
  'context-curator': {
    default: {
      t3Role: 'research', isolation: 'shared', summary: 'Brief + repo/org docs → focused context briefing (runs alongside the product manager).',
      outputs: ['context.md'], reportShape: `${REPORT_BASE} }`,
      capabilities: ['run.read', 'run.write', 'repo.contract', 'dispatch.report'],
    },
  },
  architect: {
    default: {
      t3Role: 'design', isolation: 'shared', summary: 'Requirements + context → implementation plan.',
      outputs: ['architecture.md'], reportShape: `${REPORT_BASE} }`,
      capabilities: ['run.read', 'run.write', 'history.why', 'dispatch.report'],
    },
  },
  'qa-analyst': {
    default: {
      t3Role: 'test', isolation: 'shared', summary: 'Requirements → user-focused test plan with TC-NNN ids.',
      outputs: ['test-plan.md'], reportShape: `${REPORT_BASE}, testCases: string[] /* every TC id in the plan */ }`,
      capabilities: ['run.read', 'run.write', 'dispatch.report'],
    },
  },
  'slice-planner': {
    default: {
      t3Role: 'design', isolation: 'shared', summary: 'Plan → ordered, reviewable slices (one stacked PR each).',
      outputs: ['slices.json'], reportShape: `${REPORT_BASE} }`,
      capabilities: ['run.read', 'run.write', 'run.list', 'workspace.info', 'dispatch.report'],
    },
  },
  explainer: {
    plan: {
      t3Role: 'design', isolation: 'shared', summary: 'Planning docs → one HTML page a non-technical reader can follow, with technical depth below.',
      outputs: ['explainers/plan.html'], reportShape: `${REPORT_BASE} }`,
      capabilities: ['run.read', 'run.write', 'run.list', 'dispatch.report'],
    },
    stack: {
      t3Role: 'design', isolation: 'shared', summary: 'Finished slices → HTML walkthrough of the PR stack in dependency order.',
      outputs: ['explainers/stack.html'], reportShape: `${REPORT_BASE} }`,
      capabilities: ['run.read', 'run.write', 'run.list', 'run.info', 'git.sliceDiff', 'dispatch.report'],
    },
  },
  engineer: {
    build: {
      t3Role: 'implementation', isolation: 'shared', summary: 'Implement one slice on its branch with tests; checks must pass.',
      reportShape: `${REPORT_BASE}, branch: string, headSha: string }`,
      capabilities: ['run.read', 'checks.run', 'history.why', 'dispatch.report'],
    },
    'feature-fix': {
      t3Role: 'implementation', isolation: 'shared', summary: "Fix this repo's share of the feature-level findings in the right slices, restack, re-run checks on every touched slice.",
      reportShape: `${REPORT_BASE}, addressed: { id: string, slice: number, how: string }[] }`,
      capabilities: ['run.read', 'run.info', 'checks.run', 'git.restack', 'history.why', 'dispatch.report'],
    },
  },
  'manual-tester': {
    feature: {
      t3Role: 'test', isolation: 'shared', summary: "Run the integrated feature (every repo at its finished stack) and walk every user story and browser-only test case.",
      reportShape: `${REPORT_BASE}, findings: Finding[], screenshots: string[] }`,
      capabilities: ['run.read', 'app.up', 'app.down', 'run.attach', 'run.write', 'dispatch.report'],
    },
  },
  'feature-reviewer': {
    review: {
      t3Role: 'review', isolation: 'shared', summary: 'Adversarial review of the whole feature stack.',
      reportShape: `${REPORT_BASE}, findings: Finding[] }`,
      capabilities: ['run.read', 'run.info', 'git.sliceDiff', 'history.forDiff', 'history.why', 'checks.results', 'dispatch.report'],
    },
    recheck: {
      t3Role: 'review', isolation: 'shared', summary: 'Re-check your own open findings against the fixed stack; report only what is still open or newly broken by the fixes.',
      reportShape: `${REPORT_BASE}, resolved: string[] /* ids of your findings that are fixed, or whose "no change needed" reason you accept */, findings: Finding[] /* still open (same id) or regressions from the fixes (new id) */ }`,
      capabilities: ['run.read', 'run.info', 'git.sliceDiff', 'checks.results', 'dispatch.report'],
    },
  },
  'docs-writer': {
    default: {
      t3Role: 'general', isolation: 'shared', summary: 'Versioned feature doc (summary, diagrams, decisions, screenshots) as the top slice.',
      reportShape: `${REPORT_BASE}, branch: string, headSha: string, docPath: string }`,
      capabilities: ['run.read', 'run.list', 'run.info', 'run.export', 'checks.run', 'dispatch.report'],
    },
  },
};

/** @param {string} role @param {string} [mode] */
export function contractFor(role, mode = 'default') {
  const modes = CONTRACTS[role];
  if (!modes) throw new Error(`Unknown role "${role}"`);
  const c = modes[mode];
  if (!c) throw new Error(`Role "${role}" has no mode "${mode}" (modes: ${Object.keys(modes).join(', ')})`);
  return c;
}

/**
 * Validate the shape of findings. Returns errors (empty when valid).
 * @param {unknown} findings
 */
export function findingErrors(findings) {
  if (!Array.isArray(findings)) return ['findings must be an array (use [] when there are none)'];
  const errors = [];
  const ids = new Set();
  findings.forEach((f, i) => {
    if (!f || typeof f !== 'object') return errors.push(`findings[${i}] must be an object`);
    if (!f.id || typeof f.id !== 'string') errors.push(`findings[${i}].id is required`);
    else if (ids.has(f.id)) errors.push(`findings[${i}].id "${f.id}" is duplicated`);
    else ids.add(f.id);
    if (!SEVERITIES.includes(f.severity)) errors.push(`findings[${i}].severity must be one of ${SEVERITIES.join('|')}`);
    if (!f.title) errors.push(`findings[${i}].title is required`);
    if (!f.detail) errors.push(`findings[${i}].detail is required`);
  });
  return errors;
}

/** @param {Finding[]} findings */
export function verdictOf(findings) {
  return findings.some(f => BLOCKING.has(f.severity)) ? 'fail' : 'pass';
}

/**
 * Validate slices.json from the slice planner.
 * @param {any} doc
 * @param {{ testCases: string[], exists: (rel: string) => boolean, repos?: string[] }} env
 */
export function sliceErrors(doc, env) {
  const errors = [];
  if (!doc || !Array.isArray(doc.slices) || doc.slices.length === 0) return ['slices.json must be {"slices": [ ... ]} with at least one slice'];
  const covered = new Set();
  doc.slices.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    const at = `slices[${i}]`;
    if (s.n !== i + 1) errors.push(`${at}.n must be ${i + 1} (slices are numbered in review order)`);
    if (!/^[a-z0-9-]{3,40}$/.test(s.slug || '')) errors.push(`${at}.slug must be kebab-case, 3-40 chars`);
    for (const k of ['title', 'summary', 'why', 'layer', 'spec']) if (!s[k]) errors.push(`${at}.${k} is required`);
    if (s.spec && !env.exists(s.spec)) errors.push(`${at}.spec "${s.spec}" was not written to the run folder`);
    if (typeof s.ui !== 'boolean') errors.push(`${at}.ui must be true or false (does this slice change what a user sees?)`);
    if (env.repos && env.repos.length > 1 && !env.repos.includes(s.repo)) errors.push(`${at}.repo must name the repo this slice changes: one of ${env.repos.join(', ')}`);
    else if (s.repo !== undefined && env.repos && !env.repos.includes(s.repo)) errors.push(`${at}.repo "${s.repo}" is not in this run (${env.repos.join(', ')})`);
    for (const d of s.dependsOn || []) if (!(Number.isInteger(d) && d >= 1 && d < s.n)) errors.push(`${at}.dependsOn may only list earlier slice numbers`);
    for (const key of ['testCases', 'manualCases']) {
      if (s[key] !== undefined && !Array.isArray(s[key])) errors.push(`${at}.${key} must be an array`);
      for (const tc of s[key] || []) {
        if (!env.testCases.includes(tc)) errors.push(`${at}.${key} has "${tc}" which is not in test-plan.md`);
        if (covered.has(tc)) errors.push(`${tc} is assigned more than once`);
        covered.add(tc);
      }
    }
    if ((s.manualCases || []).length && s.ui !== true) errors.push(`${at}.manualCases needs ui: true (browser-only cases are walked by the manual tester and belong to the slice that makes them visible)`);
  });
  const missing = env.testCases.filter(tc => !covered.has(tc));
  if (missing.length) errors.push(`Every test case must be assigned to a slice; unassigned: ${missing.join(', ')}`);
  return errors;
}

/** @param {string} text */
export function testCaseIds(text) {
  return [...new Set(text.match(/\bTC-(?:[A-Z][A-Z0-9]*-)?\d{3,}\b/g) || [])].sort();
}
