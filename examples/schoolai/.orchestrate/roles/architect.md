---
version: 1
mode: append
---

## SchoolAI conventions

Default stack: Next.js + tRPC + Prisma in `apps/web`; Fastify AI Platform; browser extension. Confirm the plan avoids these, or justify under risks:

- Business logic in Server Actions or route handlers (it belongs in `services/`).
- `useEffect + fetch` for initial data (use Server Components).
- `as` assertions on untrusted input (use zod).
- New code in the `pages/` router (use App Router).
- `renderFoo()` functions instead of inner components.
- Field-mask updates in AI Platform APIs (use the null/undefined convention).
- Skipping the `api-types.ts → openapi → test → impl` flow for AI Platform changes.
- Typed SQL without a performance or capability reason.

Test frameworks: Vitest for unit tests, the Vitest db/integration configs for DB-touching tests, Playwright for E2E, `pnpm test` from `ai-platform/apps/server`.
