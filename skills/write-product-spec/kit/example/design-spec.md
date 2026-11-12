---
kind: design-spec
feature: invite-teammates
version: 1
status: ready
index_version: 1
design_file: https://www.figma.com/design/EXAMPLE/acme-invites
---

# Design spec: Invite teammates to a workspace

## Screens

### Members page `id:members-page`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=10-1
  - empty: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=10-2
  - loading: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=10-3
  - error: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=10-4
- Copy: Pending invites rows read "Invited by Priya · 2 days ago". Not delivered rows read "Not delivered · Resend · Edit email".
- Notes: on narrow screens the Pending invites actions collapse into a ⋯ menu.

### Invite people dialog `id:invite-dialog`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=20-1
  - empty: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=20-2
  - loading: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=20-3
  - error: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=20-4
- Copy: seats counter "2 seats left"; over the limit "You have 2 seats left. Remove 1 address or add seats."
- Notes: paste of up to 200 characters per address; chips wrap; the 21st chip shows "Up to 20 at a time".

### Revoke confirmation `id:revoke-confirm`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=30-1
  - loading: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=30-2
  - error: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=30-3

### Request invite dialog `id:request-dialog`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=40-1
  - empty: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=40-2
  - loading: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=40-3
  - error: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=40-4

### Invite request notification `id:request-notification`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=50-1

### Invite email `id:invite-email`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=60-1
- Copy: subject "Priya invited you to Acme Design on Acme".

### Invite landing page `id:invite-landing`
- Frames:
  - default: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=70-1
  - loading: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=70-2
  - error: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=70-3
  - denied: https://www.figma.com/design/EXAMPLE/acme-invites?node-id=70-4
- Notes: designed mobile first (375 px); desktop centers the same card.

## Acceptance cases

What someone (or an AI) does to prove each rule, as each persona. These stay the same whatever architecture builds the feature.

### Owner sends invites `id:owner-sends-invites`
- Persona: owner
- Covers: send-invites
- Steps:
  1. Open Settings → Members and choose Invite people
  2. Enter two new addresses and choose Send invites
- Expect: toast "2 invites sent"; both rows in Pending invites; both inboxes get the email within 1 minute

### Owner hits the seat limit `id:owner-seat-limit`
- Persona: owner
- Covers: seat-limit
- Steps:
  1. In a workspace with 2 free seats, open Invite people
  2. Enter three addresses
- Expect: "You have 2 seats left" and Send invites disabled until one chip is removed

### Owner revokes an invite `id:owner-revokes`
- Persona: owner
- Covers: revoke, expired-link
- Steps:
  1. Choose Revoke on a pending invite and confirm
  2. Open the revoked invite's link
- Expect: the row is gone; the link shows "This invite is no longer valid"

### Owner resends an invite `id:owner-resends`
- Persona: owner
- Covers: resend
- Steps:
  1. Choose Resend on an invite older than 10 minutes
- Expect: the row shows "Resent just now" and a second email arrives

### Member asks an owner to invite someone `id:member-asks-owner`
- Persona: member
- Covers: request-invite
- Steps:
  1. As a member, open Members and choose Ask owner to invite
  2. Enter an address and send
- Expect: the member sees "Request sent"; each owner gets a notification with Approve and Decline

### Invitee with an account joins `id:invitee-existing-joins`
- Persona: invitee
- Covers: join-existing
- Steps:
  1. Signed in with the invited email, open the invite link
  2. Choose Join
- Expect: lands on the workspace home as a member; the owner sees them under Members

### Invitee without an account joins `id:invitee-new-joins`
- Persona: invitee
- Covers: join-new
- Steps:
  1. Signed out, open the invite link and choose Create account
  2. Finish sign-up
- Expect: the email is prefilled and locked; after sign-up they land on the workspace home

### Owner enters bad and duplicate addresses `id:owner-bad-addresses`
- Persona: owner
- Covers: bad-addresses
- Steps:
  1. Open Invite people and enter "bob@acme", an existing member's address and one new address
  2. Fix "bob@acme" to "bob@acme.co" and choose Send invites
- Expect: "bob@acme" is red with "Not a valid email" and Send invites is off until it's fixed; the member's chip says "Already a member" and is skipped; two invites are sent

### Owner sees an undelivered invite `id:owner-undelivered`
- Persona: owner
- Covers: delivery-fails
- Steps:
  1. Invite an address the test mail server bounces
  2. Open Members and look at Pending invites
- Expect: the row says "Not delivered" with Resend and Edit email

### Second owner opens a decided request `id:second-owner-decided`
- Persona: owner
- Covers: first-owner-decides
- Steps:
  1. As one owner, approve a member's request from the notification
  2. As another owner, open the same notification
- Expect: it shows "Approved by" the first owner, with no Approve or Decline buttons
