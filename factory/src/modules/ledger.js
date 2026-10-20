// @ts-check
// Cross-run ledger: the raw material for evals. Every dispatch records model,
// prompt hash, duration and outcome; review steps record findings and how many
// the other reviewer confirmed.

import path from 'node:path';
import { readJsonl, runDir } from '../lib/store.js';

/** @param {number[]} xs */
const avg = xs => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'ledger',
  description: 'Run history for evals: per-role, per-model outcomes across runs.',
  functions: {
    events: {
      signature: 'factory.ledger.events({ runId?: string, event?: string, limit?: number }): Promise<object[]>',
      description: 'Raw ledger rows, newest last.',
      handler: ({ runId, event, limit = 200 }, ctx) => {
        const file = runId ? path.join(runDir(ctx.home, runId), 'ledger.jsonl') : path.join(ctx.home, 'ledger.jsonl');
        return readJsonl(file).filter(e => !event || e.event === event).slice(-limit);
      },
    },
    stats: {
      signature: 'factory.ledger.stats({ since?: string /* ISO date */, role?: string }): Promise<{ dispatches: object[], slices: object[], reviewers: object[] }>',
      description: 'Aggregates for choosing models: success rate, minutes, report rejections, report rejections, and findings raised per feature reviewer.',
      tags: ['eval', 'metrics', 'quality', 'model choice'],
      handler: ({ since, role }, ctx) => {
        const rows = readJsonl(path.join(ctx.home, 'ledger.jsonl')).filter(e => !since || e.ts >= since);
        /** @type {Record<string, any>} */
        const byKey = {};
        const rejections = /** @type {Record<string, number>} */ ({});
        for (const e of rows) if (e.event === 'dispatch.rejected') rejections[`${e.runId}/${e.dispatchId}`] = (rejections[`${e.runId}/${e.dispatchId}`] || 0) + 1;
        for (const e of rows) {
          if (e.event !== 'dispatch.finished' || (role && e.role !== role)) continue;
          const key = `${e.role}:${e.mode} @ ${e.target?.model}`;
          const k = (byKey[key] ??= { role: e.role, mode: e.mode, model: e.target?.model, n: 0, done: 0, failed: 0, minutes: [], rejections: [] });
          k.n++;
          if (e.outcome === 'done') k.done++;
          else k.failed++;
          if (e.durationMs) k.minutes.push(e.durationMs / 60000);
          k.rejections.push(rejections[`${e.runId}/${e.dispatchId}`] || 0);
        }
        const dispatches = Object.values(byKey).map(k => ({ role: k.role, mode: k.mode, model: k.model, n: k.n, successRate: Math.round((k.done / k.n) * 100), avgMinutes: avg(k.minutes), avgRejections: avg(k.rejections) }));
        /** @type {Record<string, any>} */
        const slices = {};
        for (const e of rows) {
          if (e.event !== 'slice.built') continue;
          const m = e.author?.model || 'unknown';
          const s = (slices[m] ??= { author: m, slices: 0 });
          s.slices++;
        }
        /** @type {Record<string, any>} */
        const reviewers = {};
        for (const e of rows) {
          if (e.event !== 'feature.reviewer.score') continue;
          const r = (reviewers[e.model] ??= { model: e.model, rounds: 0, raised: 0, blockingRaised: 0 });
          r.rounds++;
          r.raised += e.raised;
          r.blockingRaised += e.blockingRaised;
        }
        return {
          dispatches,
          slices: Object.values(slices),
          reviewers: Object.values(reviewers),
        };
      },
    },
  },
};
