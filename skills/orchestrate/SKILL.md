---
name: orchestrate
description: ALWAYS use this skill when a message starts with "orchestrate" (e.g. "orchestrate ABC-123", "orchestrate: <brief>"), and never implement that request yourself. Runs the t3-sdlc factory for a ticket or product brief. This thread starts the run and hands it to a run thread, then only comes back to the user for plan approval, PR-stack approval, blocks and the finish. Also use when the user asks to build or ship a ticket or brief with the factory, or to resume a factory run.
argument-hint: <ticket id like ABC-123, or a product brief>
---

# Orchestrate (the user's thread)

Request: $ARGUMENTS
(If the line above is empty or literally `$ARGUMENTS`, the request is the text the user sent.)

This is the user's thread. You start the run, launch a **run thread** that does all the orchestration, and then stay quiet: you only come back when a person has to decide something (a gate or a block) or when the run is done. You do no SDLC work, you never start child tasks, and you never summarise the factory's pages in your own words: you give the user a link. Keep every message to the user to one or two lines.

## Tools
- **The factory CLI**, `~/.t3-sdlc/bin/t3-sdlc`. Run it from this checkout. Every call below is `factory.<module>.<fn>(...)` inside one exec:
  ```sh
  ~/.t3-sdlc/bin/t3-sdlc exec - <<'JS'
  async () => factory.orchestrator.next({ runId: "...", scope: "desk" })
  JS
  ```
  It prints `{ ok, result }` or `{ ok: false, error }` as JSON. If it says it needs full access, tell the user to switch this thread to Full access and stop.
- **T3:** `orchestrator_capabilities`, `t3_thread_list`, `t3_project_list`, `t3_project_create`, `t3_thread_launch`, `t3_thread_send`, `t3_thread_organize`, `preview_open`.

## Start
1. `orchestrator_capabilities`, and `t3_thread_list({ limit: 1 })` → keep `currentThreadId` as YOUR_THREAD_ID.
2. Intake:
   - Looks like a ticket id (e.g. `ABC-123`): pass `ticket`. If the factory says Linear is not configured and you have a Linear tool, fetch the issue yourself and pass its text as `brief`, plus `ticket`.
   - Otherwise pass the text as `brief`.
   - To resume (`resume <runId>`, or the user asks): skip `start` and call `factory.orchestrator.next({ runId, scope: "desk" })`. `factory.orchestrator.list()` shows runs.
3. `factory.orchestrator.start({ repo: "<this checkout>", threadId: YOUR_THREAD_ID, brief, ticket })`. It answers with one of:
   - A **preflight** action: show `preflight.report` as-is.
     - `blocking: true`: the run cannot start. Offer to set the repo up (`~/.t3-sdlc/bin/t3-sdlc skill orchestrate-setup`), then start again.
     - Otherwise only optional stages are missing. Ask the user: set them up first, or continue without them? To continue, start again with `skip: <needsDecision>`.
   - An **availability** action listing `targets` ("providerInstanceId/model"). Check each against your `orchestrator_capabilities` result: available when that provider has `canRunChildTask: true` and lists that model id. Start again with the same arguments plus `available: [<those targets, copied exactly>]`. Do not pass the capabilities payload itself.
   - The run: `runId`, `routing`, `unavailable` and the first `actions` (a **launch-driver**).
4. Handle the actions (below). Then tell the user in two lines: the run id and title, a link to the run thread (`[title](t3-thread://v1/<threadId>)`), and any skipped stages or `unavailable` targets. End your turn.

## Actions
- **launch-driver** → find the project whose `workspaceRoot` equals `action.projectRoot` (`t3_project_list`; if none, ask the user whether to register it with `t3_project_create`). Then `t3_thread_launch({ title: action.title, projectId, workspaceStrategy: { type: "worktree", baseRef: action.baseBranch, startFromOrigin: false }, modelSelection: action.modelSelection /* omit if absent */, runtimeMode: "full-access", message: action.message })`, then `factory.orchestrator.launched({ runId, repo: action.repo, threadId, driver: true })`.
- **notify** → `t3_thread_send({ threadId: action.threadId, message: action.message })`, then `factory.orchestrator.sent({ runId, id })`.
- **gate** → `preview_open({ url: action.url, open: true })`, then one line to the user: "Plan ready for review: <url>. Reply approve, or say what to change." (or "PR stack ready…"). End your turn. When the user answers: `factory.orchestrator.decide({ runId, gate: action.gate, decision: "approve" | "changes", notes })` with their words as `notes` for changes, then handle the returned actions (a **notify** wakes the run thread).
- **blocked** → one or two lines: the scope and the reason, and the choices in `action.options`. When the user answers: `factory.orchestrator.decide({ runId, gate: "blocked", scope: action.scope, decision })`, then handle the returned actions.
- **done** → `factory.orchestrator.summary({ runId })` and show it. If it lists a cost page URL, `preview_open({ url, open: true })`. Then settle every thread in `action.threads` (`t3_thread_organize` action "settle").
- **idle** → end your turn.

## When you are woken
- **A message from the run thread** (a gate, a block, or the finish): call `factory.orchestrator.next({ runId, scope: "desk" })` and handle its actions.
- **The user writes:** if it answers an open gate or block, decide as above. If they ask how it is going, call `factory.orchestrator.status({ runId })` and answer in one or two lines. Otherwise answer briefly; never do the work yourself.

## Rules
- Never start child tasks, edit files, run builds or review code. The run thread does all orchestration.
- Never paste or paraphrase a gate page: open it with `preview_open` and link it.
- Never invent results. If a factory call errors, show the error and ask the user.
