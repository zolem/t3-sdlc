---
version: 1
mode: append
---

## Acme conventions

Stack: a TypeScript web app (`apps/web`) with an API layer and a Postgres database behind an ORM. Confirm the plan avoids these, or justify each under risks:

- Business logic in route handlers or UI components (it belongs in `services/`).
- Fetching initial page data on the client when the server can render it.
- Type assertions on untrusted input (validate with a schema instead).
- Destructive migrations in the same release as the code that stops using a column.
