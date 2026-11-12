---
name: team-profile
description: <Team>'s product context for the t3-sdlc role skills (personas, domain rules, required screen states, where handoffs go). Read it before writing or reviewing a product spec, screen index or design spec for <Team>.
---

# <Team> team profile

The t3-sdlc role skills (`write-product-spec`, `build-screen-index`, `review-design`, `check-handoff`) read this profile and apply it on top of their generic defaults. Edit it when the team's reality changes; everyone who installed it gets the same answers to the same questions.

## Product

<One paragraph: what the product is, who pays for it, who uses it.>

## Personas

Use these persona ids in every spec. Add a new one only when none of these fit, and tell the person who maintains this profile.

| Id | Who | Usually on |
|---|---|---|
| `<short-id>` | <role and what they are trying to do> | <devices, browsers> |

## Domain rules

Questions every spec must answer for this team, on top of the generic ones:

- <e.g. Which data about minors does this touch, and who can see it?>
- <e.g. Does this need to work for district-managed accounts?>

## Required screen states

`required_states` for every screen index (the generic five plus any the team needs):

```
default, empty, loading, error, denied
```

## Devices and accessibility

- <supported devices and screen sizes, minimum accessibility standard>

## Vocabulary

| Say | Not | Meaning |
|---|---|---|
| <term> | <term to avoid> | <definition> |

## Where handoffs go

- Files live in: <e.g. the tracker ticket for the feature, a shared folder, or `specs/<feature>/` in the app repo>
- Tracker: <e.g. Linear, Jira, GitHub Issues>
- Design tool: <e.g. Figma; how to link a frame>

## Who to ask

- Product questions: <name or channel>
- Design questions: <name or channel>
- Engineering questions: <name or channel>
