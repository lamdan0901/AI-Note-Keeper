# Roadmap: AI Note Keeper Convex to Express Migration

## Overview

This roadmap delivers a parity-first migration from Convex to Express plus PostgreSQL, preserving user-visible behavior for authentication, notes, reminders, subscriptions, push, and AI capture while introducing durable worker execution, deterministic data migration, and safe client cutover and decommission gates.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Foundation and Runtime Baseline** - Stand up fail-fast backend foundation, migration system, health probes, validation, error contracts, and worker split.
- [x] **Phase 2: Auth Compatibility and Session Continuity** - Deliver secure JWT auth while preserving legacy password and session upgrade paths.
- [x] **Phase 3: Notes and Adjacent Domain API Parity** - Reach parity for notes sync, subscriptions, device tokens, and AI endpoints.
- [ ] **Phase 4: Reminder Domain Parity** - Port reminder lifecycle semantics with recurrence and dedupe parity.
- [ ] **Phase 5: Worker, Push, Merge, and Throttle Hardening** - Replace scheduler behavior with durable workers and preserve merge and anti-abuse correctness.
- [ ] **Phase 6: Data Migration Execution and Reconciliation** - Execute deterministic export/import/reconcile tooling with rollback-ready runbook gates.
- [ ] **Phase 7: Web and Mobile Cutover to Express APIs** - Move both clients to Express with polling and offline/session compatibility gates.
- [ ] **Phase 8: Convex Decommission and Cleanup** - Remove Convex runtime dependencies only after sustained stability sign-off.

## Phase Details

### Phase 1: Foundation and Runtime Baseline

**Goal**: Operators can run a production-safe backend foundation with stable contracts and independent HTTP and worker processes.
**Depends on**: Nothing (first phase)
**Requirements**: BASE-01, BASE-02, BASE-03, BASE-04, BASE-05, BASE-06, BASE-07, SHRD-01
**Success Criteria** (what must be TRUE):

1. Service startup fails fast with explicit configuration errors when required environment values are missing or invalid.
2. Schema migrations can be re-run safely and retain deterministic ordering and history.
3. Liveness and readiness endpoints provide accurate status for orchestration and CI checks.
4. Invalid requests are rejected at route boundaries and all non-2xx failures use one stable error contract.
5. HTTP server and worker process can run independently for API serving versus queue and cron execution.
6. Migration export/import/reconcile tooling skeleton and dry-run interfaces exist before parity implementation phases.
7. Shared domain semantics are consumed from packages/shared utilities rather than reimplemented in backend modules.
   **Plans**: 3 plans

Plans:

- [x] 01-01-PLAN.md — Lock startup/readiness/error/validation runtime contracts.
- [x] 01-02-PLAN.md — Split API and worker entrypoints with shared infra scaffolding.
- [x] 01-03-PLAN.md — Harden migration runner and add export/import/reconcile tooling skeleton.

### Phase 2: Auth Compatibility and Session Continuity

**Goal**: Users can authenticate securely under the new token model without lockout or forced re-onboarding.
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):

1. New users can register with unique credentials and receive valid session tokens.
2. Existing users with legacy salt:sha256 credentials can log in successfully and are upgraded to argon2id lazily.
3. Existing clients holding raw userId sessions can exchange to JWT sessions through the upgrade endpoint without forced re-authentication.
4. Refreshing a session rotates the token pair and rejects reuse of the prior refresh token, and logout revokes active refresh tokens.
   **Plans**: 3 plans

Plans:

- [x] 02-01-PLAN.md — Build backend auth crypto and refresh persistence foundations.
- [x] 02-02-PLAN.md — Implement register/login/refresh/logout/upgrade-session API surface.
- [x] 02-03-PLAN.md — Wire web/mobile auth contexts for cookie versus secure-storage continuity.

### Phase 3: Notes and Adjacent Domain API Parity

**Goal**: Users can manage notes and related domain data through Express APIs with parity in sync, idempotency, and safety behavior.
**Depends on**: Phase 2
**Requirements**: NOTE-01, NOTE-02, NOTE-03, NOTE-04, SUBS-01, SUBS-02, DEVC-01, DEVC-02, AICP-01, AICP-02, AICP-03
**Success Criteria** (what must be TRUE):

1. Users can list, create, update, trash, and purge notes with strict ownership enforcement.
2. Notes sync resolves with deterministic last-write-wins behavior and remains safe under concurrent sync requests.
3. Replayed sync payloads are idempotent and do not create duplicate change effects.
4. Users can create, update, trash, restore, and hard-delete subscriptions while reminder scheduling fields stay consistent.
5. Device token upsert and delete operations are idempotent, and notification_ledger behavior remains mobile-local only with no PostgreSQL persistence or API exposure.
6. AI parse and clarify endpoints return parity-compatible results with validation, rate limits, and deterministic fallback when providers fail.
   **Plans**: 4 plans

Plans:

- [x] 03-01-PLAN.md - Build authenticated notes sync parity with LWW, idempotency, and trash lifecycle behaviors.
- [x] 03-02-PLAN.md - Implement subscription lifecycle and Android-only device-token idempotency APIs with ownership guards.
- [x] 03-03-PLAN.md - Implement AI parse/clarify parity endpoints with deterministic fallback, normalization, and rate limits.
- [x] 03-04-PLAN.md - Mount phase-3 domains in API runtime and add HTTP parity/security regression suites.

### Phase 4: Reminder Domain Parity

**Goal**: Users can manage reminders with parity-correct acknowledge, snooze, recurrence, and change-event semantics.
**Depends on**: Phase 3
**Requirements**: REMD-01, REMD-02, REMD-03, REMD-04, REMD-05
**Success Criteria** (what must be TRUE):

1. Users can list, create, update, and delete reminders with strict ownership and authentication checks.
2. Acknowledging reminders advances recurring schedules correctly and unschedules one-time reminders.
3. Snooze operations update due state and timing deterministically.
4. Recurrence behavior is timezone and DST safe through shared recurrence utility semantics.
5. Reminder change-event writes preserve payload-hash dedupe behavior.
   **Plans**: 3 plans

Plans:

- [x] 04-01-PLAN.md - Implement reminder core service transitions, recurrence/timezone validation, and change-event dedupe semantics.
- [x] 04-02-PLAN.md - Expose reminder HTTP routes and runtime mounting with auth-scoped parity contracts.
- [x] 04-03-PLAN.md - Add integrated phase-4 parity and security boundary regression suites.

### Phase 5: Worker, Push, Merge, and Throttle Hardening

**Goal**: Background processing and merge-security paths preserve parity under retries, restarts, and concurrency pressure.
**Depends on**: Phase 4
**Requirements**: JOBS-01, JOBS-02, JOBS-03, PUSH-01, PUSH-02, MERG-01, MERG-02, MERG-03, THRT-01
**Success Criteria** (what must be TRUE):

1. Cron and due-reminder jobs run in a dedicated worker with MAX_LOOKBACK_MS scan protection and durable cron_state watermark updates.
2. Retry and restart scenarios do not duplicate due-reminder processing.
3. Push delivery retries transient failures with defined backoff and cleans up unregistered device tokens automatically.
4. Merge preflight and apply flows report and execute cloud-wins, local-wins, and merge-both strategies within explicit transaction boundaries.
5. Merge attempts are lock-safe under concurrency and anti-abuse throttling preserves threshold and block-window parity.
   **Plans**: TBD

### Phase 6: Data Migration Execution and Reconciliation

**Goal**: Migration operators can run deterministic and recoverable Convex to PostgreSQL data movement with measurable reconciliation confidence.
**Depends on**: Phase 5
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04
**Success Criteria** (what must be TRUE):

1. Export tooling emits deterministic Convex dataset ordering across repeated runs.
2. Import tooling supports dry-run and checkpoint resume and remains idempotent on re-execution.
3. Reconciliation output includes counts, checksums, and sampling drift with explicit pass or fail against sign-off thresholds.
4. Migration runbooks include rollback checkpoints and staging rehearsal evidence before production cutover.
   **Plans**: TBD

### Phase 7: Web and Mobile Cutover to Express APIs

**Goal**: Frontend web and mobile experiences run on Express APIs with parity in session handling, sync behavior, and rollout safety gates.
**Depends on**: Phase 6
**Requirements**: WEB-01, WEB-02, MOBL-01, MOBL-02, CUTV-01
**Success Criteria** (what must be TRUE):

1. Web experience operates entirely through Express APIs and handles 401 responses with refresh-and-retry behavior.
2. Web cutover is gated until focus sync and 30-second notes polling behavior is verified.
3. Mobile experience preserves offline outbox and last-write-wins sync semantics while operating through Express APIs.
4. Mobile bootstrap upgrades legacy userId sessions to JWT seamlessly without manual user intervention.
5. Rollout advances by cohorts only after parity and SLO gates pass, with rehearsed rollback criteria validated before full traffic cutover.
   **Plans**: TBD
   **UI hint**: yes

### Phase 8: Convex Decommission and Cleanup

**Goal**: Convex runtime can be retired safely after measurable stability on Express/PostgreSQL.
**Depends on**: Phase 7
**Requirements**: DECM-01
**Success Criteria** (what must be TRUE):

1. Convex runtime dependencies are removed only after both web and mobile complete the required stability window sign-off.
2. Core user flows (auth, notes, reminders, subscriptions, and AI capture) remain stable after Convex runtime retirement.
   **Plans**: TBD

## Progress

| Phase                                          | Plans Complete | Status      | Completed  |
| ---------------------------------------------- | -------------- | ----------- | ---------- |
| 1. Foundation and Runtime Baseline             | 3/3            | Complete    | 2026-04-18 |
| 2. Auth Compatibility and Session Continuity   | 3/3            | Complete    | 2026-04-18 |
| 3. Notes and Adjacent Domain API Parity        | 4/4            | Complete    | 2026-04-19 |
| 4. Reminder Domain Parity                      | 3/3            | Complete    | 2026-04-19 |
| 5. Worker, Push, Merge, and Throttle Hardening | 0/TBD          | Not started | -          |
| 6. Data Migration Execution and Reconciliation | 0/TBD          | Not started | -          |
| 7. Web and Mobile Cutover to Express APIs      | 0/TBD          | Not started | -          |
| 8. Convex Decommission and Cleanup             | 0/TBD          | Not started | -          |
