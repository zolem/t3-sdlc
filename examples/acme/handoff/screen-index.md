---
kind: screen-index
feature: invite-teammates
version: 1
status: ready
spec_version: 2
required_states: default, empty, loading, error, denied
---

# Screen index: Invite teammates to a workspace

Every screen, state and interaction the design has to cover, built from the product spec. Designers: draw each state listed here, or tell product why it does not apply.

## Screens

### Members page `id:members-page`
- Type: page
- Change: update to the existing Members page
- Personas: owner, member
- Entry: Settings → Members; the "Invite people" button on the home empty state
- Covers: owners-invite, manage-pending, member-requests
- States:
  - default: member list, Pending invites section, Invite people button (owners) or Ask owner to invite (members)
  - empty: only the owner is listed; a prompt explains why to invite people, with Invite people
  - loading: skeleton rows for members and pending invites
  - error: the list failed to load; banner with Retry, the Invite button still works
  - denied: n/a — every workspace member can open this page; members just get fewer actions

#### Revoke an invite
- Trigger: owner chooses Revoke on a pending row
- Result: confirm dialog (Revoke confirmation); on confirm the row disappears and a toast says "Invite revoked"

#### Resend an invite
- Trigger: owner chooses Resend on a pending row older than 10 minutes
- Result: the row shows "Resent just now"; Resend is off for 10 minutes. If delivery fails, the row shows "Not delivered" with Resend and Edit email

### Invite people dialog `id:invite-dialog`
- Type: modal
- Change: new
- Personas: owner
- Entry: Invite people on the Members page
- Covers: send-invites, seat-limit, bad-addresses
- States:
  - default: email entry that turns each address into a chip, seats left counter, Send invites
  - empty: no addresses yet; Send invites is off; hint "Paste or type emails"
  - loading: Send invites shows a spinner and the dialog can't be closed until it finishes
  - error: sending failed for everyone; inline message with Try again, the chips are kept
  - denied: n/a — only owners can open it (members see Ask owner to invite instead)

#### Add addresses
- Trigger: typing or pasting addresses separated by commas, spaces or new lines
- Result: each address becomes a chip; invalid ones turn red; existing members or invites are marked and skipped; the 21st shows "Up to 20 at a time"

#### Send invites
- Trigger: Send invites with 1 to 20 valid chips that fit the free seats
- Result: dialog closes, toast "3 invites sent", rows appear in Pending invites on the Members page

### Revoke confirmation `id:revoke-confirm`
- Type: modal
- Change: new
- Personas: owner
- Entry: Revoke on a pending invite
- Covers: revoke
- States:
  - default: "Revoke the invite for name@example.com? The link will stop working." Revoke / Cancel
  - empty: n/a — always opened for exactly one invite
  - loading: Revoke shows a spinner
  - error: "Couldn't revoke. Try again." inside the dialog
  - denied: n/a — only reachable by owners

### Request invite dialog `id:request-dialog`
- Type: modal
- Change: new
- Personas: member
- Entry: Ask owner to invite on the Members page
- Covers: request-invite
- States:
  - default: one email field, optional note to the owner, Send request
  - empty: Send request is off until an email is entered
  - loading: Send request shows a spinner
  - error: "Couldn't send the request. Try again."
  - denied: n/a — every member can ask

### Invite request notification `id:request-notification`
- Type: notification
- Change: new
- Personas: owner
- Entry: the in-app notification bell
- Covers: first-owner-decides
- States:
  - default: "Sam asked to invite ana@example.com" with Approve and Decline; once decided, "Approved by Priya" and no buttons

### Invite email `id:invite-email`
- Type: email
- Change: new
- Personas: invitee
- Entry: the invitee's inbox
- Covers: send-invites, resend
- States:
  - default: who invited them, the workspace name, Join workspace button, expiry date

### Invite landing page `id:invite-landing`
- Type: page
- Change: new
- Personas: invitee
- Entry: Join workspace in the invite email
- Covers: join
- States:
  - default: workspace name and inviter, Join (signed in) or Create account (signed out)
  - empty: n/a — the page always has an invite to show, or shows the expired-link error
  - loading: centered spinner while the invite is checked
  - error: "This invite is no longer valid" with Ask for a new invite
  - denied: "This invite is for a•••@example.com" with Switch account

#### Join or sign up
- Trigger: Join (signed in with the invited email) or Create account
- Result: joins the workspace and lands on its home; sign-up has the email filled in and locked

## Flows

### Owner invites three people `id:owner-invites`
- Persona: owner
- Steps:
  1. Members page → Invite people
  2. Invite people dialog → add three addresses; one already a member is skipped
  3. Send invites → toast; rows appear on the Members page
- Covers: send-invites, seat-limit, bad-addresses

### Owner revokes and resends `id:owner-revokes-resends`
- Persona: owner
- Steps:
  1. Members page → Revoke on a pending row
  2. Revoke confirmation → Revoke
  3. Members page → Resend on another row; a bounced one shows "Not delivered"
- Covers: revoke, resend, delivery-fails

### Member asks an owner `id:member-asks`
- Persona: member
- Steps:
  1. Members page → Ask owner to invite
  2. Request invite dialog → Send request
  3. Invite request notification → the owner approves
- Covers: request-invite, first-owner-decides

### Invitee joins `id:invitee-joins`
- Persona: invitee
- Steps:
  1. Invite email → Join workspace
  2. Invite landing page → Join or Create account
- Covers: join
