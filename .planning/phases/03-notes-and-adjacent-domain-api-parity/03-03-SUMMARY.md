---
phase: 03-notes-and-adjacent-domain-api-parity
plan: 03
subsystem: api
tags: [ai, voice, fallback, rate-limit, auth]
requires:
  - phase: 03-notes-and-adjacent-domain-api-parity
    provides: auth middleware and route validation patterns
provides:
  - parse-voice and clarify AI parity contracts/services with deterministic fallback
  - provider adapter integration that never leaks provider failures to clients
  - authenticated AI endpoints with endpoint-level per-user rate limits
affects: [phase-03-plan-04, ai, route-mounting]
tech-stack:
  added: []
  patterns:
    - deterministic transcript parsing fallback for title/reminder/repeat
    - provider output normalization and confidence clamping
    - user+endpoint keyed in-memory throttling for AI routes
key-files:
  created:
    - apps/backend/src/ai/contracts.ts
    - apps/backend/src/ai/provider.ts
    - apps/backend/src/ai/service.ts
    - apps/backend/src/ai/rate-limit.ts
    - apps/backend/src/ai/routes.ts
    - apps/backend/src/tests/ai/service.fallback.test.ts
    - apps/backend/src/tests/ai/routes.test.ts
  modified:
    - apps/backend/src/ai/service.ts
key-decisions:
  - "Normalized provider payloads through one deterministic pipeline and backfilled missing title/reminder/repeat from transcript parsing."
  - "Returned deterministic fallback for missing provider config, disabled zero-retention flag, and provider call failures."
  - "Suppressed repeat-only clarification prompts to preserve parity behavior when title/content/reminder are already resolved."
patterns-established:
  - "AI services use provider adapter + normalization helper composition so provider instability cannot break DTO contracts."
  - "AI routes enforce auth, zod validation, and per-endpoint limits before service execution."
requirements-completed: [AICP-01, AICP-02, AICP-03]
duration: 5 min
completed: 2026-04-19
---

# Phase 03 Plan 03: AI Capture Parity Summary

**AI parse and clarify APIs now return parity-compatible DTOs with deterministic fallback behavior and endpoint-level rate limiting.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-19T09:37:40+07:00
- **Completed:** 2026-04-19T09:42:38+07:00
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Added AI contracts and service normalization pipeline compatible with existing mobile/web DTO shape.
- Added NVIDIA-compatible provider adapter with safe JSON extraction and fallback-safe service wiring.
- Added authenticated AI parse/clarify routes with schema validation and endpoint-specific rate limiting.
- Added service and route parity tests covering backfill, fallback, repeat clarification suppression, validation, and throttle contract behavior.

## Task Commits

1. **Task 1: Define AI contracts and normalization/backfill pipeline** - `405217c` (feat)
2. **Task 2: Implement provider adapter with deterministic fallback behavior** - `405217c` (feat)
3. **Task 3: Expose authenticated routes with endpoint rate limits** - `72336b4` (feat)

## Files Created/Modified
- `apps/backend/src/ai/contracts.ts` - Parse/clarify request-response types and repeat-rule model.
- `apps/backend/src/ai/provider.ts` - NVIDIA provider call adapter with JSON extraction and timeout support.
- `apps/backend/src/ai/service.ts` - Fallback + normalization orchestration for parse and clarify operations.
- `apps/backend/src/ai/rate-limit.ts` - User-and-endpoint keyed in-memory limiter with stable rate_limit contract details.
- `apps/backend/src/ai/routes.ts` - Authenticated `POST /parse-voice` and `POST /clarify` handlers.
- `apps/backend/src/tests/ai/service.fallback.test.ts` - Deterministic fallback/backfill and clarify suppression coverage.
- `apps/backend/src/tests/ai/routes.test.ts` - Route validation, throttle, and DTO contract coverage.

## Decisions Made
- Centralized all provider and fallback outputs through one normalization pipeline to prevent contract drift.
- Kept AI endpoints resilient by converting all provider-missing/failure paths into deterministic local results.
- Enforced parse-route userId/auth-user alignment as an ownership guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Title backfill condition failed when provider returned content but omitted title**
- **Found during:** Task 1 verification
- **Issue:** Normalization only backfilled title when both title and content were missing.
- **Fix:** Backfilled deterministic title independently, while only defaulting content when both remain empty.
- **Files modified:** `apps/backend/src/ai/service.ts`
- **Verification:** `npm --workspace apps/backend run test`
- **Committed in:** `405217c`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Localized normalization improvement; preserved intended parity behavior.

## Issues Encountered
None.

## User Setup Required
None.

## Next Phase Readiness
- Plan 03-04 can mount `/api/ai` route group and extend end-to-end parity/security coverage across notes/subscriptions/device-tokens/AI.

---
*Phase: 03-notes-and-adjacent-domain-api-parity*
*Completed: 2026-04-19*
