// @ts-check
import path from 'node:path';
import { forDiff, why } from '../lib/history.js';
import { loadRun } from '../lib/runs.js';
import { sliceRanges } from './git.js';

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'history',
  description: 'Why code exists: blame → commit → PR → ticket, so changes do not undo deliberate past work.',
  functions: {
    why: {
      signature: 'factory.history.why({ file: string, start: number, end?: number, ref?: string, cwd?: string /* any checkout of the repo */ }): Promise<{ commits: { sha, author, date, subject, body, pr, tickets }[] }>',
      description: 'Commits (with PR and ticket ids) that introduced the given lines.',
      tags: ['blame', 'intent', 'git log', 'context'],
      handler: ({ file, start, end, ref, cwd, runId }, ctx) => {
        const dir = cwd ? path.resolve(ctx.cwd, cwd) : runId ? loadRun(ctx.home, runId).repo.root : ctx.cwd;
        return why({ cwd: dir, file, start, end, ref });
      },
    },
    forDiff: {
      signature: 'factory.history.forDiff({ runId: string, slice: number | "docs" | "all" }): Promise<{ repo, touched: { file, lines, commits }[], commits: Record<sha, { subject, body, pr, tickets }> }[] /* one entry per repo */>',
      description: 'For every existing line a slice removes or rewrites, the commits that added it and their stated purpose.',
      tags: ['blame', 'regression', 'review', 'intent'],
      handler: ({ runId, slice }, ctx) => {
        const run = loadRun(ctx.home, runId);
        return sliceRanges(run, slice).map(({ repo, root, base, head }) => ({ repo, ...forDiff({ cwd: root, base, head }) }));
      },
    },
  },
};
