// @ts-check
// Called only by the orchestrator thread. It never chooses what happens next:
// it executes the actions these functions return.

import path from 'node:path';
import { activeRepos, advance, decide, findDispatch, DEFAULT_SETTINGS, FOREMAN } from '../lib/pipeline.js';
import { availabilityFrom, availabilityFromList, loadPolicy, policyTargets, resolveTargets } from '../lib/policy.js';
import { CONTRACTS } from '../lib/contracts.js';
import { commonRoot, currentBranch, repoRoot, sha } from '../lib/git.js';
import { createRunDir, ledger, listRuns, loadRun, mutateRun, readRunFile, runFileExists, writeRunFile } from '../lib/runs.js';
import { loadContract, readWorkspace } from '../lib/repoContract.js';
import { doctor } from '../lib/doctor.js';
import { getIssue, issueToBrief, linearConfigured } from '../lib/linear.js';
import { now, readJsonl, runDir, slugify } from '../lib/store.js';
import { runInfo } from './run.js';
import { writeCostReport } from './report.js';

/** @param {string} home @param {string} runId */
export function envFor(home, runId) {
  return {
    exists: (/** @type {string} */ rel) => runFileExists(home, runId, rel),
    read: (/** @type {string} */ rel) => readRunFile(home, runId, rel),
    write: (/** @type {string} */ rel, /** @type {string} */ content) => writeRunFile(home, runId, rel, content),
    ledger: (/** @type {object} */ entry) => ledger(home, runId, entry),
  };
}

/** @param {string} home @param {string} runId */
/** @param {string} home @param {string} runId @param {string} [scope] */
function step(home, runId, scope = FOREMAN) {
  return mutateRun(home, runId, run => {
    if (scope !== FOREMAN && !run.repos[scope]) throw new Error(`Unknown repo "${scope}" (run repos: ${Object.keys(run.repos).join(', ')})`);
    const acts = advance(run, envFor(home, runId), scope);
    return { runId, scope, status: run.status, cursor: run.cursor, ...(scope !== FOREMAN ? { phase: run.repoState?.[scope]?.phase } : {}), actions: acts };
  });
}

/** @param {any} run */
function routingTable(run) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const role of Object.keys(CONTRACTS)) {
    try {
      const r = resolveTargets({ policy: run.policy, role, availability: run.availability });
      out[role] = r.targets.map(t => `${t.providerInstanceId}/${t.model}`).join(' + ');
    } catch (err) {
      out[role] = `UNROUTABLE: ${err instanceof Error ? err.message : err}`;
    }
  }
  return out;
}

/** Cost section of the summary (settings.costReport, on by default). Never fails the summary. @param {string} home @param {any} run */
function costSection(home, run) {
  if (run.settings?.costReport === false) return [];
  try {
    const c = writeCostReport(home, run.id);
    const $ = (/** @type {number} */ x) => `$${x.toFixed(2)}`;
    return [
      '',
      '### Cost (API list price)',
      `${c.totals.estimatedUsd ? '~' : ''}${$(c.totals.usd)}${c.totals.estimatedUsd ? ` (${$(c.totals.measuredUsd)} measured + ${$(c.totals.estimatedUsd)} estimated)` : ''} · ${c.totals.wallMinutes} min wall · ${c.totals.tokens.total >= 1e6 ? `${(c.totals.tokens.total / 1e6).toFixed(1)}M` : `${Math.round(c.totals.tokens.total / 1000)}k`} tokens${c.totals.unmeasured ? ` · ${c.totals.unmeasured} unmeasured` : ''}`,
      ...c.byPhase.map(p => `- ${p.label}: ${$(p.usd + p.estimatedUsd)}${p.wallMinutes !== null ? `, ${p.wallMinutes} min` : ''}`),
      `Full report: \`${c.htmlPath}\`. Show it: factory.run.read({ runId: "${run.id}", path: "${c.runPath}" }), then html_render.`,
    ];
  } catch (err) {
    return ['', `Cost report unavailable: ${err instanceof Error ? err.message : err}`];
  }
}

const ACTION_HELP = `Execute every action in order:
- notify: t3_thread_send the message to action.threadId, then factory.orchestrator.sent({ runId, id }).
- launch (foreman): start the repo thread as action.how says, then factory.orchestrator.launched({ runId, repo, threadId }).
- dispatch: call delegate_task with exactly action.delegate (task, target, isolation, role, mode, title, clientRequestId), then factory.orchestrator.started({ runId, dispatchId, taskId, childThreadId }). Start all dispatch actions before waiting.
- wait / idle: end your turn. A finished child or a message from another thread wakes you; then call factory.orchestrator.finished(...) or next(...).
- gate / blocked / publish / done / checkout / finished: follow action.how.`;

/** @type {import('../registry.js').ModuleDef} */
export default {
  name: 'orchestrator',
  description: 'Drive a run: start it, get the next actions, record dispatch lifecycle and human decisions. Orchestrator thread only.',
  functions: {
    start: {
      signature: 'factory.orchestrator.start({ repo: string /* target repo path */, threadId: string /* your own T3 thread id: repo threads report to it */, brief?: string, ticket?: string /* e.g. "ABC-123" */, title?: string, available?: string[] /* the policy targets orchestrator_capabilities lists, as "providerInstanceId/model" (start returns an availability action listing them) */, skip?: ("browser-validation" | "publish")[] /* optional stages the user agreed to run without */, overrides?: { roles: Record<string, { targets: Target[] }> }, allowDirty?: boolean }): Promise<{ runId, routing, unavailable, actions } | { preflight, actions: [{ type: "preflight" }] } | { actions: [{ type: "availability", targets }] }>',
      description: 'Preflight the repo (or workspace) with the doctor, then create a run from a prompt or Linear ticket, freeze the routing policy against live capabilities, and return the first actions. When something the flow needs is missing, returns a preflight action instead of starting.',
      tags: ['begin', 'new run', 'kickoff', 'ticket', 'linear'],
      handler: async ({ repo, threadId, brief, ticket, title, available, capabilities, overrides, allowDirty, settings, skip }, ctx) => {
        if (!threadId) throw new Error('Pass threadId: your own T3 thread id (t3_thread_list returns it as currentThreadId). Repo threads report to it.');
        const root = commonRoot(repoRoot(path.resolve(ctx.cwd, repo || '.')));
        const skipList = Array.isArray(skip) ? skip : [];
        const pre = await doctor({ cwd: root, forStart: true, skip: allowDirty ? [...skipList, 'clean-tree'] : skipList });
        const blocking = pre.capabilities.filter(c => c.level === 'required' && !['ok', 'unverified'].includes(c.status) && !(allowDirty && c.id === 'clean-tree'));
        if (blocking.length || pre.needsDecision.length) {
          return {
            started: false,
            preflight: { blocking: blocking.map(c => `${c.repo}:${c.id}`), needsDecision: pre.needsDecision, report: pre.report },
            actions: [{
              type: 'preflight',
              blocking: blocking.length > 0,
              needsDecision: pre.needsDecision,
              how: blocking.length
                ? 'Show the report to the user. The run cannot start until every ❌ item is fixed. Offer the setup skill (/orchestrate-setup) to fix them, then call start again.'
                : `Show the report to the user. These optional stages are unavailable: ${pre.needsDecision.join(', ')}. Ask whether to set them up first (setup skill, then start again) or continue without them (call start again with skip: ${JSON.stringify(pre.needsDecision)}).`,
            }],
          };
        }
        const ws = readWorkspace(root);
        let briefText = brief || '';
        let intake = { kind: 'prompt' };
        if (ticket) {
          if (!brief && !linearConfigured()) throw new Error(`Ticket ${ticket} given but the factory has no Linear key. Fetch the ticket yourself (Linear MCP) and pass its text as brief, keeping ticket for traceability.`);
          if (!brief) {
            const issue = await getIssue(ticket);
            briefText = issueToBrief(issue);
            title ??= `${issue.identifier} ${issue.title}`;
            intake = { kind: 'linear', ...{ ticket: issue.identifier, url: issue.url } };
          } else intake = { kind: 'linear', ...{ ticket } };
        }
        if (!briefText.trim()) throw new Error('Provide brief (prompt text) or ticket.');
        const firstLine = (briefText.split('\n').find((/** @type {string} */ l) => l.trim()) || 'feature').replace(/^#+\s*/, '');
        const runTitle = (title || firstLine.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '')).slice(0, 100);
        const stamp = now().replace(/[-:T]/g, '').slice(0, 12);
        const id = `${slugify(runTitle.split(/\s+/).slice(0, 6).join(' '))}-${stamp}`;
        const { policy, sources } = loadPolicy({ home: ctx.home, repo: root, overrides });
        const targets = policyTargets(policy);
        if (!Array.isArray(available) && !capabilities?.providers) {
          return {
            started: false,
            actions: [{
              type: 'availability',
              targets,
              how: 'Check each target against your orchestrator_capabilities result: available when that providerInstanceId has canRunChildTask true and lists that model id. Call start again with the same arguments plus available: the targets that are available, copied exactly.',
            }],
          };
        }
        // `available` (a short list the orchestrator checked) is preferred: copying the whole capabilities payload by hand drops models and options.
        const availability = Array.isArray(available) ? availabilityFromList(available) : availabilityFrom(capabilities);
        const unavailable = targets.filter(t => !(availability.available[t.slice(0, t.indexOf('/'))] || []).includes(t.slice(t.indexOf('/') + 1)));
        /** @type {Record<string, any>} */
        const repos = {};
        for (const r of ws.repos) repos[r.name] = { name: r.name, root: r.root, primary: r.primary, baseBranch: currentBranch(r.root) || 'HEAD', baseSha: sha(r.root), contract: loadContract(r.root) };
        const primary = Object.values(repos).find(r => r.primary);
        const run = {
          id, title: runTitle, status: 'active', cursor: 'intake', createdAt: now(), updatedAt: now(),
          tcPrefix: runTitle.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 4).map(w => w[0].toUpperCase()).join('') + stamp.slice(-2),
          intake,
          repo: primary,
          repos,
          foreman: { threadId },
          repoState: {},
          outbox: [],
          workspace: { name: ws.name, app: ws.app },
          capabilities: { ...pre.enabled, skipped: skipList },
          policy, policySources: sources, availability,
          settings: { ...DEFAULT_SETTINGS, ...(policy.settings || {}), ...(settings || {}) },
          dispatches: [], gates: { plan: [], stack: [] }, slices: [], feature: { round: 1 }, docs: null, stackRound: 1, allowances: {}, prs: [], blocked: {},
        };
        const routing = routingTable(run);
        const broken = Object.entries(routing).filter(([, v]) => v.startsWith('UNROUTABLE'));
        if (broken.length) throw new Error(`Policy cannot be satisfied with the providers available right now:\n${broken.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
        createRunDir(ctx.home, run);
        writeRunFile(ctx.home, id, 'brief.md', briefText.trim() + '\n');
        ledger(ctx.home, id, { event: 'run.started', title: runTitle, repo: root, repos: Object.keys(repos), capabilities: run.capabilities, intake, routing, unavailable, policySources: sources.map(s => s.layer) });
        const first = step(ctx.home, id);
        return { runId: id, title: runTitle, runFolder: path.join(runDir(ctx.home, id), 'files'), routing, unavailable, ...first, help: ACTION_HELP };
      },
    },
    next: {
      signature: 'factory.orchestrator.next({ runId: string, repo?: string /* repo threads pass their repo; the foreman omits it */ }): Promise<{ scope, status, cursor, phase?, actions }>',
      description: "Advance the pipeline and return the actions for your scope (the foreman, or one repo's thread). Safe to call any time (idempotent).",
      tags: ['continue', 'resume', 'advance'],
      handler: ({ runId, repo }, ctx) => step(ctx.home, runId, repo || FOREMAN),
    },
    launched: {
      signature: 'factory.orchestrator.launched({ runId: string, repo: string, threadId: string }): Promise<{ scope, actions }>',
      description: 'Foreman: record the T3 thread launched for a repo (from a launch action).',
      tags: ['launch', 'repo thread'],
      handler: ({ runId, repo, threadId }, ctx) => {
        mutateRun(ctx.home, runId, run => {
          if (!run.repos[repo]) throw new Error(`Unknown repo "${repo}"`);
          run.repos[repo].thread = { threadId, launchedAt: now() };
          // The launch message already tells the thread to start; drop older queued pings to it.
          for (const m of run.outbox || []) if (m.to === repo && !m.sent) m.sent = true;
        });
        ledger(ctx.home, runId, { event: 'repo.launched', repo, threadId });
        return step(ctx.home, runId, FOREMAN);
      },
    },
    sent: {
      signature: 'factory.orchestrator.sent({ runId: string, id: string }): Promise<{ ok: true }>',
      description: 'Record that a notify action was delivered with t3_thread_send.',
      handler: ({ runId, id }, ctx) => mutateRun(ctx.home, runId, run => {
        const m = (run.outbox || []).find((/** @type {any} */ x) => x.id === id);
        if (!m) throw new Error(`Unknown message ${id}`);
        m.sent = true;
        m.sentAt = now();
        return { ok: true };
      }),
    },
    started: {
      signature: 'factory.orchestrator.started({ runId: string, dispatchId: string, taskId: string, childThreadId?: string }): Promise<{ ok: true }>',
      description: 'Record that delegate_task accepted a dispatch.',
      handler: ({ runId, dispatchId, taskId, childThreadId }, ctx) => mutateRun(ctx.home, runId, run => {
        const d = findDispatch(run, dispatchId);
        if (d.status === 'pending') {
          d.status = 'started';
          d.startedAt = now();
        }
        d.taskId = taskId;
        d.childThreadId = childThreadId;
        ledger(ctx.home, runId, { event: 'dispatch.started', dispatchId, taskId, childThreadId, target: d.target });
        return { ok: true };
      }),
    },
    finished: {
      signature: "factory.orchestrator.finished({ runId: string, dispatchId: string, status: 'completed' | 'failed' | 'cancelled', summary?: string }): Promise<{ status, cursor, actions }>",
      description: 'Record that a delegated task ended (from task_status), then advance. A task that ends without a valid report is retried, falling back to the next model in the policy.',
      tags: ['complete', 'task_status', 'wake'],
      handler: ({ runId, dispatchId, status, summary }, ctx) => {
        mutateRun(ctx.home, runId, run => {
          const d = findDispatch(run, dispatchId);
          d.finishedAt = now();
          d.taskStatus = status;
          d.finalReply = String(summary || '').slice(0, 2000);
          if (d.status !== 'done') {
            d.status = 'failed';
            d.error = status === 'completed' ? `Child finished without a valid factory.dispatch.report. Its reply: ${String(summary || '').slice(0, 400)}` : `Task ${status}: ${String(summary || '').slice(0, 400)}`;
          }
          const ms = d.startedAt ? Date.parse(d.finishedAt) - Date.parse(d.startedAt) : null;
          ledger(ctx.home, runId, { event: 'dispatch.finished', dispatchId, role: d.role, mode: d.mode, target: d.target, family: d.family, outcome: d.status, taskStatus: status, durationMs: ms, promptHash: d.promptHash, error: d.error });
        });
        return step(ctx.home, runId, findDispatch(loadRun(ctx.home, runId), dispatchId).scope || FOREMAN);
      },
    },
    decide: {
      signature: "factory.orchestrator.decide({ runId: string, gate: 'plan' | 'stack' | 'blocked', decision: 'approve' | 'changes' | 'retry' | 'accept' | 'abort', notes?: string, scope?: string /* which blocked scope */, repos?: string[] /* stack changes: which repos (default all) */ }): Promise<{ status, cursor, actions }>",
      description: "Foreman: record the human's decision at a gate (approve / changes with notes) or for a blocked scope (retry / abort; accept continues past open feature findings), then advance.",
      tags: ['approve', 'gate', 'review', 'human', 'feedback'],
      handler: ({ runId, gate, decision, notes, scope, repos }, ctx) => {
        mutateRun(ctx.home, runId, run => decide(run, { gate, decision, notes, scope, repos }, envFor(ctx.home, runId)));
        return step(ctx.home, runId, FOREMAN);
      },
    },
    status: {
      signature: 'factory.orchestrator.status({ runId: string }): Promise<object>',
      description: 'Compact run state: cursor, slices, running and failed dispatches, last events.',
      tags: ['progress', 'state'],
      handler: ({ runId }, ctx) => {
        const run = loadRun(ctx.home, runId);
        const events = readJsonl(path.join(runDir(ctx.home, runId), 'ledger.jsonl')).slice(-15);
        return {
          ...runInfo(run),
          repoThreads: activeRepos(run).map(n => ({ repo: n, threadId: run.repos[n].thread?.threadId || null, phase: run.repoState?.[n]?.phase, waitingOn: run.repoState?.[n]?.waitingOn })),
          unsentMessages: (run.outbox || []).filter((/** @type {any} */ m) => !m.sent).map((/** @type {any} */ m) => ({ id: m.id, from: m.from, to: m.to })),
          blocked: run.blocked,
          running: run.dispatches.filter((/** @type {any} */ d) => d.status === 'started').map((/** @type {any} */ d) => ({ id: d.id, scope: d.scope, title: d.title, model: d.target.model, taskId: d.taskId, since: d.startedAt })),
          failed: run.dispatches.filter((/** @type {any} */ d) => d.status === 'failed').map((/** @type {any} */ d) => ({ id: d.id, error: d.error })),
          recentEvents: events.map(e => `${e.ts} ${e.event} ${e.dispatchId || e.to || ''}`.trim()),
        };
      },
    },
    summary: {
      signature: 'factory.orchestrator.summary({ runId: string }): Promise<string>',
      description: 'Markdown handoff summary: what was built, PRs, verification, models used, time per stage.',
      tags: ['handoff', 'report', 'done'],
      handler: ({ runId }, ctx) => {
        const run = loadRun(ctx.home, runId);
        const done = run.dispatches.filter((/** @type {any} */ d) => d.status === 'done');
        const mins = (/** @type {any} */ d) => (d.startedAt && d.finishedAt ? Math.round((Date.parse(d.finishedAt) - Date.parse(d.startedAt)) / 60000) : null);
        const lines = [
          `## ${run.title}`,
          '',
          `Run \`${run.id}\` — ${run.status}${run.status === 'active' ? ` (at ${run.cursor})` : ''}. Artifacts: \`${path.join(runDir(ctx.home, run.id), 'files')}\``,
          '',
          '### PR stack',
          ...(run.prs.length ? run.prs.map((/** @type {any} */ p) => `- ${p.title}${p.url ? ` — ${p.url}` : ' (dry run)'}`) : ['Not published.']),
          '',
          '### Slices',
          ...run.slices.map((/** @type {any} */ s) => `- ${s.n}. [${s.repo}] ${s.title} — ${s.phase}, \`${s.branch}\``),
          '',
          '### Feature review',
          run.feature.last ? `Round ${run.feature.last.round}: ${run.feature.last.blocking} blocking, ${run.feature.last.minor} minor.${run.feature.accepted ? ` The user accepted ${run.feature.accepted.open} open finding(s).` : ''}` : 'Not run.',
          '',
          '### Who did what',
          '| Dispatch | Model | Minutes |',
          '|---|---|---|',
          ...done.map((/** @type {any} */ d) => `| ${d.title} | ${d.target.model} | ${mins(d) ?? '–'} |`),
          ...costSection(ctx.home, run),
        ];
        return lines.join('\n');
      },
    },
    list: {
      signature: 'factory.orchestrator.list(): Promise<{ id, title, status, cursor, repo, createdAt }[]>',
      description: 'All runs, newest first. Use to resume an earlier run.',
      tags: ['runs', 'history', 'resume'],
      handler: (_args, ctx) => listRuns(ctx.home),
    },
  },
};
