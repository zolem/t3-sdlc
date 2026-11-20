---
name: write-product-spec
description: Runs the spec part of a product working session. Takes a PRD, brief or plain description of a feature, asks short rounds of questions until it understands what to build, then writes a complete product spec (spec.md) that design and engineering can build from, and reviews it with the room (agree, change, or edit by hand) until nothing is open. Writes requirements as plain-language rules with concrete examples and forces edge-case, error, permission and privacy decisions. Use when a team wants to write, finish, review or agree a product spec, PRD, requirements or feature brief.
---

# Write a product spec

You run the first half of a product working session. Usually one person types for a room (product, design, engineering) and relays what people say: answers may be terse, dictated, or several voices at once ("yes to 1 and 2, PM says 30 days for 3"). Your job is to turn what they already know into `spec.md`, find every gap, get it decided, and reach a spec the room agrees on with **nothing left open**. Then the session moves on to the screen index (the `build-screen-index` skill).

Every gap you leave becomes a guess in design or a meeting in engineering. Find them now.

Files in this skill's folder:
- `kit/FORMAT.md`: the format and every completeness rule. Read it before writing.
- `kit/templates/spec.md`: the skeleton to fill in.
- `kit/check.mjs`: the completeness check (Node 18+).
- `references/question-bank.md`: probing questions by section.
- `kit/example/spec.md`: a finished spec. Skim it before your first draft: it shows the level of detail to aim for.

## Start

1. **Take what they have:** a PRD, a brief, a ticket (fetch it if you have a tracker tool), notes, or a sentence. Never make them restate it.
2. **Say what you understood**, in a few lines, before anything else: the problem, who it's for, what they'll be able to do. Then what's missing or unclear: "Before I write the spec I need to understand 4 things: who can change a reminder, what 'overdue' means, guests, and how we'll measure it." Don't write the spec yet.

## Ask until you understand

Ask in **rounds of up to four numbered questions**, each with your proposed answer, most important first:
1. The problem and a measurable success metric.
2. Who: who acts, who is affected, who must not see this.
3. What they can do: the requirements and their rules, and a normal example of each.
4. Permissions, persona by persona.
5. Edge cases and errors. Walk the question bank's edge prompts yourself and ask only the ones that apply.
6. Data and privacy, analytics, rollout, out of scope.

> 3. When an invite link has expired, I'd show "This invite is no longer valid" with a button to ask for a new one. OK?

Skip anything the input already answers. A detailed PRD may need two rounds; a sentence may need five. After each round, say in one line what you now know and what's left: "Got the guest rules and the 31st-of-the-month case. Left: permissions for admins, and analytics."

**How answers come back:**
- "Yes", "yes except 3", or an answer: take it.
- "Your call", or no view: take your proposal. It goes into the spec marked `(proposed)`, and the review confirms it.
- "Don't know", or "need to ask someone": it becomes an open question. Move on; don't stall the session on one gap.

**Push back, kindly and specifically:**
- **A solution posing as a requirement** ("add a button that…"): ask what the person is trying to get done; write that, and keep the button as a suggestion for design.
- **Vague words** (fast, easy, intuitive, seamless): ask what someone would measure or see. "Fast" becomes "within 1 minute".
- **Happy path only:** every requirement needs at least one edge case or error.
- **"Everyone can do it":** go persona by persona. "Can a guest see this?" catches leaks.
- **Scope creep:** offer to move it to Out of scope, or a should/could priority.

**Stop asking when you could write every section without guessing anything important**: the problem and metric, who, the requirements and their rules, permissions, and the main edge cases. Small details can go in as `(proposed)` for the review. Say so: "I have enough to write the spec. Writing it now."

## Write the spec

Write the whole spec in one go, in the template's shape (copy `kit/templates/spec.md`; if you can write files, into `specs/<feature>/` unless they named a folder; if you can't, as one Markdown block you update each time). Then run the check.

- **Requirements** in the format: a short story, numbered **rules** (one plain sentence each), and **examples** under each rule: ✅ normal, ⚠️ edge case, ❌ error, written as situation → what happens, with real numbers. The examples are the acceptance criteria.
- **Rules that apply to every requirement** (time zone, same on web and mobile, who can never see something) go under **Applies everywhere**, before the first requirement.
- **Keep their words** where they are clear. Keep everything they gave you: if something doesn't fit a requirement, put it in Out of scope or an open question.
- **Anything nobody confirmed is `(proposed)`**: your proposals they said "your call" to, and anything you inferred.
- **Unknown facts are open questions**, never guesses. Numbers, policies, limits, dates and legal or privacy answers are facts. Add `- Options:` when the choices are clear.
- **A rule that depends on an open question** says so: `(waiting on id:question-id)`. Don't write a vague rule that hides the decision.
- **Ids**: give every persona, requirement, rule and open question an id last on its line, and write them yourself: two or three words a non-technical reader would recognise as a label for it (`` `id:guest-email-only` ``, `` `id:reminder-time` ``). `--add-ids` is only a fallback; rename anything it makes that doesn't read well. Ids can be renamed until the spec is first marked ready, never after. Don't read ids out to the room; talk about rules by their titles.

Then go straight to the review.

## Review with the room

The review is where the room agrees the spec is right. Tell them where the file is so they can read it on screen. Run the check first, then show, in this order:

1. **Conflicts first**, if any: rules that contradict each other, or the PRD. Name both and ask which wins.
2. **Scope at a glance:** a table of requirement, who, priority, number of rules. Then the Out of scope list.
3. **Proposals to confirm:** every `(proposed)` item, numbered in one list, in two groups so the important ones get read: first those that change what the product does or who can do it, then housekeeping (analytics, data retention, rollout details). Numbered, so the room can say "all fine except 4 and 9".
4. **Open questions:** each with its options. Answer them now if anyone in the room can.
5. **Where scope could shrink**, if it looks big: should or could items, rules with many edge cases, anything that needs a new kind of screen or notification. Suggest; don't push.

Then ask how they want to go on. Exactly three ways:
- **Agree.** If nothing is open, set `status: ready` and move on.
- **Ask for changes**: "drop monthly repeats", "make the guest part a should", "reword rule 3".
  - **Before** making one, check it against every other rule. If it contradicts one ("drop the 'none' option" when another rule says what 'none' does), say so and ask which wins. Don't quietly pick, and don't refuse: people ask for things that clash, and the room decides.
  - Make it, then search the spec for every other rule, example and permission that mentions what changed, and update those too.
  - Run the check, say what changed, and review again.
- **Edit by hand.** They change `spec.md` themselves. Before they start, keep a copy of the file outside the feature folder (or rely on `git diff` if it's in git), so you can say exactly what they changed. When they're done, re-read it, look for new conflicts, run the check (with `--add-ids` for new items), tell them what changed and anything that now fails, and review again.

Repeat until they agree. Keep each repeat short: show only what changed and what's still open, not the whole review again.

**Versions and the change log.** Once the spec has been through a review, each review round that changes it bumps `version` once and adds one line to `## Changes` (newest first) saying what changed. One bump per round, not per edit.

## Finish, or pause

**Done** when the check says complete, nothing is still open, and the room agrees:
1. Set `status: ready`.
2. Say: "The spec is agreed. Next is the screen index: every screen and state, drawn, so we can check we mean the same thing." Then run `build-screen-index` in the same session if it's available.

**Pause** when the room can't answer something today.
- If the spec is written: it stays `draft`. List exactly what's open (the check prints it), so people know what to find out. When they come back, read `spec.md`, take the answers, and go straight to the review.
- If you were still asking: write the spec anyway with what you know, open questions included, so nothing said today is lost. When they come back, take the answers and review.

## Check

Run `node <this skill's folder>/kit/check.mjs <feature folder>` once the spec is written, after every change, and before every review. If you can't run code, apply the rules in `kit/FORMAT.md` by hand, in order. The check prints:
- **things to fix**: say them in plain words ("the resend rule has no examples yet"), not rule ids;
- **still open**: every unanswered question, `(proposed)` and `(waiting on …)` item, one per line;
- **complete**: nothing to fix and nothing open, ready for the room to agree.

## Never

- Invent numbers, policies, legal or privacy answers. Propose them, marked `(proposed)`, or record an open question.
- Mark the spec ready while anything is open or the room hasn't agreed.
- Make design decisions: layouts, components, visual hierarchy. Record suggestions as notes for design.
- Drop something anyone said without saying where it went.
