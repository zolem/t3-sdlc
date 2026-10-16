// @ts-check
// "Why is this line here?" Blame → commit → PR → ticket, so reviewers can tell
// when a change undoes something that was added on purpose.

import { execFileSync } from 'node:child_process';
import { git, touchedOldRanges } from './git.js';

const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;

/** @type {Map<string, any>} */
const prCache = new Map();

/** @param {string} cwd */
function githubRepo(cwd) {
  const url = git(cwd, ['remote', 'get-url', 'origin'], { allowFail: true });
  const m = url && url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

/** @param {string} cwd @param {string} commit */
function prFor(cwd, commit) {
  const repo = githubRepo(cwd);
  if (!repo) return null;
  const key = `${repo}@${commit}`;
  if (prCache.has(key)) return prCache.get(key);
  let pr = null;
  try {
    const out = execFileSync('gh', ['api', `repos/${repo}/commits/${commit}/pulls`, '--jq', '.[0] | {number, title, url: .html_url, body: (.body // "" | .[0:600])}'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    pr = out ? JSON.parse(out) : null;
  } catch {}
  prCache.set(key, pr);
  return pr;
}

/** @param {string} cwd @param {string} commit @param {boolean} lookupPr */
function describe(cwd, commit, lookupPr) {
  const raw = git(cwd, ['show', '-s', '--format=%H%x1f%an%x1f%as%x1f%s%x1f%b', commit]);
  const [hash, author, date, subject, body] = raw.split('\x1f');
  const text = `${subject}\n${body}`;
  const prNum = (subject.match(/\(#(\d+)\)\s*$/) || body.match(/Merge pull request #(\d+)/) || [])[1];
  const pr = lookupPr ? prFor(cwd, hash) : null;
  const tickets = [...new Set([...(text.match(TICKET) || []), ...((pr?.title || '') + (pr?.body || '')).match(TICKET) || []])];
  return { sha: hash.slice(0, 12), author, date, subject, body: body.trim().slice(0, 600), pr: pr || (prNum ? { number: Number(prNum) } : null), tickets };
}

/**
 * @param {{ cwd: string, file: string, start: number, end?: number, ref?: string, lookupPr?: boolean }} opts
 */
export function why({ cwd, file, start, end, ref = 'HEAD', lookupPr = true }) {
  const out = git(cwd, ['blame', '--porcelain', '-L', `${start},${end ?? start}`, ref, '--', file]);
  const shas = [...new Set(out.split('\n').filter(l => /^[0-9a-f]{40} /.test(l)).map(l => l.slice(0, 40)))].filter(s => !/^0+$/.test(s));
  return { file, lines: `${start}-${end ?? start}`, ref, commits: shas.slice(0, 10).map(s => describe(cwd, s, lookupPr)) };
}

/**
 * For every old line a diff removes or rewrites, who added it and why.
 * @param {{ cwd: string, base: string, head: string, lookupPr?: boolean, maxRanges?: number }} opts
 */
export function forDiff({ cwd, base, head, lookupPr = true, maxRanges = 60 }) {
  const ranges = touchedOldRanges(cwd, base, head).slice(0, maxRanges);
  /** @type {Map<string, any>} */
  const commits = new Map();
  const touched = [];
  for (const r of ranges) {
    const out = git(cwd, ['blame', '--porcelain', '-L', `${r.start},${r.end}`, base, '--', r.file], { allowFail: true });
    if (!out) continue;
    const shas = [...new Set(out.split('\n').filter(l => /^[0-9a-f]{40} /.test(l)).map(l => l.slice(0, 40)))];
    for (const s of shas) if (!commits.has(s)) commits.set(s, describe(cwd, s, lookupPr));
    touched.push({ file: r.file, lines: `${r.start}-${r.end}`, commits: shas.map(s => s.slice(0, 12)) });
  }
  return {
    note: 'Old lines this change removes or rewrites, with the commits that introduced them. Check that each change respects the original intent (bug fixes, edge cases, tickets).',
    touched,
    commits: Object.fromEntries([...commits.values()].map(c => [c.sha, c])),
  };
}
