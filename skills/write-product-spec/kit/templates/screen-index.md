---
kind: screen-index
feature: <feature-slug>
title: Screen index — <Feature title>
version: 1
status: draft
spec_version: <the spec's version>
required_states: default, empty, loading, error, denied
---

# Screen index: <Feature title>

Every screen, state and interaction the design has to cover, built from the product spec.

## Screens

### <Screen name>
- Type: page
- Change: <new, or update to an existing screen>
- Personas: <persona names>
- Entry: <how people get here>
- Covers: <rule ids, or a requirement id for all its rules>
- States:
  - default: <what is on screen normally>
  - empty: <nothing to show yet, and what invites the first action>
  - loading: <what shows while data loads>
  - error: <what shows when loading or saving fails, and how to recover>
  - denied: <what someone without permission sees, or n/a — why>

#### <Interaction name>
- Trigger: <what the user does>
- Result: <what changes on screen and in the data, and what shows if it fails>

## Flows

### <Persona> <does the main thing>
- Persona: <persona name>
- Steps:
  1. <Screen name> → <what they do>
  2. <Screen name> → <what they do>
- Covers: <rule ids>
