---
phase: 01-foundation-and-runtime-baseline
plan: 01
subsystem: api
tags: [express, zod, postgres, readiness, error-contract]
requires:
  - phase: 00-migration-context
    provides: migration requirements and parity constraints
provides:
  - Stable non-2xx error payload contract with optional traceId and safe details policy
  - Schema-first request validation middleware and async route boundary helper
  - Readiness evaluation requiring DB connectivity plus schema_migrations presence
  - Startup fail-fast checks and degraded dependency API gating behavior
affects: [worker-runtime, migration-tooling, api-endpoints, health-monitoring]
tech-stack:
  added: []
  patterns:
    - Schema-first request validation at route boundaries
    - Flat standardized error payload for all known failure categories
    - Dependency degradation isolation (health endpoints stay online, API fails safely)
key-files:
  created:
    - apps/backend/src/middleware/validate.ts
    - apps/backend/src/health/readiness.ts
  modified:
    - apps/backend/src/middleware/error-middleware.ts
    - apps/backend/src/health.ts
    - apps/backend/src/index.ts
    - apps/backend/src/tests/error-middleware.test.ts
    - apps/backend/src/tests/health.test.ts
key-decisions:
  - "Enforced category-aware details sanitization so only client-correctable categories include structured details and internal categories never leak internals."
  - "Converted readiness and startup checks into explicit evaluators so startup can fail fast while runtime degradation is handled without process exit."
patterns-established:
  - "Error contract pattern: all known failures serialize to { code, message, status, details?, traceId? }."
  - "Readiness gate pattern: startup and /health/ready both require DB reachability plus schema_migrations existence."
requirements-completed:
  - BASE-01
  - BASE-03
  - BASE-04
  - BASE-05
duration: 10 min
completed: 2026-04-18
---

# Phase 01 Plan 01: Runtime Safety Contract Summary

**Backend runtime now enforces a deterministic error payload, schema-first validation boundaries, and readiness/startup degradation gates tied to DB plus migration-state truth.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-18T08:19:00+07:00
- **Completed:** 2026-04-18T08:29:27+07:00
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Standardized non-2xx API failures on the flat payload contract, including trace and details rules.
- Added reusable request validation and async route-boundary helpers to keep route handlers schema-first and safe.
- Implemented readiness/startup/degradation runtime behavior so startup fails fast and degraded dependencies fail API traffic without dropping health probes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Lock error and validation boundaries** - `260498b` (feat)
2. **Task 2: Enforce startup and readiness gate semantics** - `83e6945` (feat)

**Plan metadata:** _pending in next docs commit_

## Files Created/Modified

- `apps/backend/src/middleware/validate.ts` - Schema-first request validation and async route-boundary helper.
- `apps/backend/src/middleware/error-middleware.ts` - Error contract sanitization and rate-limit metadata filtering.
- `apps/backend/src/health/readiness.ts` - DB + schema_migrations readiness evaluator.
- `apps/backend/src/health.ts` - Health payload plus dependency degradation gate middleware.
- `apps/backend/src/index.ts` - Startup fail-fast checks and degraded dependency runtime wiring.
- `apps/backend/src/tests/error-middleware.test.ts` - Contract tests for validation/details/trace/rate-limit behavior.
- `apps/backend/src/tests/health.test.ts` - Readiness and degraded dependency runtime behavior tests.

## Decisions Made

- Used readiness evaluation as a single source of truth for both startup checks and `/health/ready`, preventing divergence between boot and runtime semantics.
- Removed hard process-exit behavior from runtime dependency degradation path by overriding pool error listeners in startup bootstrap, enabling health endpoints to remain reachable.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `health.test.ts` initially had a server lifecycle race (`ERR_SERVER_NOT_RUNNING`) and was corrected by waiting for listen completion before issuing requests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Runtime baseline is in place for migration tooling and worker split work.
- Plan `01-03` can proceed independently (same wave), followed by `01-02` after wave 1 completion.

---
*Phase: 01-foundation-and-runtime-baseline*
*Completed: 2026-04-18*
