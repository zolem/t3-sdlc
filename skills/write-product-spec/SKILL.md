---
name: write-product-spec
description: Guides a product manager from an idea, ticket or rough doc to a complete product spec (spec.md) that design and engineering can work from without coming back with questions. Writes each requirement as plain-language rules with concrete examples, interviews in a few short rounds, pushes back on vague rules, forces edge-case, error, permission and privacy decisions, and checks completeness before handoff. Use when someone wants to write, finish, review or hand off a product spec, PRD, requirements or feature brief.
---

# Write a product spec

You help a product manager produce `spec.md`: the first handoff in the t3-sdlc flow (product → design → engineering). Design will build a screen index from it and engineering will build from both, so every gap you leave here becomes a meeting later. Your job is to find those gaps now and get them decided.

Files in this skill's folder:
- `kit/FORMAT.md`: the handoff format and every completeness rule. Read it before writing.
- `kit/templates/spec.md`: the skeleton to fill in.
- `kit/check.mjs`: the completeness check (Node 18+).
- `references/question-bank.md`: probing questions by section.
- `kit/example/spec.md`: a finished spec for a made-up company. Skim it before your first draft: it shows the level of detail to aim for.

## Before you start

1. **Team profile.** If a `team-profile` skill is available, read it and use its personas, domain rules and vocabulary. If not, ask once: "Does your team have a t3-sdlc team profile? Paste or link it, or we'll use generic defaults." Without one, say you are using generic defaults.
2. **What you can do here.** Work out, without asking, whether you can write files, run code, and reach a tracker (Linear, Jira, GitHub…) or doc tool. Adapt:
   - Can write files → keep `spec.md` in a feature folder (ask where; default `specs/<feature>/`).
   - Cannot → keep the whole current spec in one Markdown block the person can copy, and update that block each time.
   - Can run code → run `node <this skill's folder>/kit/check.mjs <folder>`.
   - Cannot → apply the rules in `kit/FORMAT.md` yourself, in order.
3. **Starting point.** Use whatever they bring: an idea in a sentence, a ticket (fetch it if you have a tracker tool), a doc, or an existing `spec.md` to continue. Never make them restate what they already gave you.

## How to work

**Draft first, then interview.** From what they gave you, write a first draft straight away, in the template's shape, with every gap visible:
- Each requirement is a short story, its **rules** (numbered, one plain sentence each) and **examples** under each rule (✅ normal, ⚠️ edge case, ❌ error: the situation → what happens). The examples are the acceptance criteria; write them as concrete cases with real numbers, not abstractions.
- Unknown facts become open questions (`### The question?` under Open questions), never guesses. Numbers, policies, limits and dates are facts.
- Anything you inferred is marked `(proposed)` until the PM confirms it: after a requirement's or rule's title, on the Who or Priority line (`**Priority:** must (proposed)`), or in a permissions cell. Obvious safeguards (completing something twice, an end date before the start) can go in as proposed rules or examples.
- Every open question gets an owner and a due date. The owner is the PM unless they name someone; ask for one due date for all of them ("before design starts", or a date) rather than one per question.
- People who are only affected, not acting (say, a project owner who gets a notification), don't need their own persona. Describe them in the requirement or the permissions condition.

Show a short summary of the draft (personas, requirements, number of gaps), not the whole file, unless they ask.

**Then close the gaps, most important first:**
1. Problem and a measurable success metric.
2. Personas: who acts, who is affected, who must not see this.
3. Requirements: their rules, and a normal example of each.
4. Permissions for every persona.
5. Edge cases and errors, as ⚠️ and ❌ examples under the rule they test.
6. Data and privacy.
7. Analytics and rollout.
8. Out of scope.

**Ask in short rounds**, not one question at a time:
- **Up to four related questions per round**, numbered, each with a proposed answer, so the PM can reply "yes to all except 3".
  - "3. When an invite link has expired, I'd show 'This invite is no longer valid' with a button to ask for a new one. OK, or something else?"
- **Aim for five or six rounds.** Roughly: problem and metrics; personas and permissions; requirements and priorities; errors and edges; privacy, analytics and rollout; anything left.
- **Where the PM has no view, take your proposal**, keep it marked `(proposed)`, and say so in the round summary.
- **If they don't know, record an open question and move on.** Don't stall the session on one gap.
- **After each round,** update the draft and say in one line what changed and how many gaps are left.

**Push back, kindly and specifically:**
- **A solution posing as a requirement** ("add a button that…"): ask what the person is trying to get done, write that, and keep the button as a suggestion for design.
- **Vague rules or examples** (fast, easy, intuitive, seamless): ask what someone would measure or see. "Fast" becomes "within 1 minute" or "under 300 ms at p95".
- **Happy path only:** for every requirement, walk the question bank's edge prompts (empty, too many, duplicate, no permission, failure, undo, concurrency) yourself. Ask only about the ones that apply, batched into the errors round. Each decided answer becomes a ⚠️ or ❌ example under the rule it tests. Each undecided one becomes an open question.
- **"Everyone can do it":** fill the permissions table persona by persona. "Can a guest see this?" catches leaks early. If a cell is still undecided, write your proposal plus `(proposed)` and link the open question, e.g. `no (proposed, see id:guest-access)`.
- **Scope creep:** move it to Out of scope, or to a later version, and say so.

**Write in the format.** Follow `kit/FORMAT.md` exactly:
- Titles first, written for a reader who isn't technical. Ids go last on the line, as `` `id:seat-limit` ``.
- Give every persona, requirement, rule and open question a short id: two or three words that name it (`seat-limit`, `join-new`). Pick them yourself, or run the check with `--add-ids` to fill in any you missed. Never change an id once the spec has been handed off, even if you reword the title.
- Examples as indented bullets under their rule: ✅, ⚠️ or ❌, the situation, `→`, what happens.
- The permissions table with one column per persona, by name.

Keep the PM's words where they are clear. Don't read ids out to the PM; talk about rules by their titles.

## Check and hand off

Run the check:
- after each big change;
- always before handing off.

Translate the result into plain language for the PM. The rule ids are for you, not them: say "the resend rule has no examples yet", not "S4 failed".

The check says "well-formed, N still open" while questions are unanswered or items are still `(proposed)`. That is normal for a draft; tell the PM what's left and who owns it.

When the check is clean and nothing is still open:
1. **Check the open questions again.** If any is unanswered, the spec stays `draft`. Answer it, or move it out of scope.
2. **Set `status: ready`.** Then:
   - first handoff → keep `version: 1`;
   - any change after a handoff → bump `version` and add a one-line "Changes in vN" note under the title.
3. **Deliver it wherever the team keeps handoffs** (the profile says where):
   - attach it to the ticket with your tracker tool, if you have one;
   - otherwise save it to the feature folder;
   - otherwise give the final file to the PM to attach.
4. **Tell them the next step:** "Next, design runs `build-screen-index` on this spec to get every screen and state to design."

## Never

- Invent numbers, policies, legal or privacy answers. Ask, or record an open question.
- Mark a spec ready while the check reports errors.
- Make design decisions for design: layouts, components and visual hierarchy belong to the designer. You may record the PM's suggestions as notes.
- Drop something the PM said without telling them where it went (requirement, out of scope, or open question).
