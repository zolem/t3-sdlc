---
name: check-handoff
description: Checks a feature's handoff files (product spec, screen index, design spec) for completeness and consistency, explains what is missing in plain language for whoever is asking, and says whether the feature is ready for its next step. Use when someone asks whether a spec or design is ready, receives a handoff, or wants to know what is missing before passing work on.
---

# Check a handoff

You check the handoff files for one feature and say, in plain words, what is missing and who has to fix it. The files are:
- `spec.md` from product;
- `screen-index.md` and `design-spec.md` from design.

Anyone can ask: a product manager before handing to design, a designer before handing to engineering, an engineer receiving the work.

Files in this skill's folder:
- `kit/check.mjs`: the completeness check (Node 18+).
- `kit/FORMAT.md`: the format and every rule, for when you cannot run code.

## Steps

1. **Find the files.** Use whatever you were given: a folder, files, tracker attachments (fetch them if you have a tracker tool), or pasted text. A folder may hold one, two or all three; the check covers what is there.
2. **Run the check.**
   - **You can run code:** `node <this skill's folder>/kit/check.mjs <folder or files>`. Add `--json` if you want to process the result.
   - **You cannot:** apply every rule in `kit/FORMAT.md`, in order, and be strict. A rule you cannot verify counts as failed, with the reason.
3. **Explain the result for the person asking.**
   - Group problems by who fixes them: product (spec), or design (screen index, design spec).
   - Say each in their terms. "Two error cases have no screen yet (expired invite, wrong account)" beats "I7 ×2". Rule ids go in brackets at most.
   - Lead with blockers. Mention warnings (vague wording) after, as suggestions.
4. **Check versions line up.**
   - The screen index's `spec_version` must match the spec's `version`.
   - The design spec's `index_version` must match the index's `version`.

   A mismatch means someone changed an upstream file after the handoff. Say what changed if you can tell, and who needs to update.
5. **Give a verdict for the next step:**
   - **Product → design:** the spec has no errors and no unanswered questions.
   - **Design → engineering:** all three files have no errors and their versions line up.

   If it's not ready, say exactly what's left and who owns it.

## For engineers receiving a handoff

When all three files are ready:
- **Summarise what's being built:** personas, requirements (must / should / could), screens (new vs changed), acceptance cases.
- **Note any `Questions for product` left in the screen index.**
- **Name the next step:**
  - with the t3-sdlc factory installed, "orchestrate" with these files as the brief;
  - otherwise, plan the architecture from them.

The acceptance cases in the design spec are how the finished feature will be judged, whatever the architecture.

## Never

- Call something ready while the check reports errors.
- Fix the files yourself while checking. Report what's missing; the owner fixes it (or asks you to).
