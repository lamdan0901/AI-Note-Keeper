---
phase: 03-notes-and-adjacent-domain-api-parity
plan: 02
subsystem: api
tags: [subscriptions, device-tokens, auth, postgres, express]
requires:
  - phase: 03-notes-and-adjacent-domain-api-parity
    provides: authenticated middleware and route conventions
provides:
  - subscription lifecycle parity APIs with reminder field derivation
  - android-only device token upsert/delete parity APIs
  - route-level parity tests for ownership, idempotency, and retention semantics
affects: [phase-03-plan-03, phase-03-plan-04, subscriptions, device-tokens]
tech-stack:
  added: []
  patterns:
    - subscriptions contracts -> repositories -> service -> routes layering
    - user-scoped ownership predicates for all mutations
    - android-only token validation at route boundary
key-files:
  created:
    - apps/backend/src/subscriptions/contracts.ts
    - apps/backend/src/subscriptions/repositories/subscriptions-repository.ts
    - apps/backend/src/subscriptions/service.ts
    - apps/backend/src/subscriptions/routes.ts
    - apps/backend/src/device-tokens/contracts.ts
    - apps/backend/src/device-tokens/repositories/device-tokens-repository.ts
    - apps/backend/src/device-tokens/service.ts
    - apps/backend/src/device-tokens/routes.ts
    - apps/backend/src/tests/subscriptions/routes.test.ts
    - apps/backend/src/tests/device-tokens/routes.test.ts
  modified: []
key-decisions:
  - 'Derived `nextReminderAt` and `nextTrialReminderAt` server-side from billing/trial anchors and reminderDaysBefore.'
  - 'Enforced ownership by `user_id` lookup before subscription and device-token mutations.'
  - 'Limited device token APIs to android payloads and kept notification_ledger excluded from backend persistence/exposure.'
patterns-established:
  - 'Subscription and device-token route modules follow the same auth-first validation/error middleware shape as notes parity APIs.'
  - 'Parity tests use route-level assertions with deterministic doubles for lifecycle and idempotency coverage.'
requirements-completed: [SUBS-01, SUBS-02, DEVC-01, DEVC-02]
duration: 4 min
completed: 2026-04-19
---

# Phase 03 Plan 02: Subscription and Device Token Parity Summary

**Express parity now covers subscription lifecycle operations with stable reminder derivation and Android-only device-token idempotency endpoints.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-19T09:33:40+07:00
- **Completed:** 2026-04-19T09:37:38+07:00
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Implemented subscriptions contracts/repository/service/routes with ownership checks and server-derived reminder fields.
- Implemented Android-only device-token contracts/repository/service/routes with idempotent upsert and safe delete semantics.
- Added route-level parity tests for subscription derivation/retention and device-token idempotency/platform validation plus notification_ledger exclusion assertions.

## Task Commits

1. **Task 1: Implement subscription lifecycle parity APIs and derivation** - `aab2381` (feat)
2. **Task 2: Implement Android-only device-token parity APIs** - `b97ac6f` (feat)
3. **Task 3: Add ownership/idempotency/retention parity assertions** - `b97ac6f` (feat)

## Files Created/Modified

- `apps/backend/src/subscriptions/contracts.ts` - Subscription DTOs and patch contracts.
- `apps/backend/src/subscriptions/repositories/subscriptions-repository.ts` - Ownership-scoped SQL repository for subscription CRUD and trash operations.
- `apps/backend/src/subscriptions/service.ts` - Lifecycle orchestration and reminder/trial reminder derivation with 14-day purge cutoff.
- `apps/backend/src/subscriptions/routes.ts` - Authenticated subscription HTTP endpoints.
- `apps/backend/src/device-tokens/contracts.ts` - Android-only device token DTOs.
- `apps/backend/src/device-tokens/repositories/device-tokens-repository.ts` - Device token lookup/upsert/delete repository methods.
- `apps/backend/src/device-tokens/service.ts` - Ownership checks and android platform guard for token mutations.
- `apps/backend/src/device-tokens/routes.ts` - Authenticated device-token endpoints.
- `apps/backend/src/tests/subscriptions/routes.test.ts` - Derivation, ownership rejection path, and 14-day purge cutoff tests.
- `apps/backend/src/tests/device-tokens/routes.test.ts` - Upsert idempotency, missing-delete no-op, platform validation, and notification_ledger exclusion tests.

## Decisions Made

- Kept reminder field derivation in the service layer so client payloads cannot drift server behavior.
- Preserved strict user scoping in repository mutation predicates to block cross-account changes.
- Used route schema validation to hard-reject non-android platform payloads before service execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Static exclusion test read source path from workspace instead of runtime dist path**

- **Found during:** Task 3 tests
- **Issue:** Node test runner executes compiled files under `dist`, causing ENOENT for source-relative filesystem checks.
- **Fix:** Switched test assertions to `import.meta.url` relative dist JS paths for route and repository module scans.
- **Files modified:** `apps/backend/src/tests/device-tokens/routes.test.ts`
- **Verification:** `npm --workspace apps/backend run test`
- **Committed in:** `b97ac6f`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Localized test-path fix only; no behavior change.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- Plan 03-03 can reuse auth-first route pattern and parity-style tests for AI endpoints.
- Plan 03-04 can mount `/api/subscriptions` and `/api/device-tokens` directly into runtime wiring.

---

_Phase: 03-notes-and-adjacent-domain-api-parity_
_Completed: 2026-04-19_
