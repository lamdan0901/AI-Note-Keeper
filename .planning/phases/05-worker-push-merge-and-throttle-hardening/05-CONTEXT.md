# Phase 5: Worker, Push, Merge, and Throttle Hardening - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden background processing and merge-security paths so parity behavior remains correct under retries, restarts, and concurrency pressure. Scope includes worker cron/job behavior, push retry and token cleanup semantics, merge preflight/apply contracts, and anti-abuse throttling with lock safety.

This phase does not expand product capabilities beyond parity.

</domain>

<decisions>
## Implementation Decisions

### Worker topology and cron watermark behavior
- **D-01:** Use a scanner + queued fan-out model: cron scanner finds due reminders, then enqueues per-reminder jobs for downstream handling.
- **D-02:** Advance `cron_state.lastCheckedAt` only after enqueue batch commit succeeds, so reminders are not silently skipped on crashes.
- **D-03:** Use `eventId = noteId + triggerTime` as the execution identity key, protected by a unique guard for idempotency.
- **D-04:** Enforce at-least-once worker delivery with idempotent handlers, not at-most-once behavior.

### Push retry and token hygiene
- **D-05:** Keep parity retry schedule for transient FCM failures: 2 retries at approximately 30s then 60s.
- **D-06:** Retry per-device token, not per-reminder batch.
- **D-07:** Remove device tokens immediately on `UNREGISTERED` responses.
- **D-08:** After retry exhaustion, record terminal failure and continue processing other targets/work.

### Merge preflight and apply contracts
- **D-09:** Preflight response preserves Convex parity summary fields: `sourceEmpty`, `sourceSampleOnly`, `targetEmpty`, `hasConflicts`, and source/target counts.
- **D-10:** Keep API strategy enum values as `cloud | local | both` for direct parity.
- **D-11:** `applyUserDataMerge` runs in a single explicit database transaction per request.
- **D-12:** `strategy=both` uses canonical shared `resolveMergeResolution` semantics.

### Throttle and concurrency locking
- **D-13:** Preserve existing anti-abuse constants: threshold 3, base block 60 seconds, exponential backoff up to 15 minutes.
- **D-14:** Throttle key is target account identity (`toUserId`).
- **D-15:** Use row-level locking (`SELECT ... FOR UPDATE` style) on migration-attempt and target-user rows inside transaction boundaries.
- **D-16:** Throttled responses return `rate_limit` with `retryAfterSeconds`/`resetAt` metadata.

### the agent's Discretion
- Queue names, handler module names, and payload DTO field naming.
- Exact persistence shape for terminal push-failure observability.
- Lock timeout values and retry tuning details, as long as parity semantics above remain unchanged.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and constraints
- `.planning/ROADMAP.md` - Phase 5 goal and success criteria used for discussion boundary.
- `.planning/REQUIREMENTS.md` - JOBS-01..JOBS-03, PUSH-01..PUSH-02, MERG-01..MERG-03, THRT-01 definitions.
- `.planning/PROJECT.md` - migration guardrails and parity-first constraints.

### Prior locked context
- `.planning/phases/01-foundation-and-runtime-baseline/01-CONTEXT.md` - dedicated worker split and pg-boss scaffold decisions.
- `.planning/phases/04-reminder-domain-parity/04-CONTEXT.md` - reminder/change-event parity decisions that phase 5 must harden.

### Existing parity behavior sources
- `convex/functions/reminderTriggers.ts` - `MAX_LOOKBACK_MS`, watermark flow, due reminder scanning and trigger flow.
- `convex/functions/push.ts` - current retry policy and unregistered-token cleanup semantics.
- `convex/functions/userDataMigration.ts` - merge strategy model, throttle constants, and block-window behavior.
- `tests/contract/userDataMigration.security.test.ts` - merge/throttle security contract expectations.
- `tests/contract/userDataMergeDecision.test.ts` - canonical merge resolution semantics.

### Backend integration anchors
- `apps/backend/src/worker/index.ts` - worker bootstrap and lifecycle wiring.
- `apps/backend/src/worker/boss-adapter.ts` - pg-boss adapter scaffold to extend for phase 5.
- `apps/backend/src/middleware/error-middleware.ts` - stable `rate_limit` error payload behavior.

### Migration plan reference
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md` - non-negotiable constraints plus legacy phase sections for jobs/push and merge/throttle behavior (naming differs; use ROADMAP numbering as source of active phase order).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Worker runtime scaffold already exists in `apps/backend/src/worker/index.ts` and `apps/backend/src/worker/boss-adapter.ts`.
- Convex reminder cron implementation in `convex/functions/reminderTriggers.ts` already encodes watermark plus lookback guard semantics.
- Convex push implementation in `convex/functions/push.ts` already encodes retry windows and `UNREGISTERED` token cleanup behavior.
- Convex merge/throttle implementation in `convex/functions/userDataMigration.ts` already encodes strategy semantics and anti-abuse constants.

### Established Patterns
- Parity-first migration: preserve behavior before redesigning internals.
- Stable error contract requires `rate_limit` responses to expose retry metadata when present.
- Previous phases rely on strict ownership and deterministic/idempotent state transitions.

### Integration Points
- Phase 5 worker and queue handlers will extend the backend worker runtime path.
- Push reliability work integrates with existing device-token persistence and cleanup flows.
- Merge/throttle hardening integrates with auth/migration endpoints and DB transaction boundaries.

</code_context>

<specifics>
## Specific Ideas

- Prefer strict parity where constants and contracts already exist.
- Keep API strategy values unchanged (`cloud|local|both`) while allowing clearer docs wording.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 05-worker-push-merge-and-throttle-hardening*
*Context gathered: 2026-04-19*
