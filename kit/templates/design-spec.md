---
kind: design-spec
feature: <feature-slug>
title: Design spec — <Feature title>
version: 1
status: draft
index_version: <the screen index's version>
design_file: <link to the design file>
---

# Design spec: <Feature title>

## Screens

### <Screen name, with its id from the screen index>
- Frames:
  - default: <link to the frame>
  - empty: <link>
  - loading: <link>
  - error: <link>
  - denied: <link, or n/a — why (match the screen index)>
- Copy: <final copy for headings, buttons, empty and error messages>
- Notes: <behaviour the frames cannot show: animation, responsive rules, focus order>

## Acceptance cases

What someone does to prove each rule, as each persona. These stay the same whatever architecture builds the feature.

### <Persona> <does something>
- Persona: <persona name>
- Covers: <rule ids>
- Steps:
  1. <step from a known starting state>
  2. <step>
- Expect: <what they see when it works>
