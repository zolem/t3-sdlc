// @ts-check
// Test harness: plays the foreman thread, every repo thread and every child agent
// against the real factory API, using real git repos and linked worktrees.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Stub role briefs so tests do not depend on prompt content; keep the real policy.
const CONTENT = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-content-'));
fs.mkdirSync(path.join(CONTENT, 'roles'));
fs.mkdirSync(path.join(CONTENT, 'policy'));
fs.copyFileSync(new URL('../../policy/org.json', import.meta.url), path.join(CONTENT, 'policy', 'org.json'));
for (const role of ['product-manager', 'context-curator', 'architect', 'qa-analyst', 'slice-planner', 'explainer', 'engineer', 'manual-tester', 'feature-reviewer', 'docs-writer']) {
  fs.writeFileSync(path.join(CONTENT, 'roles', `${role}.md`), `---\nversion: test\n---\nYou are the ${role}.\n`);
}
process.env.ORCHESTRATE_CONTENT = CONTENT;
const { Registry } = await import('../src/registry.js');
const { loadModules } = await import('../src/modules/index.js');

export const git = (/** @type {string} */ cwd, /** @type {string[]} */ args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const opt = (/** @type {string} */ id, /** @type {string[]} */ values) => ({ id, type: 'select', options: values.map(v => ({ id: v })) });
export const CAPABILITIES = {
  providers: [
    { providerInstanceId: 'claudeAgent', canRunChildTask: true, models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'].map(id => ({ id, options: [opt('effort', ['low', 'medium', 'high'])] })) },
    { providerInstanceId: 'codex', canRunChildTask: true, models: ['gpt-6.1-sol', 'gpt-6-luna'].map(id => ({ id, options: [opt('reasoningEffort', ['low', 'medium', 'high'])] })) },
    { providerInstanceId: 'grok', canRunChildTask: false, models: [{ id: 'grok-build', options: [] }] },
  ],
};

/** @param {string} dir @param {Record<string, string>} files @param {string} msg */
export function commit(dir, files, msg) {
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
}

/** @param {string} dir @param {Record<string, string>} files */
export function initRepo(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.invalid']);
  git(dir, ['config', 'user.name', 'T']);
  commit(dir, { 'README.md': `# ${path.basename(dir)}\n`, ...files }, 'init (#7)\n\nFixes ABC-42 edge case');
}

export const CONTRACT = { checks: [{ id: 'readme', run: 'test -f README.md' }, { id: 'trace', run: 'orchestrate check traceability' }, { id: 'secrets', run: 'orchestrate check secrets' }] };

/** @param {string} tmp @param {string} primaryRoot */
export function factory(tmp, primaryRoot) {
  const home = path.join(tmp, 'home');
  const registry = new Registry();
  for (const m of loadModules()) registry.add(m);
  const signatures = Object.fromEntries(registry.catalog().map(c => [c.path, c.signature]));
  /** @param {string} p @param {any} [args] @param {string} [cwd] */
  const call = async (p, args = {}, cwd = primaryRoot) => {
    const cap = registry.capabilities.get(p);
    if (!cap) throw new Error(`no capability ${p}`);
    return cap.handler(JSON.parse(JSON.stringify(args)), { cwd, home, signatures });
  };
  return { home, call };
}

/**
 * Drive a run to completion. `child(dispatch, ctx)` simulates each delegated agent;
 * `gate(name, round)` answers the human gates; `blocked(action)` answers blocks.
 * @param {{ call: Function, runId: string, tmp: string, child: Function, gate: Function, blocked?: Function }} p
 */
export async function drive({ call, runId, tmp, child, gate, blocked }) {
  /** @type {Record<string, string>} thread worktree per repo */
  const threadWt = {};
  const log = { notifies: /** @type {any[]} */ ([]), launches: /** @type {string[]} */ ([]), dispatches: /** @type {any[]} */ ([]), publish: /** @type {any} */ (null) };
  let task = 0;
  for (let pass = 0; pass < 400; pass++) {
    let progressed = false;
    const info = await call('run.info', { runId });
    const scopes = ['foreman', ...Object.keys(info.repoState || {}).filter(r => info.repos.find((/** @type {any} */ x) => x.name === r) && threadWt[r])];
    for (const scope of scopes) {
      const res = await call('orchestrator.next', scope === 'foreman' ? { runId } : { runId, repo: scope });
      for (const a of res.actions) {
        if (a.type === 'notify') {
          log.notifies.push({ from: scope, to: a.to, message: a.message });
          await call('orchestrator.sent', { runId, id: a.id });
          progressed = true;
        } else if (a.type === 'launch') {
          const wt = path.join(tmp, `thread-${a.repo}`);
          git(a.projectRoot, ['worktree', 'add', '-q', '--detach', wt, a.baseBranch]);
          threadWt[a.repo] = wt;
          log.launches.push(a.repo);
          await call('orchestrator.launched', { runId, repo: a.repo, threadId: `T-${a.repo}` });
          progressed = true;
        } else if (a.type === 'dispatch') {
          await call('orchestrator.started', { runId, dispatchId: a.dispatchId, taskId: `t${++task}` });
          const brief = await call('roles.brief', { runId, dispatchId: a.dispatchId });
          const d = (await call('orchestrator.status', { runId })).running.find((/** @type {any} */ x) => x.id === a.dispatchId);
          log.dispatches.push({ id: a.dispatchId, scope, isolation: a.delegate.isolation, model: d.model });
          await child({ ...a, scope, model: d.model, brief: brief.brief, cwd: scope === 'foreman' ? null : threadWt[scope] }, { threadWt });
          await call('orchestrator.finished', { runId, dispatchId: a.dispatchId, status: 'completed', summary: 'DONE' });
          progressed = true;
        } else if (a.type === 'checkout') {
          await call('workspace.prepare', { runId, repo: scope, cwd: threadWt[scope] }, threadWt[scope]);
          progressed = true;
        } else if (a.type === 'gate') {
          const { decision, notes } = await gate(a.gate, a.round);
          await call('orchestrator.decide', { runId, gate: a.gate, decision, notes });
          progressed = true;
        } else if (a.type === 'blocked') {
          assert.ok(blocked, `unexpected block: ${a.reason}`);
          await call('orchestrator.decide', { runId, gate: 'blocked', scope: a.scope, decision: await blocked(a) });
          progressed = true;
        } else if (a.type === 'publish') {
          log.publish = await call('publish.stack', { runId });
          progressed = true;
        } else if (a.type === 'done') {
          return { ...log, threadWt };
        } else if (['wait', 'idle', 'finished'].includes(a.type)) {
          // nothing to do for this scope right now
        } else {
          throw new Error(`unexpected action ${JSON.stringify(a)}`);
        }
      }
    }
    if (!progressed) throw new Error(`run stalled: ${JSON.stringify(await call('orchestrator.status', { runId }), null, 1).slice(0, 3000)}`);
  }
  throw new Error('run did not finish');
}

/**
 * A child simulator covering every role. `plan` describes the slices and scripted
 * findings. Repo-scoped children work in their repo thread's worktree (shared isolation).
 * @param {{ call: Function, runId: () => string, tmp?: string, plan: any }} p
 */
export function simulatedChildren({ call, runId, plan }) {
  /** @param {any} a */
  const shared = a => {
    assert.ok(a.cwd, `${a.dispatchId} must run in its repo thread's worktree`);
    assert.equal(git(a.cwd, ['status', '--porcelain']), '', `${a.dispatchId} found a dirty shared worktree`);
    return a.cwd;
  };
  const report = (/** @type {string} */ dispatchId, /** @type {any} */ extra = {}) => call('dispatch.report', { runId: runId(), dispatchId, summary: 'ok', ...extra });
  const w = (/** @type {string} */ p, /** @type {string} */ content) => call('run.write', { runId: runId(), path: p, content });
  const info = () => call('run.info', { runId: runId() });

  let prefixed = false;
  return async (/** @type {any} */ a) => {
    if (!prefixed) {
      // Scripted plans use bare TC-NNN; rewrite them with this run's prefix.
      const tc = (await info()).tcPrefix;
      Object.assign(plan, JSON.parse(JSON.stringify(plan).replace(/TC-(\d{3})/g, `TC-${tc}-$1`)));
      prefixed = true;
    }
    const [role, mode] = [a.delegate.task.match(/`([a-z-]+)` agent \(([a-z-]+) mode\)/)[1], a.delegate.task.match(/\(([a-z-]+) mode\)/)[1]];
    const id = a.dispatchId;
    switch (`${role}:${mode}`) {
      case 'product-manager:default': await w('requirements.md', '# R'); return report(id);
      case 'context-curator:default': await w('context.md', '# C'); return report(id);
      case 'architect:default': await w('architecture.md', '# A'); return report(id);
      case 'qa-analyst:default': await w('test-plan.md', plan.slices.map((/** @type {any} */ s) => s.testCases.join('\n')).join('\n') + '\n'); return report(id, { testCases: plan.slices.flatMap((/** @type {any} */ s) => s.testCases) });
      case 'slice-planner:default':
        for (const s of plan.slices) await w(s.spec, `# ${s.title}`);
        await w('slices.json', JSON.stringify({ slices: plan.slices.map((/** @type {any} */ { files, ...s }) => s) }));
        return report(id);
      case 'explainer:plan':
      case 'explainer:stack': {
        const tcs = plan.slices.flatMap((/** @type {any} */ x) => [...x.testCases, ...(x.manualCases || [])]);
        const diagrams = [{ title: 'Main flow', before: 'sequenceDiagram\n  U->>W: open\n  W-->>U: list', after: 'sequenceDiagram\n  U->>W: open\n  W->>A: GET\n  A-->>W: data\n  W-->>U: list' }];
        const slices = plan.slices.map((/** @type {any} */ x) => ({ n: x.n, story: 'unlocks the next slice', whatChanged: 'adds it', whyThisWay: 'per architecture', verify: ['the edge case'] }));
        const tests = tcs.map((/** @type {string} */ tc) => ({ id: tc, what: 'it works', why: 'it could break' }));
        await w(`explainers/${mode}.json`, JSON.stringify(mode === 'plan' ? { intent: 'i', outcome: 'o', diagrams, slices, tests } : { built: 'b', risk: { level: 2, why: 'small' }, diagrams, slices, tests }));
        return report(id);
      }
      case 'engineer:build': {
        const n = Number(id.match(/slice-(\d+)/)[1]);
        const s = (await info()).slices.find((/** @type {any} */ x) => x.n === n);
        const wt = shared(a);
        git(wt, ['switch', '-q', '-c', s.branch, s.baseRef]);
        const spec = plan.slices.find((/** @type {any} */ x) => x.n === n);
        commit(wt, spec.files, `build: slice ${n}\n\nSlice: ${n}`);
        const chk = await call('checks.run', { runId: runId(), dispatchId: id, cwd: wt }, wt);
        assert.equal(chk.ok, true, JSON.stringify(chk.checks));
        git(wt, ['switch', '-q', '--detach']);
        // Automate cases whose id appears in the slice's test files; report the rest as manual-only.
        const text = Object.entries(spec.files).filter(([f]) => /test/.test(f)).map(([, c]) => c).join('\n');
        const tests = s.testCases.map((/** @type {string} */ tc) => (text.includes(tc) ? { id: tc, automated: true, where: 'test/' } : { id: tc, automated: false, why: 'no UI test setup' }));
        return report(id, { branch: s.branch, headSha: chk.sha, tests });
      }
      case 'engineer:feature-fix': {
        const r = await info();
        const repo = a.scope;
        const own = r.slices.filter((/** @type {any} */ x) => x.repo === repo);
        const wt = shared(a);
        git(wt, ['switch', '-q', own[0].branch]);
        commit(wt, { [`feature-fix-${id}.txt`]: 'fixed\n' }, `fix: feature finding\n\nSlice: ${own[0].n}`);
        git(wt, ['switch', '-q', '--detach']);
        const rs = await call('git.restack', { runId: runId(), fromSlice: own[0].n, cwd: wt }, wt);
        assert.equal(rs.ok, true, JSON.stringify(rs));
        for (const s of own) assert.equal((await call('checks.run', { runId: runId(), dispatchId: id, slice: s.n, cwd: wt }, wt)).ok, true);
        if (r.docs?.headSha && r.docs.repo === repo) await call('checks.run', { runId: runId(), dispatchId: id, slice: 'docs', cwd: wt }, wt);
        git(wt, ['switch', '-q', '--detach']);
        const ids = JSON.parse(await call('run.read', { runId: runId(), path: a.brief.match(/`((?:reviews|feedback)\/[^`]+\.json)`/)[1] })).findings.map((/** @type {any} */ f) => f.id);
        return report(id, { addressed: ids.map((/** @type {string} */ fid) => ({ id: fid, slice: own[0].n, how: 'fixed' })) });
      }
      case 'docs-writer:default': {
        const r = await info();
        const wt = shared(a);
        if (id.startsWith('docs.r1')) git(wt, ['switch', '-q', '-c', r.docs.branch, r.docs.baseRef]);
        else git(wt, ['switch', '-q', r.docs.branch]);
        commit(wt, { [`docs/features/x-${id}.md`]: '# Feature\n' }, 'docs: feature\n\nSlice: docs');
        const chk = await call('checks.run', { runId: runId(), dispatchId: id, cwd: wt }, wt);
        git(wt, ['switch', '-q', '--detach']);
        return report(id, { branch: r.docs.branch, headSha: chk.sha, docPath: `docs/features/x-${id}.md` });
      }
      case 'feature-reviewer:review': return report(id, { findings: (plan.featureFindings?.[id] || []) });
      case 'feature-reviewer:recheck': {
        const open = JSON.parse(await call('run.read', { runId: runId(), path: a.brief.match(/`(reviews\/feature-r\d+-recheck-[ab]\.json)`/)[1] })).findings;
        const still = open.filter((/** @type {any} */ f) => plan.stillOpen?.includes(f.id));
        return report(id, { resolved: open.filter((/** @type {any} */ f) => !still.includes(f)).map((/** @type {any} */ f) => f.id), findings: still });
      }
      default:
        throw new Error(`no simulator for ${role}:${mode}`);
    }
  };
}
