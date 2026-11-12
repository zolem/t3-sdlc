# Screen checklist

What each state and interaction should answer. Use it to find what the spec forgot, then write the answer into the screen's states or interactions.

## States

- **default:** the normal case with realistic data, not the ideal case. What does it look like with 1 item? With 200? With a 90-character name?
- **empty:** nothing exists yet. What explains why, and what invites the first action? Is "no results for this filter" different from "nothing yet"?
- **loading:** the first load, and refreshing while data is already shown. Does the layout jump when data arrives? What does a slow connection (5+ seconds) look like?
- **error:** loading failed, or saving failed. What is kept (typed input), what can the user do (retry, edit, contact), and what does the message say in plain words?
- **denied:** someone without permission arrives here (a shared link, a removed member, a downgraded role). Hidden, disabled with a reason, or an explanation page?
- **partial** (when it applies): some items failed and some worked, some data is missing, or the list is truncated.
- **offline** (when the product supports it): what still works, what is queued, how it reconciles.

## Interactions

- **Feedback:** what confirms success (toast, inline change, a new row)? How long does it stay?
- **In progress:** what shows while it runs? Can the user leave? Is double-submit prevented?
- **Destructive:** is there a confirmation? Undo? What else is deleted with it?
- **Validation:** when does it run (typing, leaving the field, submitting)? Where does the message appear?
- **Limits:** what happens at the maximum (characters, items, file size, seats)?
- **Concurrency:** what if someone else changed or deleted it meanwhile?
- **Notifications:** who else learns about it, and where (email, in-app, push)?

## Across screens

- **Entry points:** every way someone arrives (nav, deep link, email, notification, search, back button).
- **Narrow screens:** the smallest supported width, and touch targets.
- **Keyboard and focus:** tab order, where focus goes when a dialog opens and closes, Escape and Enter.
- **Text:** long names, long translations, numbers with many digits, right-to-left if supported.
- **Accessibility:** contrast, labels for icon-only buttons, announcements for toasts and inline errors.
