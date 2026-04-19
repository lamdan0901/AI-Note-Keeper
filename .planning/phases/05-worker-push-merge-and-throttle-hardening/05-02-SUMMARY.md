---
phase: 05-worker-push-merge-and-throttle-hardening
plan: 02
subsystem: api
tags: [merge, throttle, express, postgres, parity]
requires:
  - phase: 04-reminder-domain-parity
    provides: parity-first service and route contract patterns reused for merge hardening
provides:
  - merge preflight/apply backend module with transactional lock-safe behavior
  - parity strategy/throttle contracts for merge route surface
  - merge service and route regression tests for D-09 through D-16
affects: [phase-05-plan-03, merge-security, backend-api]
tech-stack:
  added: []
  patterns: [transaction callback repository, row-lock merge gating, parity envelope tests]
key-files:
  created:
    - apps/backend/src/merge/contracts.ts
    - apps/backend/src/merge/repositories/merge-repository.ts
    - apps/backend/src/merge/service.ts
    - apps/backend/src/merge/routes.ts
    - apps/backend/src/tests/merge/service.test.ts
    - apps/backend/src/tests/merge/routes.test.ts
  modified:
    - apps/backend/src/runtime/createApiServer.ts
key-decisions:
  - "Merge apply executes in one repository transaction guarded by migration_attempts and target-user row locks."
  - "both strategy resolution is canonicalized through resolveMergeResolution semantics before selecting cloud/local/prompt behavior."
  - "Route layer remaps rate_limit errors to retryAfterSeconds/resetAt-safe metadata only."
patterns-established:
  - "Merge service owns parity summary/throttle semantics; routes stay thin and auth-scoped."
  - "Rate-limit envelopes are asserted end-to-end via route tests, not only unit tests."
requirements-completed: [MERG-01, MERG-02, MERG-03, THRT-01]
duration: 10 min
completed: 2026-04-19
---

# Phase 05 Plan 02: Merge Preflight/Apply and Throttle Hardening Summary

**Lock-safe merge preflight/apply endpoints with parity summary fields, canonical both-strategy resolution, and stable rate_limit retry metadata.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-19T04:12:00Z
- **Completed:** 2026-04-19T04:21:54Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Implemented merge contracts and repository primitives with transaction callbacks and explicit row-lock operations.
- Delivered transactional merge service behavior covering parity summary fields, credential gating, throttle backoff, and strategy semantics.
- Added and wired merge HTTP routes with stable validation/error envelope behavior plus dedicated route/service regression tests.

## Task Commits

1. **Task 1: Define merge contracts and lock-capable repository interfaces (D-09, D-10, D-15)** - `2e9cbd5` (feat)
2. **Task 2: Implement transactional merge service with throttle parity and shared resolution semantics (D-11, D-12, D-13, D-14, D-15)** - `b9da474` (feat)
3. **Task 3: Add merge HTTP routes and error-envelope parity tests (D-09, D-10, D-16)** - `50d8256` (feat)

## Files Created/Modified

- `apps/backend/src/merge/contracts.ts` - Merge DTO contracts and zod schemas preserving `cloud|local|both` strategy semantics.
- `apps/backend/src/merge/repositories/merge-repository.ts` - Transaction/row-lock repository abstraction and SQL operations for snapshot reads plus apply mutations.
- `apps/backend/src/merge/service.ts` - Merge preflight/apply domain logic including canonical resolution, throttle windows, and lock-safe auth checks.
- `apps/backend/src/merge/routes.ts` - Authenticated preflight/apply endpoints with validation and stable rate-limit error remap behavior.
- `apps/backend/src/tests/merge/service.test.ts` - Service regression tests for summary parity, transaction boundaries, throttle constants, and lock invocation.
- `apps/backend/src/tests/merge/routes.test.ts` - Route-level parity tests for summary payload shape, strategy validation, and rate_limit details.
- `apps/backend/src/runtime/createApiServer.ts` - Registered `/api/merge` router in API composition.

## Decisions Made

- Reused shared merge resolution semantics via a safe loader fallback so runtime does not depend on unbuilt shared JS artifacts.
- Kept throttle key as `toUserId` with unchanged constants (3 attempts, 60s base, 15m max) and surfaced retry metadata only.
- Enforced auth-derived source identity at routes (`fromUserId` from access token), preventing request-body impersonation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Shared runtime module availability for merge resolution constants**
- **Found during:** Task 3 verification
- **Issue:** `apps/backend/dist/merge/service.js` failed at runtime because shared package JS files (`packages/shared/.../*.js`) were not present in the repository.
- **Fix:** Added safe shared-loader fallback in merge service: attempts to load shared `resolveMergeResolution` and welcome constants, then falls back to parity-equivalent local behavior when modules are unavailable.
- **Files modified:** `apps/backend/src/merge/service.ts`
- **Verification:** `npm --workspace apps/backend run build`; `node --test "apps/backend/dist/tests/merge/service.test.js"`; `node --test "apps/backend/dist/tests/merge/routes.test.js"`
- **Committed in:** `50d8256` (part of Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Deviation was necessary to keep parity semantics while making backend runtime/test execution reliable in this workspace.

## Issues Encountered

- Initial shared module import approach caused dist-time module resolution failures; resolved by robust fallback loader without changing API behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Merge preflight/apply surface is available and parity-hardened for downstream integration.
- Route/service tests now provide a baseline for future phase 05 merge and security refinements.

---
*Phase: 05-worker-push-merge-and-throttle-hardening*
*Completed: 2026-04-19*

## Self-Check: PASSED

