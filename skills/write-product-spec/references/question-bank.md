# Question bank

Use these to find gaps, not as a script: ask only what the spec does not already answer, a few at a time, each with a proposed answer.

## Problem and goals

- Who exactly has this problem, and how do they work around it today?
- What does the workaround cost (time, money, support tickets, churn)? Do we have a number?
- How will we know it worked, and by when? What is the number today?
- What happens if we do nothing for another quarter?

## Personas

- Who performs each action? Who is affected but does nothing?
- Who must *not* see or do this? (guests, students, read-only roles, other tenants)
- Does any persona use this mostly on a phone, a shared device, or with assistive technology?

## Requirements, rules and examples

- What is the smallest version that solves the problem? What can wait for v2?
- What must always be true? Each answer is a rule, in one plain sentence.
- For each rule: what's a concrete example? The situation, what the person does, and what they see or can measure afterwards, with real numbers.
- Are there limits? (how many, how long, how big, how often)
- What does the user see immediately after the action succeeds? Is anyone notified?
- Does anything happen later (expiry, reminders, scheduled jobs)?

## Permissions

- For each action, persona by persona: allowed, not allowed, or allowed with a condition?
- What does someone without permission see: a hidden control, a disabled one with a reason, or an error?
- Can permissions change while someone is mid-flow (removed from a team, role downgraded)?

## Edge cases and errors

Walk these for every rule. Each real answer becomes a ⚠️ or ❌ example under that rule: the situation → what the person sees and can do next.

- **Empty:** nothing exists yet. What does the first-time user see?
- **Too many:** past the limit, a long list, very long text, huge files.
- **Invalid:** bad formats, missing required input, unsupported characters, wrong file types.
- **Duplicate:** already exists, double-click submit, the same action from two tabs.
- **Conflict:** two people edit the same thing; it was deleted while someone was viewing it.
- **No permission:** see Permissions; also links shared with someone who cannot open them.
- **Failure:** the network drops, a third-party service is down, a payment fails, an email bounces.
- **Undo:** can the action be reversed? For how long? What does deleting cascade to?
- **Time:** expiry, time zones, scheduled actions, daylight saving.
- **State changes:** what happens to in-flight items when the feature flag turns off, or the plan is downgraded?

## Data and privacy

- What new data is stored? For how long? Who can see it?
- Is any of it about minors, health, payments or other sensitive categories? What rules apply?
- Does it leave the system (emails, exports, third parties)?
- What happens to it when someone is removed or the account is deleted?

## Analytics

- Which events answer the success metric? What properties do they need?
- Is there an existing event we should reuse instead?

## Rollout

- Behind a flag? Who gets it first, and what has to be true to widen it?
- Does existing data need migrating or backfilling?
- Does support, sales or documentation need to know before launch?

## Out of scope

- What did someone ask for that we are deliberately not doing now? Write it down so nobody builds it by accident.
