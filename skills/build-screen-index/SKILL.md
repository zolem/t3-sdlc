---
name: build-screen-index
description: Runs the screen-index part of a product working session. Turns an agreed product spec into screen-index.html, a page of wireflows with rough wireframes of every screen and state, numbered taps leading from screen to screen, and notes on behaviour, edge cases, errors and permissions beside each one. Walks the room through it, brainstorms what is missing, and changes it until product, design and engineering agree it is complete. Use when a team has a product spec or PRD and wants to see every screen and state to design, align on it, or check a design plan is complete before drawing.
---

# Build a screen index

You run the second half of a product working session. One person types for a room (product, design, engineering). The spec is agreed; now you draw it. `screen-index.html` shows every screen and state as rough wireframes, joined into flows, with the edge cases and errors beside each step. It's what the room aligns on, and then the designer's to-do list: a designer who designs everything in it leaves nothing for engineering to guess.

Most missing designs are states nobody listed (empty, error, no permission) and screens nobody walked to: the email, the confirmation, the page someone lands on from a link. Drawing them is the point.

Files in this skill's folder:
- `kit/FORMAT.md`: the format, the screen index data and its building blocks, and every completeness rule. Read it first.
- `kit/templates/screen-index.html`: the file you fill in. Its script draws the page; you only write the JSON data block.
- `kit/check.mjs`: the completeness check (Node 18+).
- `references/screen-checklist.md`: what each state and interaction should answer.
- `kit/example/`: a finished spec and screen index. Open `screen-index.html` there and read its data block before you write: it shows the level of detail to aim for.

## Start

1. **The spec.** Read `spec.md` and run the check on its folder. It should be `status: ready`, with nothing open. If it isn't, say what's open and go back to the spec review (`write-product-spec`) first. If the room wants to look ahead anyway, build it, but the index stays a draft.
2. **Ask design, in one message:**
   - Which existing screens does this touch? Screenshots, a design file or the live app help. Changes to existing screens are drawn as updates.
   - Extend existing screens, or add new ones?
   - Which devices are we designing for?

   When they answer, compare their list with the screens the spec needs, and name any they didn't mention ("the spec also changes project settings").
3. **Where it lives.** If you can write files, copy `kit/templates/screen-index.html` next to the spec and edit only its data block. If you can't, but can show an HTML preview, give them the whole template with your data block filled in.

## Build it

Work from the spec, persona by persona. Read every rule and every example: ✅ examples become default states and flows; ⚠️ and ❌ examples become states, notes and interaction errors.

1. **Flows first.** For each persona with requirements, the journeys that satisfy their rules:
   - Start where they really begin (an email, a notification, the nav, a shared link) and end where they see the result.
   - One flow per real journey, one persona each.
   - `tap` on each step is what they tap to go on: a button, heading, field, list row, tab or menu item on that step's wireframe. The check makes sure it's there.
   - Notes beside each step: `behavior`, `edge` (⚠️), `error` (❌), `who` (permissions).
2. **Screens from the flows.** Every place a flow stops is a screen, including confirmation dialogs, emails, notifications, landing pages from links, and the page someone without permission lands on. Give each its type, `new` or `update`, personas, every way in (`entry`) and the rules it covers. A section inside an existing screen is a `panel`, with `inside` naming that screen.
3. **Every state, drawn.** For each required state:
   - **Draw it:** a wireframe and a note specific enough to design from. Good: "only the owner is listed; a prompt explains why to invite people". Bad: "empty state".
   - **Unchanged:** only on an existing screen, for a state this feature doesn't touch.
   - **n/a:** a state that can't happen, with a reason that would convince the room. "Only owners can reach this page" is fine; "not needed" is not.
   - **Extra states** for anything else worth designing: a limit reached (`over-limit`), what another persona sees (`as-member`), something already decided (`decided`). Prefer an extra state to a second screen when only the content differs.
4. **Interactions:** each action that changes something, with its `trigger`, `result`, `to` (if it opens another screen) and `errors`. Cover confirmation and undo for destructive actions.
5. **Names and the case list:** run the check with `--sync`. It copies persona names and rule titles from the spec, and lists every ⚠️ and ❌ example in `cases`, so you never type them.
6. **Place every edge case and error.** For each entry in `cases`, make sure it shows up as a state, a flow note or an interaction error, and fill in `where` (a screen id, `screen-id/state`, or a flow id). If one fits nowhere, a screen or state is missing. The check fails on any that aren't placed.
7. **Gaps in the spec** go in `questions`, each with your proposed answer. Product decides them in the review. Rule of thumb: if it changes what the product does or allows, it's product's; if it's only how it looks, it's design's, and goes in a note.

**Wireframes are sketches, not designs.** Use only the building blocks in `kit/FORMAT.md`. Show what's on the screen with the spec's real words (labels, messages, numbers), not how it looks: no colours, spacing or visual hierarchy. Keep each one small enough to recognise the screen and the state. The designer decides the layout.

Use `references/screen-checklist.md` to catch what the spec forgot: long text and big numbers, paging, narrow screens, keyboard and focus, success feedback.

Run the check until it has nothing to fix, then review.

## Review with the room

Tell the driver where the file is and to open it in a browser (or open it yourself, if you can show a preview). They'll share it on screen. Then walk through it:

1. **The headline:** screens (how many new, how many changed), states to draw, flows per persona. Point them at the **Edge cases and errors** table: it's the quickest way to check nothing from the spec got lost.
2. **Flows, one at a time.** For each, one line on what it shows and the edge cases beside it.
3. **What might be missing.** Prompt the room with what's commonly forgotten for this feature, picked from the screen checklist. Make it specific ("Does anyone get told when a repeat is skipped?"), and pick the ones that apply, not all of them.
4. **Questions for product**, each with its proposal. The PM is in the room: get answers now.

Then ask how they want to go on. Exactly three ways:
- **Agree.** If nothing is open, finish.
- **Ask for changes**: "the board needs a filter", "drop the guest flow", "the dialog should be a page". If a change contradicts the spec or another part of the index, say so and ask which wins. Make them in the data block, then:
  - bump `version` once for the round, however many changes it had;
  - add one entry to `changes` saying what moved, in a few short notes ("Repeat settings: now a dialog, not a panel");
  - re-read every `cases` entry whose `where` names a screen, state or flow you changed, and move it if what it pointed at is gone (the check only knows the place still exists);
  - run the check with `--sync`, and tell them to reload the page.
- **Edit by hand.** They change the data block or the spec themselves. Before they start, keep a copy of both outside the feature folder (or rely on `git diff`), so you can say exactly what they changed. When they're done, re-read both, run the check with `--sync`, tell them what changed and anything that now fails, and review again.

Repeat until they agree. Each time, show only what changed and what's still open.

**When an answer or a change touches the spec** (a product question answered, a rule changed, scope cut): the PM is in the room, so update `spec.md` too.
- Write the answer into the spec, and record it in the index question's `answer`. Check the spec for rules the change now contradicts.
- Bump the spec's `version` once for the round, add its line to the spec's `## Changes` (say it came from the screen index review), and set the index's `specVersion` to match. The spec stays `ready` meanwhile, so it can't hold `(proposed)` items: anything you'd infer while changing it, confirm with the room in the same message.
- Run the check with `--sync`. It catches what the spec change left behind: a rule no screen covers any more, renamed rules, new edge cases to place.

## Finish, or pause

**Done** when the check says complete, nothing is open, and the room agrees:
1. Set `status: ready` on the index (and on the spec, if you changed it).
2. Suggest frame names for the design: screen id and state, e.g. "invite-dialog / empty".
3. Say: "This is what design draws. When it's drawn, `review-design` checks every state is covered and writes the acceptance cases."

**Pause** when the room can't answer something today. The index stays a draft; the check lists what's open. When they come back, read both files, take the answers, and go straight to the review.

## Check

Run `node <this skill's folder>/kit/check.mjs <feature folder> --sync` (spec and index in one folder, so it can check one against the other). If you can't run code, apply the rules in `kit/FORMAT.md` by hand. Explain problems in plain words ("the Members page has no loading state yet"), not rule ids. A clean check means complete, not good: still hold every state to the bar above.

## Never

- Edit anything in `screen-index.html` outside its data block. The script draws the page and must stay as the template has it.
- Make visual design decisions: colours, styles, spacing, components. The wireframes say what must exist; the designer decides how it looks.
- Mark a state n/a or unchanged without a reason that would convince the room.
- Change the spec without the room agreeing to it, or without bumping its version.
