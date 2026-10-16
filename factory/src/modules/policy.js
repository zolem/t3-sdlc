// @ts-check
import path from 'node:path';
import { availabilityFrom, familyOf, loadPolicy, resolveTargets } from '../lib/policy.js';
import { loadRun } from '../lib/runs.js';

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'policy',
  description: 'Which provider/model runs each role (org defaults → user → repo → run overrides).',
  functions: {
    show: {
      signature: 'factory.policy.show({ repo?: string, runId?: string }): Promise<{ policy, sources }>',
      description: 'The merged routing policy and the layer files it came from. With runId, the frozen policy that run uses.',
      tags: ['routing', 'models', 'config'],
      handler: ({ repo, runId }, ctx) => {
        if (runId) {
          const run = loadRun(ctx.home, runId);
          return { policy: run.policy, sources: run.policySources };
        }
        return loadPolicy({ home: ctx.home, repo: repo ? path.resolve(ctx.cwd, repo) : undefined });
      },
    },
    resolve: {
      signature: 'factory.policy.resolve({ role: string, repo?: string, capabilities?: object, avoidFamilies?: string[] }): Promise<{ targets, fallbacks, skipped, warnings }>',
      description: 'Preview which model a role would get, given live orchestrator_capabilities.',
      tags: ['routing', 'models'],
      handler: ({ role, repo, capabilities, avoidFamilies }, ctx) => {
        const { policy } = loadPolicy({ home: ctx.home, repo: repo ? path.resolve(ctx.cwd, repo) : undefined });
        return resolveTargets({ policy, role, availability: capabilities ? availabilityFrom(capabilities) : undefined, avoidFamilies });
      },
    },
    family: {
      signature: 'factory.policy.family({ providerInstanceId: string, model: string }): Promise<string>',
      description: 'Model family used for cross-family review rules.',
      handler: t => familyOf(t),
    },
  },
};
