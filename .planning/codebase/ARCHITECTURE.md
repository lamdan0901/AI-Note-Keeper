# Architecture

**Analysis Date:** 2026-04-17

## Pattern Overview

**Overall:** Multi-surface product with Convex-centric backend and an in-progress Express/PostgreSQL migration track.

**Key Characteristics:**

- Shared domain utilities in `packages/shared` consumed by Convex and clients.
- Client-heavy sync orchestration (web + mobile) with backend event propagation.
- Dual-backend transition state: Convex currently active, Express scaffold growing in `apps/backend`.
- Background reminder workflows rely on scheduled jobs and push fan-out.

## Layers

**Client UI Layer (Web + Mobile):**

- Purpose: Render notes/reminders/subscriptions UX and manage user interactions.
- Contains: React components/screens/pages in `apps/web/src/*` and `apps/mobile/src/*`.
- Depends on: Convex APIs, local mobile DB/sync modules, shared utility semantics.
- Used by: End users via browser and mobile app.

**Client Sync/Session Layer:**

- Purpose: Device identity, auth session transitions, local/offline state, sync triggers.
- Contains: `apps/mobile/src/sync/*`, `apps/mobile/src/auth/*`, `apps/web/src/services/*`.
- Depends on: Convex functions, local SQLite/secure storage, push/deep-link handlers.
- Used by: UI layer and app bootstrap routines.

**Backend Domain Layer (Current):**

- Purpose: Authoritative mutation/query/action logic.
- Contains: Convex functions in `convex/functions/*` and schema in `convex/schema.ts`.
- Depends on: Convex runtime, shared utilities (`packages/shared/utils/*`).
- Used by: Web/mobile clients and cron/scheduler jobs.

**Backend Migration Layer (Target):**

- Purpose: Future REST + PostgreSQL architecture with explicit middleware and migration tooling.
- Contains: `apps/backend/src/index.ts`, `apps/backend/src/migrate.ts`, db/error/config modules.
- Depends on: Express, pg pool, SQL migrations.
- Used by: Planned client cutover flow documented in migration roadmap.

## Data Flow

**Notes/Reminder Sync Flow (Current Convex):**

1. Web/mobile clients build sync mutations (`apps/web/src/services/notes.ts`, `apps/mobile/src/sync/noteSync.ts`).
2. Convex `syncNotes`/reminder mutations apply LWW behavior and write change events (`convex/functions/notes.ts`, `convex/functions/reminders.ts`).
3. Push action fans out change notifications (`convex/functions/push.ts`).
4. Clients reconcile remote updates and local caches/offline state.

**Reminder Trigger Flow:**

1. Cron executes `check-reminders` every minute (`convex/crons.ts`).
2. Trigger action scans due window with watermark and `MAX_LOOKBACK_MS` guard (`convex/functions/reminderTriggers.ts`).
3. Push notifications are sent to devices.
4. Reminder state is patched (`lastFiredAt`, `nextTriggerAt`, `scheduleStatus`) to prevent duplicate firing.

**Migration Backend Flow (Express):**

1. Process starts with env validation in `apps/backend/src/config.ts`.
2. Express middleware stack handles JSON/CORS and routes in `apps/backend/src/index.ts`.
3. Errors normalize through catalog-based middleware (`apps/backend/src/middleware/error-middleware.ts`).
4. SQL schema evolution occurs through migration runner and SQL files in `apps/backend/src/db/migrations`.

**State Management:**

- Server state currently centralized in Convex.
- Mobile additionally maintains local persistence for offline and notification workflows.
- Migration target introduces PostgreSQL as server-side source of truth.

## Key Abstractions

**Domain-typed recurrence and scheduling:**

- Purpose: Keep reminder recurrence deterministic across runtimes.
- Examples: `packages/shared/utils/recurrence.ts`, `packages/shared/types/reminder`.
- Pattern: Shared pure utility reused by Convex logic and tests.

**Change-event dedupe and conflict resilience:**

- Purpose: Support idempotent sync and event propagation.
- Examples: `noteChangeEvents` table/schema in Convex and SQL migration files.
- Pattern: Payload-hash/change-event tracking plus timestamp/version checks.

**Auth transition abstraction:**

- Purpose: Support local anonymous mode, login/register, merge decisions, and session restoration.
- Examples: `apps/mobile/src/auth/AuthContext.tsx`, `apps/web/src/auth/*`, Convex `auth.ts`.
- Pattern: Context-based state machine with explicit transition states.

## Entry Points

**Web app entry:**

- Location: `apps/web/src/main.tsx` and `apps/web/src/App.tsx`.
- Triggers: Browser navigation.
- Responsibilities: UI composition, theme/auth/session interactions, service hooks.

**Mobile app entry:**

- Location: `apps/mobile/App.tsx`.
- Triggers: App launch, deep links, push callbacks.
- Responsibilities: bootstrap migrations/notifications, auth bootstrap, screen routing.

**Convex backend entry:**

- Location: `convex/schema.ts`, `convex/functions/*`, `convex/crons.ts`.
- Triggers: client queries/mutations/actions and cron scheduler.
- Responsibilities: persistence, business logic, push/AI side effects.

**Express backend entry (migration):**

- Location: `apps/backend/src/index.ts` and `apps/backend/src/migrate.ts`.
- Triggers: HTTP requests or migration command.
- Responsibilities: health/error contracts, DB migration lifecycle.

## Error Handling

**Strategy:**

- Convex paths mostly throw domain errors directly.
- Express path standardizes errors through `AppError` and catalog mapping.

**Patterns:**

- Fail-fast env validation at startup (`process.exit(1)` on invalid env).
- Background actions log and continue where possible (push/cron loops).
- Error payload standardization implemented on Express side.

## Cross-Cutting Concerns

**Logging:**

- Console logging is the default across Convex actions, mobile bootstrap, and backend startup/migration.

**Validation:**

- Convex `v` validators at function boundaries.
- Zod schema validation in Express config path.

**Authentication:**

- Current identity/session checks in Convex auth functions and client auth contexts.
- Migration plan indicates JWT + refresh rotation target architecture.

---

_Architecture analysis: 2026-04-17_
_Update when Convex-to-Express cutover changes request/data flow_
