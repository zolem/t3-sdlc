# Handoff format

Three Markdown files carry a feature from product to design to engineering. Each one is written by one role, checked for completeness, then handed to the next role:

| File | Written by | `kind` | Read by |
|---|---|---|---|
| `spec.md` | product | `spec` | design, engineering |
| `screen-index.md` | design (generated from the spec, then reviewed) | `screen-index` | design, engineering |
| `design-spec.md` | design | `design-spec` | engineering, QA |

Keep the three files in one folder per feature (for example `specs/<feature>/`). They are plain Markdown, so they can live in git, a tracker ticket, a doc tool or a shared drive. What makes them a handoff is the format below and a clean check, not where they live.

## Front matter

Every file starts with:

```yaml
---
kind: spec            # spec | screen-index | design-spec
feature: invite-teammates
title: Invite teammates to a workspace
version: 1            # bump when the content changes after a handoff
status: draft         # draft | ready
---
```

- The screen index adds `spec_version:` (the spec version it was built from) and `required_states:` (comma-separated; default `default, empty, loading, error, denied`; a team profile can add more, such as `offline`).
- The design spec adds `index_version:` (the screen index version it was built from) and, optionally, `design_file:` (a link to the design file).

## Ids

Anything another file needs to point at gets a short id, written **last** on its line in a code tag:

```markdown
1. You can't invite more people than you have free seats. `id:seat-limit`
```

- **The title comes first; the id is an afterthought.** Readers skip it. You use it when another file, a ticket or a conversation needs to point at exactly this item.
- **Format:** `id:` then lowercase words joined by hyphens. Each id is used once across the feature's files.
- **Nobody has to type them.** `node check.mjs --add-ids <folder>` adds the missing ones, made from the titles.
- **Ids never change after a handoff,** even when the title is reworded, because other files point at them.
- **Other files point at ids in a field:** `Covers: seat-limit, resend`. Personas can be named by id or by name.

| What | Where | Looks like |
|---|---|---|
| Persona | spec, under Personas | `` - **Workspace owner** — Manages billing and members. `id:owner` `` |
| Requirement | spec, under Requirements | `` ### Owners invite people by email `id:owners-invite` `` |
| Rule | spec, numbered under its requirement | `` 1. You can't invite more people than you have free seats. `id:seat-limit` `` |
| Open question | spec, under Open questions | `` ### How long should an invite stay valid? `id:invite-expiry` `` |
| Screen | screen index, under Screens | `` ### Members page `id:members-page` `` |
| Flow | screen index, under Flows | `` ### Owner invites three people `id:owner-invites` `` |
| Acceptance case | design spec, under Acceptance cases | `` ### Owner sends invites `id:owner-sends-invites` `` |

Examples and interactions don't get ids. The design spec repeats each screen's heading, id included, to attach its frames; that is an entry for the screen, not a new screen.

## The product spec

`spec.md` has these `##` sections, in this order: Problem · Goals and success metrics · Personas · Requirements · Permissions · Data and privacy · Analytics · Rollout · Out of scope · Open questions.

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
- Owner: Priya
- Due: 14 Nov
- Answer: 14 days, matching the password reset link.
```

A question stays open until it has an `- Answer:` line with the decision. Leave the Answer line out until then; "TBD", "not decided yet" and the like count as unanswered.

### Proposed and n/a

- `(proposed)` after a title, on a Who or Priority line, or in a permissions cell marks something the PM hasn't confirmed yet. A spec can't be handed off until every one is confirmed or removed.
- A required item that doesn't apply is written `n/a — <why>`. "n/a" alone fails the check: the reason keeps a gap deliberate instead of forgotten.

## The screen index

```markdown
## Screens

### Invite people dialog `id:invite-dialog`
- Type: modal
- Personas: owner
- Entry: Invite people on the Members page
- Covers: send-invites, seat-limit, bad-addresses
- States:
  - default: email entry that turns each address into a chip, seats left, Send invites
  - empty: no addresses yet; Send invites is off
  - loading: Send invites shows a spinner
  - error: sending failed; the chips are kept, with Try again
  - denied: n/a — only owners can open it

#### Send invites
- Trigger: Send invites with 1 to 20 valid chips that fit the free seats
- Result: the dialog closes, a toast says "3 invites sent", rows appear under Pending invites

## Flows

### Owner invites three people `id:owner-invites`
- Persona: owner
- Steps:
  1. Members page → Invite people
  2. Invite people dialog → add three addresses; one already a member is skipped
- Covers: send-invites, bad-addresses
```

- Screen types: `page`, `modal`, `drawer`, `panel`, `email`, `toast`, `notification`, `sms`, `push`. Emails, toasts and notifications only need a `default` state.
- `Covers` lists rule ids, or a requirement id to cover all its rules.
- Flow steps name screens by title or id.
- An optional `- Change:` field says whether a screen is new or an update to an existing one.

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
- **F1** Front matter has kind, feature, version and status (draft or ready).
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
- **S8** Every open question is answered, or has an owner and a due date. A spec is only ready to hand off with no unanswered questions and nothing still marked (proposed).
- **S9** Rules and examples avoid vague words (fast, easy, intuitive…). Warning only.

**Screen index**
- **I1** The screen index names the spec version it was built from, and it matches the spec. It can only be ready if the spec is.
- **I2** Every screen has a type, personas, an entry point, what it covers, and its states.
- **I3** Every screen lists each required state, or marks it n/a with a reason.
- **I4** Every interaction has a trigger and a result.
- **I5** Every flow names one persona, steps through declared screens, and what it covers.
- **I6** Every rule is covered by a screen or a flow (directly or through its requirement).
- **I7** Every persona with requirements has at least one flow.

**Design spec**
- **D1** The design spec names the screen index version it was built from, and it matches. It can only be ready if the index is.
- **D2** Every screen in the index has a design entry.
- **D3** Every required state of every screen has a frame link, or n/a with a reason.
- **D4** Every acceptance case names one persona, the rules it covers, its steps and what to expect.
- **D5** Every rule has at least one acceptance case.
- **D6** Every persona with requirements has at least one acceptance case.

## Running the check

```sh
node check.mjs specs/invite-teammates            # a folder with any of the three files
node check.mjs specs/invite-teammates --add-ids  # first add any missing ids, then check
node check.mjs specs/invite-teammates --json     # machine-readable
t3-sdlc spec check specs/invite-teammates        # the same check, from the t3-sdlc CLI
```

A file is ready to hand off when it has no errors and, for the spec, no unanswered questions or `(proposed)` items. The checker reports those as "still open". A screen index or design spec can be built from a draft to get ahead, but stays a draft until the file before it is ready.

The check proves a file is complete and consistent, not that it is good: "empty: empty state" passes. The skills hold the quality bar.

Set `status: ready` when you hand a file off; bump `version` if it changes afterwards, so the next role knows to update.

A complete example for a made-up company is in `example/` next to this file when it ships inside a skill, and in the t3-sdlc repo under `examples/acme/handoff/`.
