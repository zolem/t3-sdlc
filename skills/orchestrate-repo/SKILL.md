---
name: orchestrate-repo
description: Internal to the t3-sdlc factory. Drives one repo's build inside a run, in a worktree the foreman launched. The foreman starts these threads; users do not.
---

# Orchestrate a repo (repo thread)

The message that started this thread names the run id, the repo, and the foreman's thread id.

You drive one repo's part of a factory run. You are in a T3 worktree of that repo: the run's one checkout of it. Every child you start works in this same checkout, one at a time. Run this loop yourself, in this thread: never hand the coordination to a child task. The only children you start are the factory's **dispatch** actions. You do no SDLC work yourself: you carry out the factory's actions for your scope and stay quiet. Only the factory decides when the foreman hears from you.

## Tools
- **The factory CLI**, `~/.t3-sdlc/bin/t3-sdlc`, run from this thread's checkout. Each call is one exec:
  ```sh
  ~/.t3-sdlc/bin/t3-sdlc exec - <<'JS'
  async () => factory.orchestrator.next({ runId: "...", repo: "..." })
  JS
  ```
  Your calls are `factory.orchestrator.next({ runId, repo })`, `started`, `finished`, `sent`, and `factory.workspace.prepare`.
- **T3:** `delegate_task`, `task_status`, `t3_thread_send`, `t3_thread_organize`.

## Loop
Call `factory.orchestrator.next({ runId, repo })` and handle every action in order:
- **dispatch** → `delegate_task` with `action.delegate` exactly as given. Shared isolation means the child works in this thread's checkout; never start a second dispatch while one is running (the factory only gives you one at a time). Then `factory.orchestrator.started({ runId, dispatchId, taskId, childThreadId })`. Start every dispatch before waiting.
- **notify** → `t3_thread_send({ threadId: action.threadId, message: action.message })`, then `factory.orchestrator.sent({ runId, id })`. These go to the foreman, or to another repo thread that was waiting on you.
- **checkout** → run `pwd`, then `factory.workspace.prepare({ runId, repo, cwd: <that path> })`, then call `next` again. Never edit files in your checkout yourself; children leave it clean and detached.
- **wait** / **idle** → end your turn with one line. A finished child or a message wakes you.
- **finished** → settle your remaining finished child threads, reply with one line, and stop.

## When you are woken
- **A child finished:** call `task_status({ taskId })`, then `factory.orchestrator.finished({ runId, dispatchId, status, summary })`. That call returns your next actions. Then settle the child (`t3_thread_organize` action "settle").
- **A message arrived** from the foreman or another repo thread: call `factory.orchestrator.next({ runId, repo })`.

## Rules
- Do not talk to the user, ask questions, or make decisions. When blocked, the factory tells the foreman, the foreman asks the user, and you are messaged when to continue.
- Message other threads only through **notify** actions.
- Never edit, build, or review anything yourself. If a factory call errors (including "needs full access"), use `t3_thread_send` to send the foreman one line with the error, then end your turn.
