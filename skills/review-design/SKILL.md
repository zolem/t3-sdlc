---
name: review-design
description: Reviews a finished or in-progress design against its screen index and product spec, finds missing screens, states, copy and persona variants, writes the design spec (design-spec.md) with a frame link for every state, and writes the acceptance cases that prove each requirement. Use when a designer wants to check a design is complete, prepare a design handoff for engineering, or write acceptance cases.
---

# Review a design and write the design spec

You check a design against `screen-index.md` and `spec.md`, tell the designer exactly what is missing, and produce `design-spec.md`: the design handoff engineering builds from. It has two parts:
- **Frames:** a link to every state of every screen, plus copy and behaviour notes the frames cannot show.
- **Acceptance cases:** the steps someone follows, as each persona, to prove each rule in the spec works. These stay the same whatever architecture engineering chooses, so they are written here, from the spec and the design, not later from the code.

Files in this skill's folder:
- `kit/FORMAT.md`: the handoff format and every completeness rule. Read it first.
- `kit/templates/design-spec.md`: the skeleton.
- `kit/check.mjs`: the completeness check (Node 18+).
- `kit/example/`: a finished spec, screen index and design spec.

## Before you start

1. **Team profile.** If a skill named `team-profile` is installed (the team makes one with `create-team-profile`), read it: personas, required states, devices, the design tool and how to link frames.
2. **Inputs.** You need:
   - the spec and the screen index (files, tracker attachments, or pasted text);
   - the design, in whatever form you can read, from best to worst:
     - a design tool you can read through a connector (for example a Figma file link);
     - exported frames or screenshots the designer uploads;
     - a list of frame links the designer pastes, one per state.

   If you cannot see the design at all, say so: you can still build the frame list and the acceptance cases with the designer filling in links, but you cannot judge whether a state is actually drawn.
3. **What you can do here.**
   - Can write files → write `design-spec.md` next to the other two. Cannot → keep it in one Markdown block.
   - Can run code → run `node <this skill's folder>/kit/check.mjs <folder>`. Cannot → apply `kit/FORMAT.md` by hand.

## Review the design

1. **Map frames to the index.** For each screen in the index and each of its required states, find the frame that shows it.
   - Frames named by id and state ("invite-dialog / empty") map directly.
   - Otherwise match by content and confirm the uncertain matches with the designer in one batch, not one by one.
2. **Report gaps, grouped so the designer can work through them:**
   - **Missing screens:** in the index, not in the design.
   - **Missing states:** e.g. "the Request invite dialog has no error state".
   - **Missing copy:** every error and edge-case message from the spec, every empty state, confirmation dialogs, emails.
   - **Persona variants:** a member who sees fewer actions, a guest's read-only view.
   - **Interactions the frames don't explain:** what happens after Send, where focus goes, what undo looks like.
   - **Narrow-screen and long-text cases**, for the devices the profile lists.
   - **Unindexed screens:** in the design but not in the index. Either the index is missing them (update it and bump its version) or they are out of scope.
3. **Judge against the spec, not taste.** A state is missing when the spec or index requires it. Visual opinions are optional suggestions, clearly marked as such, never blockers.

## Write the design spec

Fill `design-spec.md` from the template:
- **`index_version`:** the screen index's version.
- **`design_file`:** a link to the design file.
- **One entry per screen** (`` ### <screen name> `id:…` ``, same name and id as the index), with:
  - `- Frames:` one indented line per required state, with a link, or `n/a — why` matching the index;
  - `- Copy:` final copy for messages and buttons;
  - `- Notes:` behaviour the frames cannot show (animation, responsive rules, focus order, timing).

**Acceptance cases**, at least one per rule and one or more per persona, each ending with its own id:
- `- Persona:` exactly one persona.
- `- Covers:` the ids of the rules it proves.
- `- Steps:` from a known starting state, written as a person would do them in the product ("Open Settings → Members", not "call the API").
- `- Expect:` what they see when it works, using the real copy from the design.

Add separate cases for important error rules, e.g. "the invite link has expired". Write cases so that someone new to the product, or an AI driving a browser, could follow them without asking.

## Check and hand off

1. **Run the check** until the design spec has nothing to fix. Set `status: ready` only if the screen index is ready; otherwise keep `draft` and say what it is waiting on.
2. **If the review changed the index**, bump the index's version and update `index_version`.
3. **Deliver the three files together** where the team keeps handoffs: tracker attachment, the feature folder, or files for the designer.
4. **Tell the designer what engineering receives:**
   - the spec;
   - the screen index;
   - the design spec;
   - a clean check across all three.

   Engineering can start from these with `check-handoff`, or hand them to the t3-sdlc factory.

## Never

- Approve a design with required states missing because "engineering can figure it out". That is exactly the guessing this step removes.
- Rewrite the product spec. Spec gaps you find go back to product as questions.
- Invent frame links. A missing link stays missing until the designer provides it.
