# t3-sdlc

> Primary repo: `zolem/t3-sdlc`. `SchoolAI/t3-sdlc` is the internal copy, updated only with releases that are ready to share. The old subagent-based `SchoolAI/orchestrate-sdlc` is archived.

A T3 Code **factory**: tell any T3 thread "orchestrate ABC-123" (or a brief) in a repo and a full SDLC runs. Each step is delegated to the provider/model your policy picks, and the run stops for you twice: to approve the plan, and to approve the PR stack.

```
You ──orchestrate──▶  foreman thread ── plans, gates, cross-repo review, publish
                         │ launches one T3 thread per repo (each in its own worktree)
                         ▼
                 repo threads ── build · verify · fix · docs for their repo
                         │ delegate_task(target = policy.resolve(role))
                         ▼
        child agents (Opus / Sol / Sonnet / Luna / Haiku …) ──▶ t3-sdlc CLI (search + exec)
                         ▲                                      pipeline · roles · policy · checks
     one-line milestone messages between threads               app · git · history · ledger · publish
```

## How a run flows

1. **Plan:** product-manager → context-curator → architect ∥ qa-analyst → slice-planner → explainer.
2. **Gate 1:** you approve the plan or request changes. The plan is shown as an HTML page in the thread: plain language first, with an engineer section underneath.
3. **Build, in one thread per repo:** the foreman launches a T3 thread for each repo. Each slice is one stacked PR, built in dependency order (table → endpoint → UI), even across repos. Every job gets its own worktree:
   - The engineer implements the slice.
   - `checks.run` must pass. Engineers cannot report done without it.
   - A reviewer from a **different model family** reviews it.
   - A manual tester drives the real app in T3's browser when the slice is user-facing.
   - Fixes loop until clean, up to 3 times.
4. **Feature review:** two reviewers from different families (Opus and Sol by default) review the whole stack independently, then cross-examine each other.
   - Findings both agree on are fixed, then the stack is restacked.
   - Disputed findings come to you.
5. **Docs:** a versioned feature doc (summary, diagrams, screenshots) becomes the top slice.
6. **Gate 2:** you review the PR stack walkthrough, then approve or request changes.
7. **Publish:** draft PRs, one per slice, each based on the one before in its repo. With several repos, each repo gets its own stack and the stacks are cross-linked. PRs are linked to your T3 thread.

The order, retries, fallbacks and gates live in code (`factory/src/lib/pipeline.js`), not in a prompt. The orchestrator only carries out the actions the factory returns.

## Install

Requires Node ≥ 22 and `git`; `gh` for publishing PRs. One command, from the latest release:

```bash
curl -fsSL https://github.com/zolem/t3-sdlc/releases/latest/download/install.sh | sh
# while the repo is private:
gh release download --repo zolem/t3-sdlc --pattern install.sh --output - | sh
```

Everything lands in `~/.t3-sdlc`. The only files written elsewhere are skill symlinks, recorded in `~/.t3-sdlc/manifest.json`:

| Path | What | Read by |
|---|---|---|
| `~/.t3-sdlc/bin/t3-sdlc` | the CLI agents call | every provider (it's a shell command) |
| `~/.agents/skills/{orchestrate,orchestrate-setup,generate-brief}` | skill links | Codex, Cursor, OpenCode |
| `~/.claude/skills/…` | the same links | Claude Code |
| `~/.t3-sdlc/{runs,ledger.jsonl,policy.json,roles}` | your runs, history and overrides | the factory |

No MCP server and no harness config edits. Agents learn the CLI from the skill and from `t3-sdlc` itself (run it with no arguments for the agent guide).

```bash
~/.t3-sdlc/bin/t3-sdlc update             # latest release (T3_SDLC_VERSION / --version to pin)
~/.t3-sdlc/bin/t3-sdlc uninstall          # remove app, launcher and links; keep runs (--purge removes all)
node factory/bin/t3-sdlc.js install --dev # working on t3-sdlc: link ~/.t3-sdlc/app to this checkout
```

**Threads need Full access.** Run state lives in `~/.t3-sdlc`, outside the checkout, so sandboxed modes (e.g. Codex "auto") can't write it. The CLI detects this and says so.

**Releasing:** bump `version` in `package.json` and merge to `main`. The release workflow tags `v<version>` and publishes the tarball and `install.sh`; merges without a bump publish nothing.

Upgrading from the MCP version: the installer moves `~/.orchestrate` state into `~/.t3-sdlc` and removes the old `factory` MCP entries (with backups in `~/.t3-sdlc/backups/`).

**Linear intake (optional):** `security add-generic-password -s orchestrate-factory -a linear -w <LINEAR_API_KEY>`. The key stays inside the factory; agents never see it. Without it, the orchestrator fetches the ticket with its own Linear tool and passes the text in.

## Prepare a target repo (or several)

Ask a T3 thread in the repo to "set up this repo for t3-sdlc" (the `orchestrate-setup` skill). It runs a deterministic doctor, then works through what's missing with you, stage by stage. From a shell, the same doctor is:

```bash
t3-sdlc doctor [repo] [--verify]   # what can run, what is missing, how to fix it (--verify runs it all in a scratch worktree)
t3-sdlc init [repo] [--write]      # propose .orchestrate/factory.json from the repo's scripts
```

Each repo needs one committed file, `.orchestrate/factory.json`. It says how to install dependencies (`setup`), which commands gate a commit (`checks`), and optionally how to serve the app (`app`). The built-in checks (secrets, hygiene, lockfile drift, migration safety, test-case traceability, changed-line coverage) are plain `orchestrate check <name>` commands you choose to list.

For a group of repos, add `.orchestrate/workspace.json` to the repo you run from. Slices are then spread across the repos, and each repo gets its own PR stack.

An orchestrate run starts with the same doctor. It refuses to start while required pieces are missing, and it asks before skipping optional stages (browser validation, publishing).

Full reference: [docs/repo-setup.md](docs/repo-setup.md).

## Tuning the factory

| What | Where | Precedence |
|---|---|---|
| Which model does each role | `policy/org.json` → `~/.t3-sdlc/policy.json` → `<repo>/.orchestrate/policy.json` | later wins, per role |
| How each role thinks | `roles/<role>.md` (generic) → `~/.t3-sdlc/roles/<role>.md` → `<repo>/.orchestrate/roles/<role>.md` (org/stack knowledge; see `examples/schoolai/`) | appends; frontmatter `mode: replace` replaces |
| Mechanics: inputs, steps, report schema | `factory/src/lib/brief.js`, `contracts.js` | code |

Every dispatch records its model, the hash of the exact brief it received, its duration, any report rejections and its findings. These go to `~/.t3-sdlc/ledger.jsonl`. Use `factory.ledger.stats()` to see:
- success rate and minutes per role and model
- clean first-pass rate per engineer model
- reviewer precision: the share of each model's findings that the other family confirmed

Use these numbers to adjust `policy/org.json` and the role briefs.

## Layout

```
factory/            the t3-sdlc CLI (Code Mode: search + exec). Tests: npm test
  bin/t3-sdlc.js    entry: search, exec, skill, doctor, init, check, install, update, uninstall
  src/cli.js        command line; src/install.js install/update/uninstall
  src/lib/          pipeline state machine, doctor, workspace, policy, contracts, briefs, checks, git, history, app, linear
  src/modules/      the factory.<module>.<fn>() surface agents call
policy/org.json     org routing defaults
roles/*.md          role briefs (prompts you iterate on)
skills/             orchestrate (foreman), orchestrate-setup, generate-brief (linked); orchestrate-repo (served by `t3-sdlc skill`)
docs/               repo-setup.md (contract reference), factory.schema.json
examples/schoolai/  org-specific role overlays, as an example
install.sh          release installer; scripts/pack.sh builds the release tarball
app/                legacy walkthrough desktop app (reads the old .orchestrate/ layout)
```

Run state lives outside the repo in `~/.t3-sdlc/runs/<runId>/`, so every worktree and model sees the same files. Set `T3_SDLC_HOME` to move it.
