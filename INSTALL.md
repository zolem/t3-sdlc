# Install t3-sdlc

> **For people:** you don't need to read this. Paste this one line into your AI tool (Claude, ChatGPT, Codex, Cursor…):
>
> `Read https://github.com/zolem/t3-sdlc/releases/latest/download/INSTALL.md and follow it.`
>
> If your team gave you a profile link, add: `Our team profile is at <link>.`

---

**For the AI agent reading this:** you are installing t3-sdlc for the person you are talking with. t3-sdlc gives each role on a product team (product, design, engineering, QA) skills that produce complete handoff files for the next role, so work moves forward without back-and-forth. Follow this file from top to bottom.

## Rules

- **Ask little.** Work out everything you can yourself (section 1). Ask at most the three questions in section 2, in one message.
- **Confirm once.** Show the plan (section 3) and wait for a yes before changing anything.
- **Touch only what this file lists:**
  - skill folders t3-sdlc installs;
  - `~/.t3-sdlc/`;
  - the factory installer for engineers.

  Never edit other configuration, and never overwrite a folder t3-sdlc did not create without asking.
- **Copy, don't link.** Copy skill folders into place; don't symlink them. The factory installer for engineers manages its own links.
- **Stop on failure.** If a step fails, tell the person in one or two plain sentences what failed and what you need. Don't improvise a workaround that writes somewhere else.
- **Plain language.** Product managers and designers may not be technical. Keep paths and commands out of your messages unless they ask.

## 1. Work out where you are (don't ask)

**Your kind of tool:**

| Kind | Examples | How skills get installed |
|---|---|---|
| **A. Coding agent with a shell on this computer** | Claude Code, Codex (CLI, IDE or app), Cursor, OpenCode, T3 Code, Gemini CLI | You copy skill folders into the tool's skills folder (section 4A) |
| **B. Chat app without a shell on this computer** | Claude desktop app, claude.ai, ChatGPT | The person adds skills in the app; you guide them (section 4B) |

If you can run `echo $HOME` on the person's computer and see a real home folder, you are kind A.

**Skills folder (kind A):**
- Claude Code → `~/.claude/skills/`.
- Codex, Cursor, OpenCode and other tools following the Agent Skills standard → `~/.agents/skills/`.
- If your tool documents a different personal skills folder, use that.
- If the person uses both Claude Code and another agent on this computer, install into both folders.

**Earlier install (kind A):** if `~/.t3-sdlc/kit/install.json` exists, this is an update or a change. Read it. It records the role, stages, team profile and every folder installed.

**Team profile:** if the message that brought you here names a profile link or path, use it and skip question 3.

**Source:** normally the latest release (section 4). If the person points you at a local t3-sdlc checkout or a downloaded `t3-sdlc.tar.gz` (for trying an unreleased version), use that instead.

## 2. Ask (one message, at most three questions)

If there is an earlier install, ask only:
> Update t3-sdlc, change your role, or remove it?

Then skip to the matching part of section 4 or "Updating and removing".

Otherwise ask:

1. **What's your role?** (The id in brackets is what you record; don't show it.)
   - Product manager (`product`)
   - Designer (`design`)
   - Engineer (`engineering`)
   - QA (`qa`)
   - Team lead setting t3-sdlc up for others (`lead`)
2. **Which parts of the flow will you work on?** You don't know their role yet, so show the stages with who each is for, and say: "By default you get the ones for your role; add or remove any."

   | Stage (id) | What you get | Default for |
   |---|---|---|
   | Product spec (`spec`) | `write-product-spec`: an AI interviewer that turns an idea into a complete spec (requirements as plain rules with examples, edge cases, permissions, privacy) | Product manager |
   | Screen index (`screens`) | `build-screen-index`: every screen, state, interaction and flow the design must cover, generated from the spec | Designer |
   | Design review (`review`) | `review-design`: checks a design against the screen index, writes the design spec and the acceptance cases | Designer |
   | Build (`build`) | the t3-sdlc factory: plans the architecture, builds, reviews and opens PRs from a ticket or the handoff files (needs Node.js 22+ and git) | Engineer |
   | Team profile (`setup`) | `create-team-profile`: writes the team's personas, rules and conventions so everyone's skills give the same answers | Team lead |

   Everyone also gets `check-handoff`, which says whether a spec or design is complete and who has to fix what. Acceptance testing with personas and launch monitoring are planned for later releases; say so if asked.
3. **Does your team have a t3-sdlc team profile?**
   - Paste the link or path.
   - Or say "none" to use generic defaults.
   - Or "create one" (that installs `create-team-profile` and starts it once installation finishes).

## 3. Show the plan and wait for a yes

One short message, for example:

> Here's what I'll set up for you as a **designer**:
> - Skills: build-screen-index, review-design, check-handoff
> - Team profile: Acme (from the link or folder you gave)
> - Where: your Claude Code skills folder
>
> OK to go ahead?

Kind B: say instead which files you'll give them and the steps they'll take in the app.

## 4. Install

### Getting the release (kind A)

**Write paths out in full.** Many tools run each command in a fresh shell, so a variable set in one command is empty in the next. Below, `$T3_TMP`, `$APP` and `$SKILLS` are placeholders: replace them with the real absolute paths in every command you run.

1. Make a temporary folder and note the path it prints. That path is `$T3_TMP` from now on.
   ```sh
   mktemp -d
   ```
2. Get the tarball into it:
   ```sh
   curl -fsSL https://github.com/zolem/t3-sdlc/releases/latest/download/t3-sdlc.tar.gz -o "$T3_TMP/t3-sdlc.tar.gz" \
     || gh release download --repo zolem/t3-sdlc --pattern t3-sdlc.tar.gz --output "$T3_TMP/t3-sdlc.tar.gz"
   ```
   If the person gave you a downloaded `t3-sdlc.tar.gz`, copy it there instead.
3. Unpack it. `$APP` is `$T3_TMP/app`:
   ```sh
   mkdir "$T3_TMP/app" && tar -xzf "$T3_TMP/t3-sdlc.tar.gz" -C "$T3_TMP/app"
   ```
   With a local checkout, skip steps 1–3: `$APP` is the checkout's path.

- **Download fails:** the repository may be private. If `gh` is installed and signed in, the fallback above works. Otherwise tell the person to ask whoever shared t3-sdlc for access.
- **Pinning a version:** replace `latest/download` with `download/v<version>`.

### 4A. Coding agents with a shell

Copy only the skills from the plan: `write-product-spec`, `build-screen-index`, `review-design`, `check-handoff`, `create-team-profile`. `$APP/skills` holds other folders too; the factory installer manages those, so never copy them.

For each chosen skill, and for each skills folder from section 1 (`$SKILLS` is its full path, e.g. `/Users/ana/.claude/skills`):

```sh
mkdir -p "$SKILLS"
if [ -e "$SKILLS/<skill>" ]; then echo "EXISTS: $SKILLS/<skill>"; else cp -R "$APP/skills/<skill>" "$SKILLS/<skill>"; fi
```

- **It prints EXISTS:** the folder is already there. If `install.json` lists its exact path, replace it as described in "Replacing a folder". If not, t3-sdlc didn't create it: ask the person before touching it.

**Team profile:** it's a skill folder named `team-profile` containing one `SKILL.md`.
- **A path:** copy that folder to `$SKILLS/team-profile`.
- **A link:** download the raw `SKILL.md` into `$SKILLS/team-profile/SKILL.md`. For a GitHub page, use its raw file URL.
- **Either way:** check that its front matter says `name: team-profile` before installing it, and list the installed folder in `install.json` like the skills.

**Engineers (the Build stage):** also run the factory installer.

```sh
curl -fsSL https://github.com/zolem/t3-sdlc/releases/latest/download/install.sh | sh
# private repo: gh release download --repo zolem/t3-sdlc --pattern install.sh --output - | sh
```

- It needs Node.js 22+ and git. If either is missing, say so and stop that part.
- It installs the `t3-sdlc` CLI and links its own skills (`orchestrate`, `orchestrate-setup`, `generate-brief`). Don't copy those yourself.
- After it finishes, run `t3-sdlc doctor` in the person's repo, if they name one, so they see what the repo still needs.

**Record the install** in `~/.t3-sdlc/kit/install.json` (create the `~/.t3-sdlc/kit/` folder first):

```json
{
  "version": "<the release version, from $APP/package.json>",
  "installedAt": "<ISO timestamp>",
  "tools": ["<Claude Code | Codex | Cursor | …, one per skills folder you installed into>"],
  "source": "<release | the tarball or checkout path you installed from>",
  "role": "design",
  "stages": ["screens", "review"],
  "profile": "<where the profile came from (link or path), or null>",
  "folders": ["<every folder you created, including team-profile, as absolute paths>"]
}
```

`role` and `stages` use the ids from section 2.

**Verify:**
- Every installed folder has a `SKILL.md`.
- If `node` is available, run:
  ```sh
  node <skills folder>/check-handoff/kit/check.mjs <skills folder>/check-handoff/kit/example
  ```
  It must end with "Ready to hand off: Product spec, Screen index, Design spec."
- **Any other output, or none at all:** the install is incomplete. Copy the check-handoff folder again from `$APP` (see "Replacing a folder") and rerun. If the result is the same, stop, tell the person what you saw, and leave everything as it is.
- **Clean up:** delete the temporary folder by its literal path, e.g. `rm -rf "/var/folders/xy/T/tmp.Ab12Cd"`. Skip this with a local checkout.

**New sessions:** most tools only load new skills in a new session. Say so in your final message (section 5).

### 4B. Chat apps

**Claude desktop app and claude.ai:**
- Skills are added as zip files, one per skill, in the app's settings: the Skills section, under Capabilities or Customize depending on the version. Code execution must be on for skills to run their checks.
- Give the person a download link for each chosen skill:
  `https://github.com/zolem/t3-sdlc/releases/latest/download/skill-<skill>.zip`
- **Team profile:** if they have one, it's added the same way, as a zip of the `team-profile` folder. On a Mac, right-click the folder → Compress.
- **Workspace admins** can add the skills once and share them with the whole organization. Mention this if the person is the team lead.
- **Walk them through it one step at a time.** Confirm each skill shows up before moving on.

**ChatGPT** (no skill support; experimental):
- Create one Project per stage the person chose, e.g. "Product spec".
- **Project instructions:** the full text of that skill's `SKILL.md` (from the zip above), followed by the team profile's text if they have one.
- **Project files:** that skill's `kit/FORMAT.md` and `kit/templates/`.
- ChatGPT can't run the Node checker, so the skill applies the rules in `FORMAT.md` by hand. Tell the person this.
- Prepare the instructions text and files for them, then guide them through creating the Project.

## 5. Finish with a first step

End with one short message: what's installed, that they should start a new session (kind A), and one thing to try now, in the person's words:

| Role | Try this |
|---|---|
| Product manager | "Write a product spec for <a feature you're planning>." Bring a ticket or a rough idea; the AI asks the rest. |
| Designer | "Build the screen index for this spec," attaching the spec. After designing: "Review my design against the screen index." |
| Engineer | In a repo: "Set up this repo for t3-sdlc," then "orchestrate <ticket or brief>." To check incoming work: "Check this handoff." |
| QA | "Check this handoff," with the feature's files. |
| Team lead | "Create our team profile." Afterwards, share the one-line install with your team, including the profile link. |

## Updating and removing

### Replacing a folder

First check that the replacement exists: `$APP/skills/<skill name>/SKILL.md` for a skill, or the profile's source for the team profile. If it doesn't (a skill was renamed or dropped), leave the old folder in place and tell the person.

Only ever delete a folder whose exact absolute path is listed in `install.json`'s `folders`. Before deleting, check that the path:
- is not empty;
- starts with the person's home folder;
- ends in `/<skill name>` or `/team-profile`;
- contains a `SKILL.md`.

If any check fails, stop and ask. Delete by literal path, never through a variable that might be empty:

```sh
rm -rf "/Users/ana/.claude/skills/build-screen-index"   # the exact path from install.json
cp -R "$APP/skills/build-screen-index" "/Users/ana/.claude/skills/build-screen-index"
```

**Update** ("update t3-sdlc", or this file on an existing install). Choosing "update" is the confirmation; no plan needed.
1. Get the release as in section 4, from the `source` in `install.json` unless the person gives a new one.
2. If its version (`$APP/package.json`) matches `install.json`, tell the person they're up to date, clean up, and stop, unless they asked to reinstall.
3. Replace every folder listed in `install.json` (see "Replacing a folder"); re-fetch the team profile from its source.
4. Update `version` and `installedAt`.
5. Engineers: also run `~/.t3-sdlc/bin/t3-sdlc update`.
6. Verify and clean up as in 4A, then finish with one short message: the new version, what changed if the release notes say, and to start a new session.

**Change role or stages:**
1. Ask questions 1 and 2 again.
2. Show the plan.
3. Remove skill folders that are no longer needed, as described in "Replacing a folder".
4. Install the new ones as in 4A, rewrite `install.json`, verify, clean up, and finish as in section 5.

**Remove:**
1. Delete every folder listed in `install.json`, with the checks in "Replacing a folder", then `~/.t3-sdlc/kit/`.
2. Engineers: also run `~/.t3-sdlc/bin/t3-sdlc uninstall`.
3. Kind B: tell the person where to remove the skills or Projects in their app.

## What each skill produces

| Skill | Who | Produces |
|---|---|---|
| `write-product-spec` | Product | `spec.md`: problem, success metrics, personas, requirements as rules with ✅ ⚠️ ❌ examples, permissions, privacy, analytics, rollout, out of scope, open questions |
| `build-screen-index` | Design | `screen-index.md`: every screen with its required states, interactions and errors, plus flows per persona |
| `review-design` | Design | `design-spec.md`: a frame for every state, copy and behaviour notes, and acceptance cases per persona |
| `check-handoff` | Everyone | a completeness report: what's missing and who fixes it |
| `create-team-profile` | Team lead | the `team-profile` skill everyone installs |

The three files use one format, defined in `kit/FORMAT.md` inside each skill. Items carry short ids at the end of the line (`id:seat-limit`), so a screen or test case can point at the rule it covers. That is what lets each step check the one before it.
