// @ts-check
import { findDispatch } from '../lib/pipeline.js';
import { validateReport } from '../lib/report.js';
import { ledger, listRunFiles, loadRun, mutateRun, readRunFile, runFileExists, writeRunFile } from '../lib/runs.js';
import { now, runFile } from '../lib/store.js';
import { planPage, stackPage } from '../lib/explainer.js';
import { verdictOf } from '../lib/contracts.js';

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'dispatch',
  description: 'How a child agent hands its result back to the pipeline.',
  functions: {
    report: {
      signature: 'factory.dispatch.report({ runId: string, dispatchId: string, summary: string, ...roleFields }): Promise<{ accepted: true } | throws with what to fix>',
      description: 'Submit your result. The factory validates it against your role contract (files, branches, passing checks, finding shapes) and rejects incomplete work with a list of fixes.',
      tags: ['done', 'finish', 'result', 'submit'],
      handler: ({ runId, dispatchId, ...report }, ctx) => {
        const run = loadRun(ctx.home, runId);
        const d = findDispatch(run, dispatchId);
        if (d.status === 'done') return { accepted: true, note: 'Already accepted earlier.' };
        if (d.status === 'failed') throw new Error('This dispatch was already closed as failed; stop and reply BLOCKED.');
        const files = { exists: (/** @type {string} */ rel) => runFileExists(ctx.home, runId, rel), read: (/** @type {string} */ rel) => readRunFile(ctx.home, runId, rel) };
        const { errors, apply } = validateReport({ run, dispatch: d, report, files });
        if (errors.length) {
          ledger(ctx.home, runId, { event: 'dispatch.rejected', dispatchId, errors });
          throw new Error(`Report rejected. Fix these and report again:\n- ${errors.join('\n- ')}`);
        }
        if (d.role === 'explainer') {
          // The factory owns the page: fill the template from the validated JSON and the run state.
          const pageCtx = { run, ...files, list: (/** @type {string} */ prefix) => listRunFiles(ctx.home, runId, prefix).map(f => f.path), abs: (/** @type {string} */ rel) => runFile(ctx.home, runId, rel) };
          const doc = JSON.parse(readRunFile(ctx.home, runId, `explainers/${d.mode}.json`));
          writeRunFile(ctx.home, runId, `explainers/${d.mode}.html`, d.mode === 'plan' ? planPage(doc, pageCtx) : stackPage(doc, pageCtx));
        }
        const verdict = Array.isArray(report.findings) && ['feature-reviewer', 'manual-tester'].includes(d.role) ? verdictOf(report.findings) : undefined;
        writeRunFile(ctx.home, runId, `reports/${dispatchId}.json`, JSON.stringify({ dispatchId, role: d.role, mode: d.mode, model: d.target.model, verdict, ...report }, null, 2));
        mutateRun(ctx.home, runId, r => {
          const x = findDispatch(r, dispatchId);
          x.status = 'done';
          x.reportedAt = now();
          x.report = report;
          x.verdict = verdict;
          apply(r);
        });
        const counts = Array.isArray(report.findings) ? report.findings.reduce((/** @type {Record<string, number>} */ acc, /** @type {any} */ f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), {}) : undefined;
        ledger(ctx.home, runId, { event: 'dispatch.reported', dispatchId, role: d.role, mode: d.mode, target: d.target, family: d.family, promptHash: d.promptHash, verdict, findings: counts, slice: d.slice });
        return { accepted: true, verdict };
      },
    },
  },
};
