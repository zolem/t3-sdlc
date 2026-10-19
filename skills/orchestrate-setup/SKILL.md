---
name: orchestrate-setup
description: Set up a repo (or group of repos) for the t3-sdlc factory — runs the deterministic doctor, explains what each missing piece unlocks, writes .orchestrate/factory.json with the user, and re-checks until the flow can run. Use when the user asks to set up, prepare or check a repo for t3-sdlc or orchestrate, or when an orchestrate run stops at preflight.
argument-hint: "[path to repo] [--verify]"
---

# Orchestrate setup

Target: $ARGUMENTS
(If empty or literally `$ARGUMENTS`, use the current repository.)

You help the user make this repo ready for the factory (`orchestrate <ticket or brief>`). A deterministic doctor decides what is ready; you never guess. Keep messages short: what is missing, what it unlocks, the exact change.

## Tools
- **The factory CLI**, `~/.t3-sdlc/bin/t3-sdlc`, run from the repo:
  - `~/.t3-sdlc/bin/t3-sdlc doctor [repo] [--verify]` → per-stage report, ready to show.
  - `~/.t3-sdlc/bin/t3-sdlc init [repo]` → a proposed `.orchestrate/factory.json` built from the repo's own scripts, plus notes.
  - For structured results, the same calls through exec: `factory.repo.doctor({ repo, verify })` (`report`, `blocking`, `needsDecision`, `recommended`), `factory.repo.suggest({ repo })` (`contract`, `notes`, `existing`), `factory.repo.builtins()` (built-in checks the contract can list as `orchestrate check <name>`):
    ```sh
    ~/.t3-sdlc/bin/t3-sdlc exec - <<'JS'
    async () => factory.repo.doctor({ repo: "." })
    JS
    ```
- Shell and file tools for reading the repo and editing `.orchestrate/factory.json` / `.orchestrate/workspace.json`.

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
4. Repo groups: if the feature work spans several repos, write `.orchestrate/workspace.json` in the repo the user will run `orchestrate` from (`{ "repos": { "<name>": { "path": "<relative or absolute path>" } } }`), and make sure every listed repo has its own `factory.json`. The doctor checks all of them.
5. Re-run the doctor after every change. When there are no ❌, offer `verify: true`: it actually runs setup, every check and `app.up` on the current commit, which catches commands that resolve but fail.
6. Finish with the final report, the files you changed, and how to start: "orchestrate <ticket or brief>" in a T3 thread with Full access. Remind the user to commit `.orchestrate/` so teammates and CI share it.

## Rules
- The doctor's verdict is the source of truth. Do not mark something ready that it reports as missing.
- Only edit `.orchestrate/factory.json`, `.orchestrate/workspace.json`, and files the user explicitly approves.
- Never invent commands. If the repo has no test command, say so: the gate is only as good as the checks it runs.
- Docs: `docs/repo-setup.md` in the t3-sdlc repo.
