---
name: orchestrate-setup
description: Prepare a repo (or group of repos) for the orchestrate factory — runs the deterministic doctor, explains what each missing piece unlocks, writes .orchestrate/factory.json with you, and re-checks until the flow can run.
argument-hint: "[path to repo] [--verify]"
disable-model-invocation: true
---

# Orchestrate setup

Target: $ARGUMENTS
(If empty or literally `$ARGUMENTS`, use the current repository.)

You help the user make this repo ready for `/orchestrate`. A deterministic doctor decides what is ready; you never guess. Keep messages short: what is missing, what it unlocks, the exact change.

## Tools
- `factory` MCP `execute` (pass `cwd` = the repo path):
  - `factory.repo.doctor({ repo, verify })` → per-stage report (`report` is ready to show), `blocking`, `needsDecision`, `recommended`.
  - `factory.repo.suggest({ repo })` → a proposed `.orchestrate/factory.json` built from the repo's own scripts, plus notes, plus the `existing` contract.
  - `factory.repo.builtins()` → built-in checks (`orchestrate check <name>`) the contract can list.
- Shell and file tools for reading the repo and editing `.orchestrate/factory.json` / `.orchestrate/workspace.json`.
- Without the factory MCP, the same doctor is a CLI: `node <t3-sdlc>/factory/bin/orchestrate.js doctor <repo> [--verify]` and `... init <repo>`.

## Steps
1. Run the doctor and show its `report` as-is. Then one line: runnable or not, and what is optional.
2. For each ❌ (required), fix it with the user:
   - **contract missing**: call `suggest`, show the proposed JSON, adjust it with the user (real test/lint/typecheck commands; the dev command for `app`), then write `.orchestrate/factory.json`.
   - **checks invalid**: the doctor names the command and why it will not resolve (missing npm script, make target, non-executable script, program not installed). Fix the contract or add the script; ask before editing anything outside `.orchestrate/`.
   - **clean tree / git**: tell the user; do not commit or stash for them unless asked.
3. For ⚠️ (recommended) and ➖ (optional), explain what each unlocks and ask whether to set it up now:
   - `setup` → fresh worktrees install dependencies before checks run.
   - `browser-validation` (`app`) → manual testers drive the real app in a browser and attach screenshots to PRs. Any command that serves a URL works (dev server, docker compose, a remote preview script). `{port}` is substituted with a free port; `urlPattern` reads the URL from output instead. For a repo group, put a combined `app` in `.orchestrate/workspace.json`; it receives every repo's checkout path as `ORCH_REPO_<NAME>`.
   - `publish` → a GitHub `origin` remote and `gh auth login`; otherwise PRs are written as a dry-run plan.
   - Suggest high-value built-ins the repo lacks (`secrets`, `hygiene`, `lockfile`, `migrations`, `traceability`, `changed-lines`) from `factory.repo.builtins()`.
4. Repo groups: if the feature work spans several repos, write `.orchestrate/workspace.json` in the repo the user will run `/orchestrate` from (`{ "repos": { "<name>": { "path": "<relative or absolute path>" } } }`), and make sure every listed repo has its own `factory.json`. The doctor checks all of them.
5. Re-run the doctor after every change. When there are no ❌, offer `verify: true`: it actually runs setup, every check and `app.up` on the current commit, which catches commands that resolve but fail.
6. Finish with the final report, the files you changed, and the command to start: `/orchestrate <ticket or brief>`. Remind the user to commit `.orchestrate/` so teammates and CI share it.

## Rules
- The doctor's verdict is the source of truth. Do not mark something ready that it reports as missing.
- Only edit `.orchestrate/factory.json`, `.orchestrate/workspace.json`, and files the user explicitly approves.
- Never invent commands. If the repo has no test command, say so: the gate is only as good as the checks it runs.
- Docs: `docs/repo-setup.md` in the t3-sdlc repo.
