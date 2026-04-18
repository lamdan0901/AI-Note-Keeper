---
phase: 01-foundation-and-runtime-baseline
plan: 02
subsystem: infra
tags: [runtime-split, worker, pg-boss, express, process-lifecycle]
requires:
  - phase: 01-01
    provides: API runtime safety and health/error baseline
provides:
  - Separate API and worker runtime entrypoints in one backend package
  - Worker adapter contracts and pg-boss bootstrap scaffold
  - Independent and combined local development scripts for API/worker execution
affects: [jobs, cron, queue-processing, deploy-runtime]
tech-stack:
  added: []
  patterns:
    - Runtime split pattern: API bootstrap and worker bootstrap are isolated entrypoints
    - Worker adapter contract pattern: start/stop/health lifecycle abstraction
key-files:
  created:
    - apps/backend/src/runtime/createApiServer.ts
    - apps/backend/src/runtime/startApi.ts
    - apps/backend/src/worker/contracts.ts
    - apps/backend/src/worker/boss-adapter.ts
    - apps/backend/src/worker/index.ts
    - apps/backend/src/tests/worker-bootstrap.test.ts
  modified:
    - apps/backend/src/index.ts
    - apps/backend/package.json
    - package.json
key-decisions:
  - "Kept API and worker in a single backend package for phase 1 while enforcing explicit runtime separation at entrypoint level."
  - "Defined worker adapter contracts now and deferred domain job handlers to later phases to avoid contract churn."
patterns-established:
  - "Worker runtime scaffold pattern: adapter lifecycle + optional signal handlers + explicit shutdown contract."
  - "API runtime module pattern: createApiServer and startApiRuntime split for testability and process isolation."
requirements-completed:
  - BASE-06
duration: 8 min
completed: 2026-04-18
---

# Phase 01 Plan 02: Runtime Process Separation Summary

**Backend runtime now exposes independent API and worker entrypoints with shared infrastructure, plus local scripts for worker-only and API+worker operation.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-18T08:40:00+07:00
- **Completed:** 2026-04-18T08:48:00+07:00
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Introduced worker contracts and pg-boss adapter scaffold with deterministic lifecycle signatures.
- Split API runtime into dedicated create/start modules while preserving the existing API entrypoint behavior.
- Added backend/root script surface for API-only, worker-only, and combined local runtime execution.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define worker contracts before runtime wiring** - `fe4a3be` (feat)
2. **Task 2: Split API and worker entrypoints with shared infra boundaries** - `b2d8ef8` (feat)

**Plan metadata:** _pending in next docs commit_

## Files Created/Modified

- `apps/backend/src/worker/contracts.ts` - Worker lifecycle contracts and bootstrap return model.
- `apps/backend/src/worker/boss-adapter.ts` - pg-boss adapter scaffold with start/stop/health methods.
- `apps/backend/src/worker/index.ts` - Independent worker runtime entrypoint and signal-aware shutdown.
- `apps/backend/src/tests/worker-bootstrap.test.ts` - Worker scaffold and API/worker independence tests.
- `apps/backend/src/runtime/createApiServer.ts` - API app construction module.
- `apps/backend/src/runtime/startApi.ts` - API startup checks and runtime boot module.
- `apps/backend/src/index.ts` - API entrypoint delegating to runtime modules.
- `apps/backend/package.json` - Backend-level API/worker split scripts.
- `package.json` - Root convenience scripts for backend API/worker/all modes.

## Decisions Made

- Kept `startServer` compatibility by aliasing to `startApiRuntime`, avoiding breakage for existing tests and callers.
- Treated worker support as contract-first scaffolding only, intentionally excluding real queue/job execution in this phase.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three phase-1 plans are now implemented and verified.
- Phase 1 can proceed to verification/closure gates.

---
*Phase: 01-foundation-and-runtime-baseline*
*Completed: 2026-04-18*
