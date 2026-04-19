# Phase 07 Research: Web and Mobile Cutover to Express APIs

Date: 2026-04-19
Phase: 07-web-and-mobile-cutover-to-express-apis
Requirements: WEB-01, WEB-02, MOBL-01, MOBL-02, CUTV-01

## Inputs Reviewed

- .planning/ROADMAP.md
- .planning/REQUIREMENTS.md
- .planning/STATE.md
- .planning/PROJECT.md
- .planning/codebase/ARCHITECTURE.md
- .planning/codebase/CONVENTIONS.md
- .planning/codebase/STRUCTURE.md
- .planning/codebase/TESTING.md
- .planning/phases/02-auth-compatibility-and-session-continuity/02-03-SUMMARY.md
- .planning/phases/03-notes-and-adjacent-domain-api-parity/03-04-SUMMARY.md
- .planning/phases/05-worker-push-merge-and-throttle-hardening/05-04-SUMMARY.md
- .planning/phases/06-data-migration-execution-and-reconciliation/06-03-SUMMARY.md
- apps/web/src/main.tsx
- apps/web/src/auth/*
- apps/web/src/services/*
- apps/web/src/pages/NotesPage.tsx
- apps/mobile/App.tsx
- apps/mobile/src/auth/*
- apps/mobile/src/sync/*
- apps/mobile/src/subscriptions/service.ts
- apps/mobile/src/voice/aiIntentClient.ts
- apps/backend/src/runtime/createApiServer.ts
- apps/backend/src/auth/routes.ts
- apps/backend/src/notes/routes.ts
- apps/backend/src/reminders/routes.ts
- apps/backend/src/subscriptions/routes.ts
- apps/backend/src/device-tokens/routes.ts
- apps/backend/src/ai/routes.ts

## Current Baseline

- Web and mobile still use Convex as the primary domain transport for notes, reminders, subscriptions, sync, and AI capture.
- Phase 2 already introduced optional auth HTTP clients and legacy upgrade-session bootstrap paths for both clients.
- Backend route surface for auth, notes, reminders, subscriptions, device tokens, merge, and AI is mounted under /api and protected by access middleware.
- Mobile offline outbox, LWW conflict reconciliation, and secure-store auth lifecycle are in place and must be preserved through transport cutover.

## Key Cutover Constraints

1. Polling parity is mandatory before full web cutover: focus-triggered sync + 30 second notes polling.
2. Mobile must keep offline outbox and LWW semantics while changing transport from Convex to Express.
3. Legacy userId-only sessions must continue silent bootstrap upgrade using /api/auth/upgrade-session.
4. Rollout must be cohort-gated and rollback-ready with explicit parity and SLO checks.

## Recommended Plan Split

- Plan 07-01: Web auth transport hardening and Express API client contracts.
- Plan 07-02: Web domain transport cutover (notes/reminders/subscriptions) and polling gate enforcement.
- Plan 07-03: Mobile auth/token transport and silent legacy session continuity hardening.
- Plan 07-04: Mobile sync/subscription/device-token/AI transport cutover with offline parity regression.
- Plan 07-05: Cohort rollout gates, cutover runbook, rollback drill evidence, and readiness checks.

This split keeps wave-1 work parallel by client surface, then converges on rollout safety.

## Verification Strategy

- Web: npm --workspace apps/web run test
- Mobile/unit+integration subset via root jest path filtering:
  - npx jest apps/mobile/tests/unit/auth.sessionLifecycle.test.ts
  - npx jest apps/mobile/tests/integration/offlineCreateSync.test.ts apps/mobile/tests/integration/offlineDeleteSync.test.ts
- Backend contract alignment smoke checks where needed:
  - npm --workspace apps/backend run build
- Global static gate:
  - npm run lint

## Recommendation

Proceed with execute plans using the existing stack and code patterns. No new external dependency is required for phase 7.
