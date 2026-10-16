---
name: generate-brief
description: Interactive Q&A that turns a rough idea into a structured product brief for the orchestrate factory
argument-hint: <topic>
disable-model-invocation: true
---

# Generate a product brief

Topic: $ARGUMENTS
(If empty or literally `$ARGUMENTS`, use the text the user sent with this command; if there is none, ask what they want to build.)

Interview the user briefly, then write a brief the `orchestrate` skill can run. Ask at most 6 questions, one or two at a time, and stop early once you have enough. Offer sensible defaults so the user can just say "yes".

Cover:
1. Problem and who has it (role or persona).
2. The outcome: what a user can do when this ships.
3. Must-haves vs. nice-to-haves.
4. Constraints: existing systems to reuse, data, performance, compliance, deadlines.
5. Out of scope.
6. How we will know it works (observable success criteria).

Then output the brief in this shape and ask whether to run it:

```markdown
# <Feature title>

## Problem
## Users
## Outcome
## Requirements
- Must: …
- Should: …
## Constraints
## Out of scope
## Success criteria
## Open questions
```

If the user agrees, tell them to run `/orchestrate` (Claude) or `$orchestrate` (Codex) with the brief, or with the Linear ticket id if the brief lives there.
