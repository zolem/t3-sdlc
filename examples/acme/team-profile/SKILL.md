---
name: team-profile
description: Acme's product context for the t3-sdlc role skills (personas, domain rules, required screen states, where handoffs go). Read it before writing or reviewing a product spec, screen index or design spec for Acme.
---

# Acme team profile

A made-up company, to show what a team profile looks like. Copy `kit/templates/team-profile.md` (saved as `team-profile/SKILL.md`) to write your own; the `create-team-profile` skill interviews you and fills it in.

## Product

Acme is a team workspace for small design agencies. The agency pays per seat; owners manage billing and members, members do the work, and clients are invited as guests to review.

## Personas

| Id | Who | Usually on |
|---|---|---|
| `owner` | Agency owner or ops lead: billing, members, settings | Laptop, Chrome |
| `member` | Designer or account manager doing the work | Laptop; phone for notifications |
| `guest` | Client reviewer, invited per project, sees only that project | Phone first |
| `invitee` | Someone holding an invite who has not joined yet | Phone first |

## Domain rules

- Guests must never see other clients' projects or the member list. Every spec says what a guest can see.
- Anything that adds seats changes the invoice: say whether the owner is warned before it happens.
- Every list that can grow past 50 items says how it pages or searches.

## Required screen states

```
default, empty, loading, error, denied
```

## Devices and accessibility

- Desktop from 1280 px, mobile from 375 px. Guest-facing pages are designed mobile first.
- WCAG 2.2 AA: keyboard reachable, visible focus, 4.5:1 text contrast.

## Vocabulary

| Say | Not | Meaning |
|---|---|---|
| workspace | account, org | one agency's space |
| member | user, seat | a person in the workspace (each one uses a seat) |
| guest | client user | a reviewer invited to one project; free, no seat |

## Where handoffs go

- Files live in: the feature's ticket, then `specs/<feature>/` in the app repo when engineering starts.
- Tracker: Linear.
- Design tool: Figma. Link frames with "Copy link to selection".

## Who to ask

- Product questions: #product
- Design questions: #design
- Engineering questions: #eng-help
