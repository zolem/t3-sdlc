---
version: 1
mode: append
---

## SchoolAI conventions

`apps/web` is the core project. Default to it and opt into other surfaces only when the requirements signal them:

- **AI Platform**: agents, blueprints, workflows, runs, conversations, the AI Platform server, openapi types, `api-types.ts`, `ai-platform/` paths.
- **Browser extension**: Chrome/Edge extension, content scripts, Google Docs integration, `apps/browser-extension`.
- **Shared packages**: design system / `@sai/ui`, logger, analytics, billing, or other `packages/*` work that is more than a thin re-export.
- **Default (apps/web)**: UI, tRPC procedures, auth, Spaces, PowerUps, rostering, LTI, billing UI, webapp Prisma schema changes.

A feature may touch several surfaces; record all that apply. Always read root `CLAUDE.md` and `docs/architecture.md`. List `docs/`, `docs/patterns/`, `apps/web/docs/` (and `ai-platform/docs/` only if AI Platform is in scope). Scan READMEs and CLAUDE.md files under `apps/web/src/server/services/`, `apps/web/src/components/` and `packages/*` whose names match the domain.

With Notion tools available, always fetch the Application Architecture Guide (https://app.notion.com/p/33a98e7502bb809eb693d1b3a86cf01c): the apps/web source of truth for naming, App Router direction, layering (UI → Server Action → Service → Prisma), tools and libraries. Then by topic:

- AI Platform touched: API Design (https://app.notion.com/p/20198e7502bb806ba3bdce3113c0700b).
- App Router work: App Router migration plan (https://app.notion.com/p/28e98e7502bb8041b364f21011c36cf3).
- Auth work: Web App Authentication and Authorization Pipeline (https://app.notion.com/p/32198e7502bb80509ccfe8fcfd08b0e5).
- Prisma migrations: Improving Prisma Migration Strategy in Production (https://app.notion.com/p/2c798e7502bb80a8b645e0741003bb6b) and the Failed Migration outage postmortem (https://app.notion.com/p/31b98e7502bb80cbba5bf6062c8b1e43).
- tRPC API work: tRPC (https://app.notion.com/p/21098e7502bb80f09e6cf8dd214c3a07) and RFC 8: Versioned APIs via tRPC (https://app.notion.com/p/26898e7502bb802d8af0fd6ec993b836).

Filter topical search hits to the surfaces in scope; drop AI Platform, data-team or marketing pages unless directly relevant.
