// @ts-check
import meta from './meta.js';
import orchestrator from './orchestrator.js';
import roles from './roles.js';
import dispatch from './dispatch.js';
import run from './run.js';
import checks from './checks.js';
import app from './app.js';
import git from './git.js';
import history from './history.js';
import publish from './publish.js';
import policy from './policy.js';
import ledger from './ledger.js';
import integrations from './integrations.js';
import workspace from './workspace.js';

/** @returns {import('../registry.js').ModuleDef[]} */
export function loadModules() {
  return [orchestrator, roles, dispatch, run, workspace, checks, app, git, history, publish, policy, ledger, ...integrations, meta];
}
