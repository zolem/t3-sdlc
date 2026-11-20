# Handoff format

Three files carry a feature from product to design to engineering. The first two are usually built in one working session: product, design and engineering in a room, one person typing, an AI assistant writing the files. Each file is checked for completeness, reviewed, and agreed before the next one starts:

| File | Built when | `kind` | Read by |
|---|---|---|---|
| `spec.md` | first: from a PRD, brief or description, then questions until nothing is open | `spec` | design, engineering |
| `screen-index.html` | second: generated from the agreed spec, then reviewed and changed until everyone agrees | `screen-index` | design, engineering |
| `design-spec.md` | later, once the designer has drawn every screen | `design-spec` | engineering, QA |

Keep the three files in one folder per feature (for example `specs/<feature>/`). The spec and design spec are plain Markdown; the screen index is one HTML file that opens in any browser. They can live in git, a tracker ticket, a doc tool or a shared drive. What makes them a handoff is the format below and a clean check, not where they live.

## Front matter

The spec and the design spec start with:

```yaml
---
kind: spec            # spec | screen-index | design-spec
feature: invite-teammates
title: Invite teammates to a workspace
version: 1            # bump once per review round that changes it
status: draft         # draft | ready
---
```

- The design spec adds `index_version:` (the screen index version it was built from) and, optionally, `design_file:` (a link to the design file).

## Ids

Anything another file needs to point at gets a short id, written **last** on its line in a code tag:

```markdown
1. You can't invite more people than you have free seats. `id:seat-limit`
```

- **The title comes first; the id is an afterthought.** Readers skip it. You use it when another file, a ticket or a conversation needs to point at exactly this item.
- **Format:** `id:` then lowercase words joined by hyphens. Each id is used once across the feature's files.
- **Readable:** two or three words that name what the item is about, so anyone can tell what `id:guest-email-only` or `id:reminder-time` points at. `node check.mjs --add-ids <folder>` fills in missing ones from the titles as a fallback; rename any that don't read well.
- **Ids can be renamed until a file is first marked ready.** After that they never change, even when the title is reworded, because other files and tickets point at them.
- **Other files point at ids in a field:** `Covers: seat-limit, resend`. Personas can be named by id or by name.

| What | Where | Looks like |
|---|---|---|
| Persona | spec, under Personas | `` - **Workspace owner** — Manages billing and members. `id:owner` `` |
| Requirement | spec, under Requirements | `` ### Owners invite people by email `id:owners-invite` `` |
| Rule | spec, numbered under its requirement | `` 1. You can't invite more people than you have free seats. `id:seat-limit` `` |
| Open question | spec, under Open questions | `` ### How long should an invite stay valid? `id:invite-expiry` `` |
| Screen | screen index data | `"id": "members-page"` |
| Flow | screen index data | `"id": "owner-invites"` |
| Acceptance case | design spec, under Acceptance cases | `` ### Owner sends invites `id:owner-sends-invites` `` |

Examples and interactions don't get ids. The design spec repeats each screen's title and id as a heading to attach its frames; that is an entry for the screen, not a new screen.

## The product spec

`spec.md` has these `##` sections, in this order: Problem · Goals and success metrics · Personas · Requirements · Permissions · Data and privacy · Analytics · Rollout · Out of scope · Open questions.

A `## Changes` section can follow Open questions: one line per version, newest first, saying what changed. Bump `version` once per review round that changes the spec, and add its line:

```markdown
## Changes

- v3: Guests get reminders by email only, not in the bell.
- v2: Dropped the 1-week-before option; project defaults are a should.
```

### Requirements: a story, its rules, and examples

Each requirement follows [Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/): one story, the rules that must hold, and concrete examples of each rule.

```markdown
### Owners invite people by email `id:owners-invite`

**Who:** Workspace owner · **Priority:** must

As an owner, I want to add teammates myself, so I don't wait two days for support.

**Rules**

1. You can't invite more people than you have free seats. `id:seat-limit`
   - ✅ 2 free seats, the owner enters 2 addresses → Send invites works.
   - ⚠️ 2 free seats, the owner enters 3 addresses → the form says "You have 2 seats left" and Send invites stays off until the list fits.
2. Addresses that can't be invited are flagged before anything is sent. `id:bad-addresses`
   - ❌ "bob@acme" → the chip turns red with "Not a valid email".
```

- **Who** names the personas it's for; **Priority** is must, should or could.
- **The story line** says who wants what, and why: "As a …, I want …, so …".
- **Rules** are numbered. Each is one thing that must be true, in a plain sentence anyone can read.
- **Examples** sit under their rule: the situation, then `→`, then what happens. They are the acceptance criteria.
  - ✅ the normal case;
  - ⚠️ an edge case (limits, duplicates, empty, too many, someone else got there first);
  - ❌ an error (invalid input, something failed, no permission).
- **Edge cases and errors go under the rule they test.** There is no separate errors section.
- **Given / When / Then** is fine inside an example when the starting state is subtle: "Given a revoked invite, when the invitee opens the link, then …".

**Rules that apply everywhere** (a time zone, the same behaviour on web and mobile, who can never see something) go first, under `**Applies everywhere**`, before the first requirement. They are numbered and have ids and examples like any other rule. A short glossary of the feature's terms can sit there too.

```markdown
## Requirements

**Applies everywhere**

1. Nobody sees a workspace's members before they've joined it. `id:no-peeking`
   - ✅ An invited person opens the invite page → it shows the workspace name and who invited them, not the member list.

### Owners invite people by email `id:owners-invite`
```

### Personas

One list item each: the name in bold, who they are and where they use the product, then the id.

```markdown
- **Invited person** — Got an invite email; may not have an account yet. Opens it on a phone 60% of the time. `id:invitee`
```

### Permissions

A table with one row per action and one column per persona (by name or id). No empty cells: write `no`, `n/a`, or the condition.

### Open questions

```markdown
### How long should an invite stay valid? `id:invite-expiry`
- Options: 7 days; 14 days, like the password reset link; never.
- Answer: 14 days, matching the password reset link.
```

A question stays open until it has an `- Answer:` line with the decision. Leave the Answer line out until then; "TBD", "not decided yet" and the like count as unanswered. `- Options:` (the choices on the table) and `- Who's finding out:` are optional. Keep answered questions: they record why the spec says what it does.

### Proposed, waiting and n/a

- **`(proposed)`** marks something the assistant suggested and nobody has confirmed yet. It can go anywhere on a line before the id: after a title, on a Who or Priority line, in a permissions cell, at the end of an example.
- **`(waiting on id:x)`** marks a rule or example that depends on an open question: `1. The next occurrence appears when the current one is completed. (waiting on id:when-next)`. Use it when the answer changes what the rule says, so nobody designs around a guess.
- Both count as **still open**. A spec can't be ready while anything is open.
- A required item that doesn't apply is written `n/a — <why>`. "n/a" alone fails the check: the reason keeps a gap deliberate instead of forgotten.

## The screen index

`screen-index.html` is what the team aligns on before anything is designed, and then the designer's to-do list. It is drawn as wireflows: rough grey-box wireframes of every screen and state, joined by arrows from the button you press, with notes on behaviour, edge cases, errors and who can see what. It starts as a copy of `templates/screen-index.html`. **Only its JSON data block changes**; the script after it draws the page, and the checker reads the same data.

```json
{
  "kind": "screen-index", "feature": "invite-teammates", "title": "Invite teammates to a workspace",
  "version": 1, "status": "draft", "specVersion": 2,
  "requiredStates": ["default", "empty", "loading", "error", "denied"],
  "devices": ["web", "iPhone"],
  "personas": { "owner": "Workspace owner" },
  "rules": { "seat-limit": "You can't invite more people than you have free seats" },
  "screens": [{
    "id": "invite-dialog", "title": "Invite people dialog", "type": "modal", "change": "new",
    "personas": ["owner"], "entry": "Invite people on the Members page", "covers": ["seat-limit"],
    "wireframe": [["h", "Invite people"], ["input", ["ana@acme.co", "!bob@acme"]], ["btn", "Send invites", "primary"]],
    "states": {
      "default": { "note": "Addresses become chips; bad ones turn red." },
      "empty": { "note": "No addresses yet; Send invites is off.", "wireframe": [["input", "Paste or type emails"]] },
      "loading": { "note": "…", "wireframe": [["spinner", "Sending…"]] },
      "error": { "note": "…", "wireframe": [["banner", "Couldn't send invites. Try again.", "error"]] },
      "denied": { "na": "Only owners can open it." },
      "over-limit": { "note": "An extra state: more addresses than seats.", "wireframe": [["banner", "You have 2 seats left.", "warn"]] }
    },
    "interactions": [{ "trigger": "Send invites", "result": "The dialog closes; a toast says \"3 invites sent\"", "to": "members-page", "errors": ["…"] }]
  }],
  "flows": [{
    "id": "owner-invites", "title": "Owner invites three people", "persona": "owner", "covers": ["seat-limit"],
    "steps": [
      { "screen": "members-page", "tap": "Invite people", "notes": [["who", "Only owners see Invite people."]] },
      { "screen": "invite-dialog", "state": "empty", "tap": "Send invites", "notes": [["edge", "More addresses than seats: Send invites stays off."]] }
    ]
  }],
  "cases": [{ "rule": "seat-limit", "example": "⚠️ 2 free seats, the owner enters 3 addresses → …", "where": ["invite-dialog/over-limit", "owner-invites"] }],
  "questions": [{ "question": "Does a pending invite use a seat?", "proposal": "Yes, until it expires.", "answer": "Yes, until it expires." }],
  "changes": [{ "version": 2, "notes": ["Added the over-limit state to the invite dialog."] }]
}
```

- **`specVersion`** is the spec version it was built from. **`requiredStates`** defaults to the five above; add more, such as `offline`, when the product needs them. **`devices`** says what the designer designs for.
- **`personas`** and **`rules`** hold the names and titles from the spec, so the page can show them. Don't type them: `check.mjs --sync` copies them from the spec. Screens and flows point at them by id.
- **Screens:**
  - `type` is one of `page`, `modal`, `drawer`, `panel`, `email`, `toast`, `notification`, `sms`, `push`. Emails, toasts and notifications only need a `default` state; draw a variant someone receives (an overdue reminder, a second notice) as an extra state. A `panel` is a section inside another screen; name that screen's id in `inside`. An email can have a `subject`.
  - `change` is `new`, or `update` for a change to an existing screen.
  - `covers` lists rule ids, or a requirement id to cover all its rules.
  - `wireframe` is the default state.
- **Each required state is one of:**
  - drawn: `{ "note", "wireframe" }`;
  - `{ "unchanged": "why" }`: only on an existing screen (`"change": "update"`), for a state this feature doesn't touch, e.g. "today's empty board, unchanged";
  - `{ "na": "why" }`: the state can't happen.
  Extra states, such as `over-limit` or `as-member`, are drawn the same way.
- **Flows** name one persona and step through screens. A step can show a non-default `state`, and a `toast` that appears on it. `tap` is what the person taps to get to the next step, and it's numbered on the wireframe. It must match a label on that step's wireframe: a button, heading, field, list row, tab, checkbox, radio option or open menu item. Notes are `[kind, text]`, with kind `behavior`, `edge`, `error` or `who`.
- **`questions`** are gaps in the spec found while building the index, each with a proposed answer. Product answers them (`"answer"`), and the answer also goes into the spec. An index can't be ready while one is unanswered.
- **`cases`** lists every ⚠️ and ❌ example in the spec, by rule, with `where` it shows: a screen id, `screen-id/state`, or a flow id. `check.mjs --sync` keeps the list in step with the spec; you fill in `where`. The page shows it as one table, so reviewers can check nothing was missed without hunting.
- **`changes`** is the change log: one entry per version, `{ "version": 2, "notes": […] }`, shown at the top of the page so a room can see what moved since the last look. Bump `version` once per review round that changes the index.

### Wireframe building blocks

Each block is a small array: `["btn", "Send invites", "primary"]`. Keep wireframes rough: real labels, no styling.

| Block | Draws |
|---|---|
| `["h", text]` · `["p", text]` · `["section", text]` | a heading · muted text · a small section label |
| `["btn", label, variant]` | a button; variant `primary`, `danger`, `disabled` or `link` |
| `["row", [blocks]]` · `["cols", [[blocks], [blocks]]]` · `["card", [blocks]]` | blocks side by side · columns (a kanban board) · a bordered box |
| `["input", placeholder]` · `["input", ["a@b.co", "!bad", "~skipped"]]` | an empty input · an input of chips (`!` invalid, `~` skipped) |
| `["field", label, value]` · `["select", label, value]` · `["date", label, value]` | a labelled input, dropdown or date picker; a value starting with `~` is placeholder text; add `"readonly"` or `"disabled"` as a fourth item for a field you can't change |
| `["days", label, ["Mon", "Thu"]]` | a weekday picker with those days on |
| `["toggle", label, on]` · `["check", label, checked]` · `["radio", [options], selected]` · `["tabs", [labels], active]` | switches, checkboxes, radio options, tabs; a radio option can hold a block: `["Ends after", ["field", "", "4 times"]]` |
| `["list", [[text, action, …], …]]` | rows with optional actions; a row's text can be tapped |
| `["menu", [items], open]` · `["icon", name]` | a "⋯" menu (tap `More` to open it; its items show, and can be tapped, when `open` is true) · a small icon, named |
| `["skel", rows]` · `["spinner", text]` · `["empty", text]` · `["img"]` | loading rows · a spinner · an empty-state block · an image placeholder |
| `["banner", text, "error" or "warn"]` · `["err", text]` · `["toast", text]` · `["badge", text]` · `["divider"]` | a message bar · an inline error · a toast · a small label · a line |

## The design spec

```markdown
## Screens

### Invite people dialog `id:invite-dialog`
- Frames:
  - default: https://www.figma.com/design/…?node-id=20-1
  - empty: https://www.figma.com/design/…?node-id=20-2

## Acceptance cases

### Owner hits the seat limit `id:owner-seat-limit`
- Persona: owner
- Covers: seat-limit
- Steps:
  1. In a workspace with 2 free seats, open Invite people
  2. Enter three addresses
- Expect: "You have 2 seats left", and Send invites stays off until one chip is removed
```

## Rules

`check.mjs` checks these; agents that cannot run code check them by hand, in this order. Errors block a handoff; warnings do not.

**Any file**
- **F1** Front matter (or the screen index data) has kind, feature, version and status (draft or ready).
- **F2** Every id is used once across the handoff files.
- **F3** Every id or persona a file points at exists in the handoff files.
- **F4** No template placeholders (<like this>) are left.
- **F5** Every persona, requirement, rule, open question, screen, flow and acceptance case ends with an id (`id:short-name`, lowercase words and hyphens).

**Product spec**
- **S1** Every required section is present and not empty (n/a — why, if it does not apply).
- **S2** At least one persona is listed.
- **S3** Every requirement says who it is for (personas from the Personas section) and its priority (must, should or could).
- **S4** Every requirement has at least one rule, and every rule has at least one example.
- **S5** Every example gives the situation and what happens (situation → result, or Given/When/Then).
- **S6** Every requirement has at least one edge case or error example (⚠️ or ❌), not only the happy path. Warning only.
- **S7** The permissions table has a column for every persona and no empty cells.
- **S8** A ready spec has nothing left open: every open question has an answer, and nothing is marked (proposed) or (waiting on id:…).
- **S9** Rules and examples avoid vague words (fast, easy, intuitive…). Warning only.

**Screen index**
- **I1** The screen index names the spec version it was built from, and it matches the spec. It can only be ready if the spec is.
- **I2** Every screen has a known type, personas, an entry point, what it covers, and a wireframe.
- **I3** Every screen has each required state: a wireframe, unchanged with a reason (only on a screen that already exists), or n/a with a reason.
- **I4** Every interaction has a trigger and a result.
- **I5** Every flow names one persona, steps through declared screens, taps something shown on each step, and says what it covers.
- **I6** Every rule is covered by a screen or a flow (directly or through its requirement).
- **I7** Every persona with requirements has at least one flow.
- **I8** Wireframes only use the known building blocks. Warning only.
- **I9** Persona names and rule titles match the spec (the check copies them with --sync).
- **I10** A ready screen index has nothing left open: every question for product has an answer.
- **I11** Every edge case and error example in the spec (⚠️ ❌) says where it shows: a screen, a state or a flow (--sync lists them).

**Design spec**
- **D1** The design spec names the screen index version it was built from, and it matches. It can only be ready if the index is.
- **D2** Every screen in the index has a design entry.
- **D3** Every state the screen index asks to draw has a frame link, or n/a with a reason.
- **D4** Every acceptance case names one persona, the rules it covers, its steps and what to expect.
- **D5** Every rule has at least one acceptance case.
- **D6** Every persona with requirements has at least one acceptance case.

## Running the check

```sh
node check.mjs specs/invite-teammates            # a folder with any of the three files
node check.mjs specs/invite-teammates --add-ids  # first add any missing ids, then check
node check.mjs specs/invite-teammates --sync     # first copy persona names, rule titles and edge cases into the screen index
node check.mjs specs/invite-teammates --json     # machine-readable
t3-sdlc spec check specs/invite-teammates        # the same check, from the t3-sdlc CLI
```

Each file ends in one of three places:
- **To fix:** errors, listed one per line.
- **Still open:** no errors, but unanswered questions, `(proposed)` or `(waiting on …)` items. The check lists each one.
- **Complete:** nothing to fix and nothing open. Review it together; when everyone agrees, set `status: ready`. A file is ready to hand off when it is complete and marked ready.

A screen index can be built from a draft spec to get ahead, but stays a draft until the spec is ready.

The check proves a file is complete and consistent, not that it is good: an empty state whose note says "empty state" passes. The skills hold the quality bar.

Set `status: ready` when you hand a file off; bump `version` if it changes afterwards, so the next role knows to update.

A complete example for a made-up company is in `example/` next to this file when it ships inside a skill, and in the t3-sdlc repo under `examples/acme/handoff/`.
