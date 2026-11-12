---
name: build-screen-index
description: Turns a product spec into a screen index (screen-index.md) for a designer, listing every screen, state, interaction and flow the design has to cover, per persona, including error, empty, loading and permission states. Use when a designer receives a product spec or PRD and wants to know everything to design, or wants to check a design plan is complete before drawing.
---

# Build a screen index

You turn a product spec into `screen-index.md`: the designer's complete to-do list. A designer who designs every state in it leaves nothing for engineering to guess:
- every screen, and every state of each screen;
- every interaction, and every error the user can hit;
- every flow, for each persona.

Most missing designs are states nobody listed (empty, error, no permission) and pages nobody walked to. Listing them here is the point.

Files in this skill's folder:
- `kit/FORMAT.md`: the handoff format and every completeness rule. Read it first.
- `kit/templates/screen-index.md`: the skeleton.
- `kit/check.mjs`: the completeness check (Node 18+).
- `references/screen-checklist.md`: what each state and interaction should answer.
- `kit/example/`: a finished spec, screen index and design spec. Skim `screen-index.md` there before you write: it shows the level of detail to aim for.

## Before you start

1. **Team profile.** If a skill named `team-profile` is installed (the team makes one with `create-team-profile`), read it. Otherwise use generic defaults and say so. It gives:
   - the persona ids;
   - extra required states (copy them into `required_states`);
   - supported devices.

   Without it, use the generic defaults and say so.
2. **The spec.** Get `spec.md`: a file, a ticket attachment (fetch it if you have a tracker tool), or pasted text.
   - It should be `status: ready`.
   - If it is still a draft, or the check reports errors or open items in it, say which gaps will make the index guesswork. Offer to continue anyway; you will list your assumptions as questions for product, and the index stays a draft until the spec is ready.
3. **What you can do here.** Same as the other kit skills:
   - Can write files → write the index next to the spec. Cannot → keep it in one Markdown block the designer can copy.
   - Can run code → run `node <this skill's folder>/kit/check.mjs <folder>`. Cannot → apply the rules in `kit/FORMAT.md` by hand.
4. **Existing product.** Ask whether the designer has the current app's screens handy (a design file, screenshots, or the live app). Changes to existing screens are designed differently from new ones (`- Change:`).

## How to build it

Work from the spec, persona by persona.

1. **Flows first.** For each persona with requirements, write the flows that satisfy their rules and examples:
   - Start from where they actually begin (an email, a notification, the nav, a shared link) and end where they see the result.
   - One flow per real journey; a flow names exactly one persona.
   - `- Covers:` lists the criteria the flow proves.
2. **Screens from the flows.** Every place a flow stops is a screen. That includes the surfaces people forget:
   - confirmation dialogs;
   - emails and notifications;
   - landing pages from links;
   - the page someone without permission lands on.

   For each screen give its type, whether it is new or a change, its personas, every way in (`Entry`), and the rules it covers (by id).
3. **States for every screen.** For each required state, write what the user actually sees, specific enough to design from:
   - Good: "only the owner is listed; a prompt explains why to invite people".
   - Bad: "empty state".
   - A state that cannot happen is `n/a — why`. The reason must hold up: "only owners can reach this page" is fine; "not needed" is not.
4. **Interactions.** Each action that changes something becomes an interaction (a `####` heading) under its screen, with:
   - **Trigger** and **Result** (what changes on screen and in the data);
   - the errors that can interrupt it;
   - confirmation and undo for destructive actions;
   - double-submit and in-progress behaviour where it matters.
5. **Place every edge case and error.** Each ⚠️ and ❌ example in the spec must show up on a screen, a state or an interaction where the person meets it. If it fits nowhere, a screen or state is missing.
6. **Persona differences.** When personas see the same screen differently (fewer actions, read-only), say so in the states or add a note. Don't make a second screen unless the layout really differs.

Use `references/screen-checklist.md` to catch what the spec forgot:
- long text and big numbers;
- paging;
- narrow screens;
- keyboard and focus;
- success feedback.

**Gaps in the spec.** Write them under `## Questions for product`: plain bullets, no ids, each with your proposed answer. Questions go back to the product owner. Don't invent product decisions inside the index.

## Review it with the designer

Walk the designer through it briefly:
- the flows per persona;
- the screens, with how many are new vs changed;
- the number of states to design.

Then ask the questions that only they can answer:
- "Is the invite dialog a modal or a page in our app?"
- "Do we already have a pattern for empty lists?"

Adjust the index to their answers. The designer owns this file once it exists; you keep it complete.

## Check and hand off

1. **Run the check** until the screen index has nothing to fix, explaining any problem in plain words ("the Members page has no loading state yet"). Problems in the spec are product's to fix; list them, don't edit the spec. A clean check means complete, not good: still hold every state to the bar above.
2. **Set `spec_version`** to the spec's version. Set `status: ready` only if the spec is ready; otherwise keep `draft` and tell the designer which spec questions block it.
3. **Deliver it** where the team keeps handoffs: tracker attachment, the feature folder, or the final file for the designer.
4. **Give the designer a checklist to work from:** one line per screen, with its states. They can tick these off while designing.
5. **Suggest frame names.** Recommend naming frames by id and state, e.g. "invite-dialog / empty", so `review-design` can match frames to the index automatically later.
6. **Tell them the next step:** "When the design is drawn, run `review-design` to check every state is covered and to write the acceptance cases."

## Never

- Design the screens: no layouts, components or visual choices. You list what must exist; the designer decides how it looks.
- Mark a state n/a without a reason that would convince the product owner.
- Change the spec. Raise questions for product instead.
