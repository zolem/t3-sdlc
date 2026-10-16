# orchestrate-sdlc

A T3 Code **factory**: run `/orchestrate ABC-123` (Claude) or `$orchestrate ABC-123` (Codex) in a repo and a full SDLC runs. Each step is delegated to the provider/model your policy picks, and the run stops for you twice: to approve the plan, and to approve the PR stack.

```
You ──/orchestrate──▶ foreman thread ── plans, gates, cross-repo review, publish
                         │ launches one T3 thread per repo (each in its own worktree)
                         ▼
                 repo threads ── build · verify · fix · docs for their repo
                         │ delegate_task(target = policy.resolve(role))
                         ▼
        child agents (Opus / Sol / Sonnet / Luna / Haiku …) ──▶ factory MCP (search + execute)
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

Requires Node ≥ 22, `git`, and `gh` for publishing.

```bash
git clone git@github.com:SchoolAI/orchestrate-sdlc.git && cd orchestrate-sdlc
node bin/install.js --link-skills     # --dry-run first if you like; --uninstall to remove
```

The installer:
- Registers the `factory` MCP server with Claude Code, Codex, OpenCode and Cursor. It backs up each config to `~/.orchestrate/backups/<timestamp>/` first.
- With `--link-skills`, links the `orchestrate` (foreman), `orchestrate-repo` (repo threads), `orchestrate-setup` and `generate-brief` skills into `~/.claude/skills` and `~/.agents/skills`.

Alternatively, install the skills as a plugin:
- **Claude:** `/plugin marketplace add SchoolAI/orchestrate-sdlc`
- **Codex:** `codex plugin marketplace add SchoolAI/orchestrate-sdlc`

Open new T3 threads afterwards so harnesses pick up the server.

**Linear intake (optional):** `security add-generic-password -s orchestrate-factory -a linear -w <LINEAR_API_KEY>`. The key stays inside the factory; agents never see it. Without it, the orchestrator fetches the ticket with its own Linear tool and passes the text in.

## Prepare a target repo (or several)

Run `/orchestrate-setup` in the repo. It runs a deterministic doctor, then works through what's missing with you, stage by stage. From a shell, the same doctor is:

```bash
node factory/bin/orchestrate.js doctor <repo> [--verify]   # what can run, what is missing, how to fix it
node factory/bin/orchestrate.js init <repo> [--write]      # propose .orchestrate/factory.json from the repo's scripts
```

Each repo needs one committed file, `.orchestrate/factory.json`. It says how to install dependencies (`setup`), which commands gate a commit (`checks`), and optionally how to serve the app (`app`). The built-in checks (secrets, hygiene, lockfile drift, migration safety, test-case traceability, changed-line coverage) are plain `orchestrate check <name>` commands you choose to list.

For a group of repos, add `.orchestrate/workspace.json` to the repo you run from. Slices are then spread across the repos, and each repo gets its own PR stack.

`/orchestrate` runs the same doctor before starting. It refuses to start while required pieces are missing, and it asks before skipping optional stages (browser validation, publishing).

Full reference: [docs/repo-setup.md](docs/repo-setup.md).

## Tuning the factory

| What | Where | Precedence |
|---|---|---|
| Which model does each role | `policy/org.json` → `~/.orchestrate/policy.json` → `<repo>/.orchestrate/policy.json` | later wins, per role |
| How each role thinks | `roles/<role>.md` (generic) → `~/.orchestrate/roles/<role>.md` → `<repo>/.orchestrate/roles/<role>.md` (org/stack knowledge; see `examples/schoolai/`) | appends; frontmatter `mode: replace` replaces |
| Mechanics: inputs, steps, report schema | `factory/src/lib/brief.js`, `contracts.js` | code |

Every dispatch records its model, the hash of the exact brief it received, its duration, any report rejections and its findings. These go to `~/.orchestrate/ledger.jsonl`. Use `factory.ledger.stats()` to see:
- success rate and minutes per role and model
- clean first-pass rate per engineer model
- reviewer precision: the share of each model's findings that the other family confirmed

Use these numbers to adjust `policy/org.json` and the role briefs.

## Layout

```
factory/            MCP server (Code Mode: search + execute). Tests: npm test
  bin/orchestrate.js  CLI: doctor, init, check <built-in>
  src/lib/          pipeline state machine, doctor, workspace, policy, contracts, briefs, checks, git, history, app, linear
  src/modules/      the factory.<module>.<fn>() surface agents call
policy/org.json     org routing defaults
roles/*.md          role briefs (prompts you iterate on)
plugin/skills/      orchestrate (foreman), orchestrate-repo, orchestrate-setup, generate-brief (Claude + Codex)
docs/               repo-setup.md (contract reference), factory.schema.json
examples/schoolai/  org-specific role overlays, as an example
bin/install.js      register the MCP server with every harness
app/                legacy walkthrough desktop app (reads the old .orchestrate/ layout)
```

Run state lives outside the repo in `~/.orchestrate/runs/<runId>/`, so every worktree and model sees the same files. Set `ORCHESTRATE_HOME` to move it.
