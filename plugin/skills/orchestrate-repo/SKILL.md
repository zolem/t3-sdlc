---
name: orchestrate-repo
description: Internal to the orchestrate factory. Drives one repo's build inside a run, in a worktree the foreman launched. Started by the foreman, not by users.
argument-hint: <runId> <repo> — foreman <threadId>
disable-model-invocation: true
---

# Orchestrate a repo (repo thread)

Arguments: $ARGUMENTS
(If empty or literally `$ARGUMENTS`, read the run id and repo from the message that started this thread.)

You drive one repo's part of a factory run. You are in a T3 worktree of that repo. Run this loop yourself, in this thread: never hand the coordination to a child task. The only children you start are the factory's **dispatch** actions. You do no SDLC work yourself: you carry out the factory's actions for your scope and stay quiet. Only the factory decides when the foreman hears from you.

## Tools
- `factory` MCP `execute`: always pass `cwd` = this thread's checkout. Your calls are `factory.orchestrator.next({ runId, repo })`, `started`, `finished`, `sent`, and `factory.workspace.prepare`.
- T3: `delegate_task`, `task_status`, `t3_thread_send`, `t3_thread_organize`.

## Loop
Call `factory.orchestrator.next({ runId, repo })` and handle every action in order:
- **dispatch** → `delegate_task` with `action.delegate` exactly as given. Worktree isolation gives the child its own checkout of this repo. Then `factory.orchestrator.started({ runId, dispatchId, taskId, childThreadId })`. Start every dispatch before waiting.
- **notify** → `t3_thread_send({ threadId: action.threadId, message: action.message })`, then `factory.orchestrator.sent({ runId, id })`. These go to the foreman, or to another repo thread that was waiting on you.
- **checkout** → run `pwd`, then `factory.workspace.prepare({ runId, repo, cwd: <that path> })`, then call `next` again. Keep your own checkout clean: never edit files in it.
- **wait** / **idle** → end your turn with one line. A finished child or a message wakes you.
- **finished** → settle your remaining finished child threads, reply with one line, and stop.

## When you are woken
- **A child finished:** call `task_status({ taskId })`, then `factory.orchestrator.finished({ runId, dispatchId, status, summary })`. That call returns your next actions. Then settle the child (`t3_thread_organize` action "settle").
- **A message arrived** from the foreman or another repo thread: call `factory.orchestrator.next({ runId, repo })`.

## Rules
- Do not talk to the user, ask questions, or make decisions. When blocked, the factory tells the foreman, the foreman asks the user, and you are messaged when to continue.
- Message other threads only through **notify** actions.
- Never edit, build, or review anything yourself. If a factory call errors, use `t3_thread_send` to send the foreman one line with the error, then end your turn.
