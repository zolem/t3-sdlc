# Set up a repository for the factory

The factory runs any repo, or group of repos, that tells it three things: how to install dependencies, how to check a commit, and (optionally) how to serve the app. That lives in one file, `.orchestrate/factory.json`. Commit it.

## Quick start

```bash
# In T3 (Claude or Codex thread), in your repo:
/orchestrate-setup            # guided: doctor → fix → re-check

# Or from a shell:
node <orchestrate-sdlc>/factory/bin/orchestrate.js init .           # print a proposed contract
node <orchestrate-sdlc>/factory/bin/orchestrate.js init . --write   # write it
node <orchestrate-sdlc>/factory/bin/orchestrate.js doctor .         # what can run, what is missing
node <orchestrate-sdlc>/factory/bin/orchestrate.js doctor . --verify  # also run setup, checks, app.up
```

`/orchestrate` runs the same doctor before it starts. If something is missing it stops and shows you the report instead of starting a run.

## What each stage needs

| Stage | Needs | Level | Without it |
|---|---|---|---|
| Everything | a git repo with at least one commit, and a valid `.orchestrate/factory.json` | required | the run does not start |
| Starting a run | a clean working tree (`.orchestrate/` excepted) | required | the run does not start |
| Build gate | `checks`: at least one real command (your tests), and every command must resolve | required | the run does not start |
| Fresh worktrees | `setup`: installs dependencies in a new checkout | recommended | checks fail in new worktrees |
| Browser validation | `app`: a command that serves the app plus its URL | optional | user-facing slices are code-reviewed only, never exercised in a browser |
| Publishing | a GitHub `origin` remote and `gh auth login` | optional | PRs are written to a dry-run plan instead |

Optional stages ask before being skipped: `/orchestrate` shows the report, and you either set them up or continue without them.

The doctor checks that commands **resolve**, without running them:
- npm/pnpm/yarn/bun scripts exist in `package.json`
- make and just targets exist
- local scripts exist and are executable
- other programs are on `PATH`

`--verify` actually runs `setup`, every check and `app.up` on your current commit. Do this once: checks that fail on your base commit will fail on every slice too.

## `.orchestrate/factory.json`

```jsonc
{
  "$schema": "https://github.com/SchoolAI/orchestrate-sdlc/blob/main/docs/factory.schema.json",
  "version": 2,
  "setup": "npm ci",
  "checks": [
    { "id": "lint", "run": "npm run lint" },
    { "id": "typecheck", "run": "npm run typecheck" },
    { "id": "test", "run": "npm test" },
    { "id": "coverage", "run": "npm run coverage && orchestrate check changed-lines coverage/lcov.info 80" },
    { "id": "migrations", "run": "orchestrate check migrations 'migrations/*.up.sql' --require-down" },
    { "id": "secrets", "run": "orchestrate check secrets" },
    { "id": "traceability", "run": "orchestrate check traceability" }
  ],
  "app": {
    "up": "npm run dev",
    "env": { "PORT": "{port}" },
    "url": "http://localhost:{port}",
    "ready": "/health",
    "readyTimeoutSec": 60
  },
  "docs": { "dir": "docs/features" }
}
```

| Key | Meaning |
|---|---|
| `setup` | Runs in a fresh checkout before checks or the app. It re-runs only when a lockfile changes. |
| `checks[]` | `{ id, run, timeoutSec? }`. Each runs with `bash -lc` at the repo root, on a **committed** HEAD. Exit code 0 means pass. They run in order, and all must pass before an engineer can report a slice done. |
| `app.up` | Starts the app and keeps running. The factory picks a free port, fills `{port}` in `up`, `url` and `env`, starts the command in the background, and polls `url + ready` until it answers. |
| `app.url` / `app.urlPattern` | Use `url` when the URL is known. Use `urlPattern` (a regex with one capture group, matched against the command's output) when the command prints it, for example a remote preview. |
| `app.down` | Optional teardown command. The process group is always killed. |
| `docs.dir` | Where the docs writer puts the feature doc. Default `docs/features`. |

### Environment every check gets

| Variable | Value |
|---|---|
| `ORCH_BASE_SHA`, `ORCH_HEAD_SHA` | The slice's parent commit and the commit being checked |
| `ORCH_CHANGED_FILES` | Path to a file listing files changed by this slice, one per line. Lint only these if a full lint is slow. |
| `ORCH_TEST_CASES` | Comma-separated test-case ids assigned to this slice |
| `ORCH_SLICE`, `ORCH_RUN_ID` | Which slice and run is being checked |
| `PATH` | Includes the `orchestrate` CLI |

### Built-in checks (`orchestrate check <name>`)

| Check | Fails when |
|---|---|
| `secrets` | Added lines look like credentials (cloud keys, tokens, private keys, hard-coded passwords) |
| `hygiene` | Added lines contain conflict markers, focused tests (`.only`, `fit`), or `debugger` |
| `lockfile` | `package.json` dependencies changed without a lockfile change |
| `migrations '<glob>' [--require-down]` | An existing migration was edited or deleted, or a new `.up.` migration has no matching `.down.` |
| `traceability` | A test case assigned to the slice is not mentioned by any changed test file |
| `changed-lines <lcov> [min]` | Coverage of executable added lines is below `min` (default 80). Source files missing from the report are listed as a warning. |

They are plain commands, so you can run them in CI too. Write your own the same way: any script that exits non-zero on failure.

### `app` examples

```jsonc
// docker compose
"app": { "up": "PORT={port} docker compose up --build", "down": "docker compose down", "url": "http://localhost:{port}", "ready": "/healthz", "readyTimeoutSec": 300 }

// a script that provisions a remote preview and prints its URL
"app": { "up": "./scripts/preview up", "down": "./scripts/preview down", "urlPattern": "Preview ready at (https://\\S+)", "ready": "/", "readyTimeoutSec": 900 }
```

## Several repos: `.orchestrate/workspace.json`

Put this in the repo you run `/orchestrate` from (the **primary** repo):

```json
{
  "name": "shop",
  "repos": {
    "web": { "path": "." },
    "api": { "path": "../api-service" }
  },
  "app": {
    "up": "./scripts/dev-all.sh",
    "env": { "PORT": "{port}" },
    "url": "http://localhost:{port}",
    "ready": "/health"
  }
}
```

How a multi-repo run works:
- **Contracts:** every listed repo needs its own `.orchestrate/factory.json`, and each repo must be a T3 project. The doctor checks them all.
- **Threads:** the thread you start in is the **foreman**. It plans the whole feature, then launches one T3 thread per repo, each in a worktree of its own repo. So T3 owns every worktree.
- **Slices:** each slice changes exactly one repo. A slice that depends on a slice in another repo waits until that slice is done, and the finishing thread wakes it.
- **Checks:** each repo thread's engineers run that repo's checks.
- **Milestones:** repo threads send the foreman a one-line message only when a build, fix round or docs is done, or when they're blocked.
- **Fixes:** the foreman's whole-feature review routes each finding to the repo thread that owns its slice.
- **PRs:** each repo gets its own PR stack, and the PR bodies link to the other repos' PRs.
- **Browser validation:** each slice is tested against its own repo's `app`. The whole feature is tested with the workspace `app` (or the primary repo's), which runs with every repo thread's finished checkout passed as `ORCH_REPO_<NAME>` (for example `ORCH_REPO_API`).

Single-repo runs work the same way, with one repo thread.

## Teach the factory your conventions

Two layers are optional and committed with the repo:
- **Role overlays:** `.orchestrate/roles/<role>.md` is appended to that role's brief whenever the repo is involved. Start the file with `---\nmode: replace\n---` to replace the brief instead. `examples/schoolai/.orchestrate/roles/` shows an architect and context-curator overlay with stack rules and links to internal docs.
- **Routing:** `.orchestrate/policy.json` overrides which model runs a role for this repo, in the same shape as `policy/org.json`.

## Troubleshooting

- **"checks only run on committed HEAD":** the factory refuses to check uncommitted changes, so results always match a commit.
- **"changes which commit is checked out, so it only runs inside a linked worktree":** slice checks and restacks never move your main checkout.
- **Checks pass for you but fail in the run:** run `doctor --verify`. A fresh worktree has no dependencies, git-ignored files or local `.env`, so put what the checks need into `setup`.
