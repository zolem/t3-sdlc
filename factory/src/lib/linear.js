// @ts-check
// Minimal Linear client. The API key never reaches agent code: it is read here
// from LINEAR_API_KEY or the macOS keychain item
//   security add-generic-password -s orchestrate-factory -a linear -w <key>

import { execFileSync } from 'node:child_process';

function apiKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'orchestrate-factory', '-a', 'linear', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function linearConfigured() {
  return Boolean(apiKey());
}

/** @param {string} query @param {Record<string, unknown>} variables */
async function gql(query, variables) {
  const key = apiKey();
  if (!key) throw new Error('Linear is not configured for the factory. Store a key with: security add-generic-password -s orchestrate-factory -a linear -w <LINEAR_API_KEY>  (or set LINEAR_API_KEY for the harness). Until then, pass the ticket text as `brief`.');
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = /** @type {any} */ (await res.json());
  if (json.errors) throw new Error(`Linear: ${json.errors.map((/** @type {any} */ e) => e.message).join('; ')}`);
  return json.data;
}

/** @param {string} id e.g. "ABC-123" */
export async function getIssue(id) {
  const data = await gql(
    `query($id: String!) { issue(id: $id) { identifier title description url priority state { name } labels { nodes { name } } comments(first: 20) { nodes { body user { name } createdAt } } } }`,
    { id },
  );
  const i = data.issue;
  return {
    identifier: i.identifier, title: i.title, url: i.url, state: i.state?.name, priority: i.priority,
    labels: i.labels.nodes.map((/** @type {any} */ l) => l.name), description: i.description || '',
    comments: i.comments.nodes.map((/** @type {any} */ c) => ({ by: c.user?.name, at: c.createdAt, body: c.body })),
  };
}

/** @param {string} id @param {string} body */
export async function comment(id, body) {
  const issue = await gql(`query($id: String!) { issue(id: $id) { id } }`, { id });
  const data = await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { url } } }`, { input: { issueId: issue.issue.id, body } });
  return data.commentCreate;
}

/** @param {any} issue */
export function issueToBrief(issue) {
  const parts = [`# ${issue.identifier}: ${issue.title}`, '', `Linear: ${issue.url}`, `State: ${issue.state} · Labels: ${issue.labels.join(', ') || 'none'}`, '', issue.description || '(no description)'];
  if (issue.comments.length) {
    parts.push('', '## Comments');
    for (const c of issue.comments) parts.push('', `**${c.by}** (${c.at}):`, c.body);
  }
  return parts.join('\n');
}
