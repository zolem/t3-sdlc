---
kind: spec
feature: invite-teammates
title: Invite teammates to a workspace
version: 2
status: ready
owner: Priya (product)
---

# Invite teammates to a workspace

## Problem

Workspace owners can only add people by asking support, which takes about two days. 38% of trial workspaces never add a second person, and those workspaces convert at a quarter of the rate of workspaces with three or more people.

## Goals and success metrics

- Owners add teammates themselves, without support.
- Success: 60% of new workspaces send at least one invite within 7 days (today: 21% ask support).
- Success: support tickets tagged "add user" drop by 80% within 30 days of full launch.

## Personas

- **Workspace owner** — Created the workspace or was made owner. Manages billing and members. Uses a laptop, mostly Chrome. `id:owner`
- **Workspace member** — Uses the workspace day to day. Can't manage billing. Uses a laptop and a phone. `id:member`
- **Invited person** — Got an invite email; may not have an Acme account yet. Opens the email on a phone about 60% of the time. `id:invitee`

## Requirements

### Owners invite people by email `id:owners-invite`

**Who:** Workspace owner · **Priority:** must

As an owner, I want to add teammates myself, so I don't wait two days for support.

**Rules**

1. Owners can invite 1 to 20 people at once, by email. `id:send-invites`
   - ✅ The owner enters 3 valid addresses and chooses Send invites → each person gets an invite email within 1 minute, and all 3 appear under Pending invites.
   - ⚠️ The owner pastes 21 addresses → the 21st shows "Up to 20 at a time" and isn't added.
2. You can't invite more people than you have free seats. `id:seat-limit`
   - ✅ 2 free seats, the owner enters 2 addresses → Send invites works.
   - ⚠️ 2 free seats, the owner enters 3 addresses → the form says "You have 2 seats left", and Send invites stays off until the list fits.
3. Addresses that can't be invited are flagged before anything is sent. `id:bad-addresses`
   - ❌ "bob@acme" → the chip turns red with "Not a valid email", and Send invites stays off until it's fixed or removed.
   - ⚠️ An address that's already a member or already invited → the chip says "Already a member" or "Already invited" and is skipped; the others are still sent.
4. If an invite email can't be delivered, the owner sees it and can fix it. `id:delivery-fails`
   - ❌ The email provider bounces an invite → its Pending invites row says "Not delivered", with Resend and Edit email.

### Owners manage pending invites `id:manage-pending`

**Who:** Workspace owner · **Priority:** must

As an owner, I want to take back or nudge invites, so the right people end up in the workspace.

**Rules**

1. Revoking an invite stops its link working straight away. `id:revoke`
   - ✅ The owner chooses Revoke and confirms → the row disappears from Pending invites, and the link stops working.
   - ⚠️ The owner chooses Revoke, then Cancel → nothing changes.
2. An invite can be resent once it's 10 minutes old. `id:resend`
   - ✅ An invite sent 2 days ago; the owner chooses Resend → a new email goes out, and the row says "Resent just now".
   - ⚠️ The owner resent it a minute ago → Resend is off for 10 minutes.

### Members ask an owner to invite someone `id:member-requests`

**Who:** Workspace member, Workspace owner · **Priority:** should

As a member, I want to suggest someone to invite, so I don't have to chase an owner in chat.

**Rules**

1. Members can't invite directly, but they can ask the owners. `id:request-invite`
   - ✅ A member enters an address and chooses Ask owner to invite → every owner gets an in-app notification with Approve and Decline, and the member sees "Request sent".
   - ❌ A member enters "sam@" → "Not a valid email", and nothing is sent.
2. The first owner to decide settles the request. `id:first-owner-decides`
   - ✅ Two owners; one approves → the invite is sent.
   - ⚠️ The other owner opens the same request afterwards → it shows who decided, and Approve and Decline are gone.

### Invited people join the workspace `id:join`

**Who:** Invited person · **Priority:** must

As an invited person, I want to join in a couple of taps, so I can start on what my team sent me.

**Rules**

1. People who already have an Acme account join with one tap. `id:join-existing`
   - ✅ Signed in with the invited email, they open the link and choose Join → they land in the workspace as a member, and the owner sees them move from Pending invites to Members.
   - ⚠️ Signed in with a different email → the page says "This invite is for a•••@example.com", with Switch account.
2. People without an account sign up with the invited email. `id:join-new`
   - ✅ Signed out, they open the link → sign-up has the email filled in and locked; after sign-up they land in the workspace.
3. Old or revoked links say what to do next. `id:expired-link`
   - ❌ A link older than 14 days, or revoked → "This invite is no longer valid", with Ask for a new invite, which notifies the owners.

## Permissions

| Action | Workspace owner | Workspace member | Invited person |
|---|---|---|---|
| Send invites | yes | no (can ask an owner) | no |
| Revoke or resend invites | yes | no | no |
| Ask an owner to invite someone | n/a (sends directly) | yes | no |
| See pending invites | yes | yes, read-only | no |
| Accept an invite | n/a | n/a | yes, only for their own email |

## Data and privacy

- Store invite email, inviter, created and expiry time. Delete revoked and expired invites after 30 days.
- The invite page never shows the workspace's member list before the invite is accepted.
- Mask the invite email on the wrong-account page (first character and domain only).

## Analytics

- invite_sent (count, workspace size), invite_accepted (hours since sent), invite_revoked, invite_request_sent, invite_request_decided (approve or decline).

## Rollout

- Behind the flag `invites-v2`, on for internal workspaces first, then 10% of new workspaces for one week, then everyone.

## Out of scope

- Invite links that anyone can use (no email).
- Bulk import from CSV or a directory (SCIM).
- Changing a member's role from the invite.

## Open questions

### How long should an invite stay valid? `id:invite-expiry`
- Owner: Priya
- Answer: 14 days, matching the password reset link.

### Do members' requests need every owner to approve? `id:request-approval`
- Owner: Priya
- Answer: No. The first owner to approve or decline decides; the others see who did.
