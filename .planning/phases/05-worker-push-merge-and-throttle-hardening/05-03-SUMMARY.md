---
phase: 05-worker-push-merge-and-throttle-hardening
plan: 03
subsystem: worker
tags: [push, worker, retries, token-hygiene, parity]
requires:
  - phase: 05-worker-push-merge-and-throttle-hardening
    provides: durable reminder dispatch and worker adapter lifecycle scaffold from 05-01
provides:
  - per-token push delivery contracts with explicit retry parity windows
  - provider wrapper classification for transient and UNREGISTERED failures
  - push handler runtime flow with per-token retries, stale-token cleanup, and terminal failure observability
affects: [phase-05-plan-04, worker-runtime, push-reliability]
tech-stack:
  added: []
  patterns: [per-token retry isolation, non-blocking terminal failures, in-memory retry scheduler]
key-files:
  created:
    - apps/backend/src/jobs/push/contracts.ts
    - apps/backend/src/jobs/push/push-delivery-service.ts
    - apps/backend/src/jobs/push/push-job-handler.ts
    - apps/backend/src/tests/jobs/push-delivery-service.test.ts
    - apps/backend/src/tests/jobs/push-job-handler.test.ts
  modified:
    - apps/backend/src/worker/boss-adapter.ts
key-decisions:
  - 'Push retry policy remains parity-locked at exactly two retries with 30s then 60s delays.'
  - 'Retry scheduling is scoped to individual device tokens so sibling successes are never retried.'
  - 'UNREGISTERED responses trigger immediate user/device-scoped token deletion while terminal failures are recorded without stopping other tokens.'
requirements-completed: [PUSH-01, PUSH-02, JOBS-03]
duration: 18 min
completed: 2026-04-19
---

# Phase 05 Plan 03: Push Per-Token Retry/Backoff Hardening Summary

**Per-token push execution now classifies provider errors, retries transient failures at 30s then 60s, removes UNREGISTERED tokens immediately, and records terminal failures without blocking sibling deliveries.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-19T04:23:00Z
- **Completed:** 2026-04-19T04:41:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added push contracts that define token-scoped payload identity, retry policy helpers, and scheduler/failure-recorder boundaries.
- Implemented push delivery service wrapper that classifies provider outcomes into delivered, transient, unregistered, and terminal categories.
- Implemented push job handler with per-token retry scheduling, stale token cleanup, and terminal-failure continuation semantics.
- Extended worker adapter runtime with registered push retry scheduling hooks and push-health counters.
- Added regression suites for delivery classification, retry window parity, token cleanup, and non-blocking terminal behavior.

## Task Commits

1. **Task 1: Define push job contracts and provider classification boundaries (D-05, D-06, D-07)** - `744602c` (feat)
2. **Task 2: Implement per-token push handler with retries, cleanup, and terminal-failure continuation (D-05, D-06, D-07, D-08)** - `4e8e09a` (feat)
3. **Task 3: Add push reliability regression tests covering retry windows and token hygiene** - `3a3d8c7` (test)

## Files Created/Modified

- `apps/backend/src/jobs/push/contracts.ts` - Push DTOs, retry policy helpers, token identity/key helpers, and scheduler/recorder interfaces.
- `apps/backend/src/jobs/push/push-delivery-service.ts` - Provider wrapper that classifies transient versus unregistered versus terminal failures.
- `apps/backend/src/jobs/push/push-job-handler.ts` - Per-token push execution with retry scheduling, immediate stale-token cleanup, and terminal failure recording.
- `apps/backend/src/worker/boss-adapter.ts` - Runtime registration for push retry scheduling, lifecycle cleanup, and push health diagnostics.
- `apps/backend/src/tests/jobs/push-delivery-service.test.ts` - Classification and retry policy parity regression tests.
- `apps/backend/src/tests/jobs/push-job-handler.test.ts` - Retry/backoff, cleanup, and non-blocking continuation regression tests.

## Decisions Made

- Kept push retry constants and sequence parity-aligned with Convex behavior (`30s`, `60s`, max retries `2`).
- Isolated retry jobs to one token payload so successful siblings remain unaffected by transient failures.
- Recorded terminal push failures as explicit observability events while continuing work for remaining targets.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- Push module contracts and tests are in place for phase-5 runtime and parity/security integration suites.
- Worker adapter exposes push retry metrics and active retry lifecycle hooks for phase 05-04 integration tests.

## Self-Check: PASSED
