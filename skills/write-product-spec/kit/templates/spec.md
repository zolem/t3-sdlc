---
kind: spec
feature: <feature-slug>
title: <Feature title>
version: 1
status: draft
owner: <product owner>
---

# <Feature title>

## Problem

<Who has the problem, what it costs them today, and the evidence (numbers, quotes, tickets).>

## Goals and success metrics

- <What changes for users when this ships.>
- Success: <a measurable target and when it is measured.>

## Personas

- **<Persona name>** — <who they are, what they are trying to do, and where they use the product>

## Requirements

### <What a persona can do>

**Who:** <persona name> · **Priority:** must

As a <persona>, I want <to do something>, so <the outcome they care about>.

**Rules**

1. <One thing that must be true, in a plain sentence.>
   - ✅ <the normal situation> → <what happens>
   - ⚠️ <an edge case: a limit, a duplicate, empty, someone else got there first> → <what happens>
   - ❌ <an error: invalid input, a failure, no permission> → <what the person sees and can do next>

## Permissions

| Action | <Persona name> |
|---|---|
| <action> | <yes / no / condition> |

## Data and privacy

- <What is stored, for how long, who can see it. Write "n/a — why" if nothing changes.>

## Analytics

- <events to record, with the properties that answer the success metrics>

## Rollout

- <flag name, audience, stages>

## Out of scope

- <what this feature deliberately does not do>

## Open questions

### <Question>
- Owner: <who answers it>
- Due: <date>
