// @ts-check
import { buildCostReport, renderCostHtml } from '../lib/costReport.js';
import { loadRun, writeRunFile } from '../lib/runs.js';
import { runFile } from '../lib/store.js';

/**
 * Build and save the cost report for a run. Shared with orchestrator.summary.
 * @param {string} home @param {string} runId @param {{ paths?: Record<string, string | undefined> }} [opts]
 */
export function writeCostReport(home, runId, opts = {}) {
  const run = loadRun(home, runId);
  const rep = buildCostReport(run, { home, paths: opts.paths });
  writeRunFile(home, runId, 'reports/cost.json', JSON.stringify(rep, null, 2));
  writeRunFile(home, runId, 'reports/cost.html', renderCostHtml(rep));
  return {
    htmlPath: runFile(home, runId, 'reports/cost.html'),
    runPath: 'reports/cost.html',
    totals: rep.totals,
    byPhase: rep.byPhase.map(p => ({ phase: p.phase, label: p.label, wallMinutes: p.wallMinutes, usd: p.usd, estimatedUsd: p.estimatedUsd, tokens: p.tokens.total })),
    gaps: rep.gaps,
  };
}

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'report',
  description: 'Run reports for humans: what a run cost (at API list prices) and how long each step took.',
  functions: {
    cost: {
      signature: 'factory.report.cost({ runId: string }): Promise<{ htmlPath, runPath: "reports/cost.html", totals: { usd, measuredUsd, estimatedUsd, wallMinutes, gateMinutes, tokens, unmeasured }, byPhase, gaps }>',
      description: "Measure every dispatch's and coordinator thread's tokens from the provider session logs (via T3's thread → session mapping), price them at API list prices (policy/rates.json, layered with ~/.t3-sdlc/rates.json and the repo's .orchestrate/rates.json), and write reports/cost.json plus reports/cost.html (timeline, by phase, by model). Missing usage sources degrade to timing only. Show the HTML with html_render.",
      tags: ['cost', 'tokens', 'usage', 'price', 'spend', 'timing'],
      handler: ({ runId }, ctx) => writeCostReport(ctx.home, runId),
    },
  },
};
