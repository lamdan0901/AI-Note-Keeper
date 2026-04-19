---
phase: 03-notes-and-adjacent-domain-api-parity
plan: 01
subsystem: api
tags: [notes, auth, postgres, express, sync]
requires:
  - phase: 02-auth-compatibility-and-session-continuity
    provides: access token verification and shared auth error contracts
provides:
  - authenticated notes route guard
  - notes sync service with strict LWW and payload-hash idempotency
  - notes repository and change-event repository primitives
  - notes route and sync concurrency regression coverage
affects: [phase-03-plan-02, phase-03-plan-04, notes, route-mounting]
tech-stack:
  added: []
  patterns:
    - ownership-scoped SQL predicates for all note mutations
    - deterministic sync queue for concurrent note writes
    - route-level auth-first notes API handling
key-files:
  created:
    - apps/backend/src/auth/access-middleware.ts
    - apps/backend/src/notes/contracts.ts
    - apps/backend/src/notes/repositories/note-change-events-repository.ts
    - apps/backend/src/notes/repositories/notes-repository.ts
    - apps/backend/src/notes/service.ts
    - apps/backend/src/notes/routes.ts
    - apps/backend/src/tests/notes/service.sync.test.ts
    - apps/backend/src/tests/notes/routes.test.ts
  modified:
    - apps/backend/src/notes/repositories/notes-repository.ts
    - apps/backend/src/tests/notes/service.sync.test.ts
key-decisions:
  - "Implemented strict `incoming.updatedAt > existing.updatedAt` in notes service and codified with stale-write tests."
  - "Enforced replay idempotency via `note_change_events` dedupe lookup before mutation application."
  - "Used authenticated route middleware to inject `authUser` and scope all notes operations by user."
patterns-established:
  - "Notes parity modules follow contracts -> repositories -> service -> routes layering with tests at service and route boundaries."
  - "Concurrent sync requests are serialized in-service to keep deterministic outcomes under replay and timestamp races."
requirements-completed: [NOTE-01, NOTE-02, NOTE-03, NOTE-04]
duration: 3 min
completed: 2026-04-19
---

# Phase 03 Plan 01: Notes Parity Domain Summary

**Authenticated notes sync API now supports strict LWW, payload-hash replay idempotency, and trash lifecycle operations with ownership-safe SQL predicates.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-19T09:29:32+07:00
- **Completed:** 2026-04-19T09:32:46+07:00
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Added reusable `requireAccessUser` middleware and typed authenticated request context.
- Implemented notes contracts, repositories, sync service, and notes route handlers for parity endpoints.
- Added route and service tests for replay dedupe, stale-write no-op, canonical null-vs-omitted semantics, and concurrent sync determinism.

## Task Commits

1. **Task 1: Create authenticated route guard and notes repository contracts** - `c660e8d` (feat)
2. **Task 2: Implement notes sync service and full notes route surface** - `d9ecd6b` (feat)
3. **Task 3: Add deterministic concurrency tests for sync conflict safety** - `ac1cb83` (test)

## Files Created/Modified
- `apps/backend/src/auth/access-middleware.ts` - Bearer token middleware that injects authenticated user context.
- `apps/backend/src/notes/contracts.ts` - Notes sync DTOs and canonical recurrence patch helpers.
- `apps/backend/src/notes/repositories/notes-repository.ts` - Ownership-scoped notes data access and trash operations.
- `apps/backend/src/notes/repositories/note-change-events-repository.ts` - Payload-hash dedupe lookup and event append operations.
- `apps/backend/src/notes/service.ts` - Sync/LWW/idempotency/trash lifecycle orchestration.
- `apps/backend/src/notes/routes.ts` - Authenticated notes HTTP endpoints and schema validation.
- `apps/backend/src/tests/notes/service.sync.test.ts` - Middleware, repository, sync semantics, and concurrency tests.
- `apps/backend/src/tests/notes/routes.test.ts` - Route-level replay/stale/lifecycle parity tests.

## Decisions Made
- Enforced strict greater-than timestamp precedence for LWW writes to match parity contract.
- Treated duplicate payload hashes as idempotent no-op at service entry before mutation logic.
- Preserved canonical recurrence semantics: omitted fields preserve existing values; explicit null clears.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Readonly patch typing blocked service patch construction**
- **Found during:** Task 2 (notes service implementation)
- **Issue:** `NotePatchInput` was readonly, causing TypeScript compile failures when building patch payloads incrementally.
- **Fix:** Changed `NotePatchInput` to mutable while preserving immutable repository return types.
- **Files modified:** `apps/backend/src/notes/repositories/notes-repository.ts`
- **Verification:** `npm --workspace apps/backend run test`
- **Committed in:** `d9ecd6b`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was local and required for compilation; no scope expansion.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Shared authenticated notes middleware and route patterns are ready for subscriptions/device-token/AI modules.
- Plan 03-04 can mount `/api/notes` immediately in runtime integration.

---
*Phase: 03-notes-and-adjacent-domain-api-parity*
*Completed: 2026-04-19*
