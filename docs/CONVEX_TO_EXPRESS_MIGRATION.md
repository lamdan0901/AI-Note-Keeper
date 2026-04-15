# Plan: Convex → Express/PostgreSQL Migration — Reviewed Learning Plan

## Why this version

This plan is rewritten from `docs/CONVEX_TO_EXPRESS_MIGRATION_DRAFT.md` as a **developer-friendly execution guide**:

- Clear phase boundaries
- Explicit TODOs you can execute in order
- Backend learning goals per phase
- Concrete exit criteria so both of us know when to move forward

No coding is done in this document. This is the source of truth for implementation work.

---

## How to use this plan

1. Work phase-by-phase; do not skip dependencies.
2. For each phase, complete all TODOs and exit criteria.
3. Keep parity with existing Convex behavior unless explicitly changed here.
4. If a new decision conflicts with this plan, update this file first, then implement.

---

## Non-negotiable migration constraints (from draft)

1. `packages/shared` stays as-is and is imported by the new backend.
2. Auth model: JWT access token + refresh token rotation, with hashed refresh token storage.
3. Legacy auth compatibility: existing clients hold raw `userId`; provide session upgrade endpoint.
4. Password migration: keep legacy `salt:sha256` support and upgrade lazily to `argon2id` at login.
5. Deferred work replacement: use **pg-boss** (not in-memory timers).
6. Cron execution must run in dedicated worker process.
7. Realtime strategy for migration: polling parity first (no SSE/WebSocket requirement now).
8. Polling contract is a hard gate before web cutover:
   - notes sync on window focus + every 30 seconds
   - reminder/subscription updates are cron/push-driven
9. `notification_ledger` remains mobile-local SQLite only (never in PostgreSQL).
10. Preserve `MAX_LOOKBACK_MS = 5 * 60 * 1000` cron guard for reminder scanning.
11. `cron_state.key` must be a UNIQUE CONSTRAINT (for proper upsert behavior).
12. Data migration tooling starts early, not only at final cutover.

---

## Target backend architecture

`apps/backend`:

- `routes/` → HTTP contract layer
- `services/` → domain/business rules
- `repositories/` → SQL only
- `middleware/` → auth/validation/errors/logging
- `jobs/` → cron + queue consumers
- `db/` → pool + migrations + migrator

Core principles:

- Thin routes, fat services
- Repositories contain no business logic
- Explicit errors with stable response shape
- Transaction boundaries are deliberate and documented

---

## Phase dependency map

```text
Phase 0 (Foundation)
  -> Phase 0.5 (Infra + Queue + CI)
    -> Phase 1A (Auth)
      -> Phase 1B (Notes Sync) ----\
      -> Phase 1C (Subs/Devices/AI) ----+-> Phase 2 (Reminders)
                                         -> Phase 3 (Jobs + Push)
                                           -> Phase 4 (Merge + Throttle)
                                             -> Phase 5 (Data Migration Execution)
                                               -> Phase 6 (Web migration)
                                               -> Phase 7 (Mobile migration)
                                                 -> Phase 8 (Decommission Convex)
```

Parallel windows:

- **1B and 1C can run in parallel** after 1A
- **6 and 7 can run in parallel** after 5

---

## Phase dashboard

| Phase | Primary outcome | Depends on | Learning focus |
|---|---|---|---|
| 0 | Express + Postgres foundation | - | app structure, migrations, errors |
| 0.5 | Docker + CI + pg-boss baseline | 0 | deployment shape, async jobs |
| 1A | Auth parity + JWT session model | 0.5 | auth lifecycle, hash migration |
| 1B | Notes CRUD + LWW sync parity | 1A | transactions, idempotency, conflict resolution |
| 1C | Subscriptions + device tokens + AI APIs | 1A | modular services, external API resilience |
| 2 | Reminder domain parity | 1B + 1C | recurrence, timezone correctness |
| 3 | Cron + push workers parity | 2 | reliable background processing |
| 4 | User merge + throttling parity | 3 | locking, anti-abuse controls |
| 5 | Convex→PG migration execution | 4 | ETL safety, reconciliation |
| 6 | Web client cutover | 5 | API adapter design, rollout safety |
| 7 | Mobile client cutover | 5 | offline sync compatibility |
| 8 | Convex decommission | 6 + 7 | cleanup discipline, rollback readiness |

---

## PHASE 0 — Foundation: Express app + schema + contracts

### Goal

Create a production-grade backend skeleton with strict config validation, migration system, standardized errors, and health endpoints.

### Backend skills to learn

- Connection pooling and DB lifecycle
- SQL migration discipline
- Express middleware ordering
- Stable API error contracts

### TODOs

1. **P0-01** Create `apps/backend` workspace package and scripts (`dev`, `build`, `start`, `test`, `migrate`).
2. **P0-02** Define backend folder layout (`routes/services/repositories/jobs/middleware/db`).
3. **P0-03** Add `config.ts` with fail-fast env validation.
4. **P0-04** Add singleton Postgres pool module.
5. **P0-05** Implement migration runner with `schema_migrations` tracking.
6. **P0-06** Create schema migrations for:
   - `users`
   - `notes`
   - `subscriptions`
   - `device_push_tokens`
   - `note_change_events`
   - `cron_state` (UNIQUE CONSTRAINT on key)
   - `migration_attempts`
   - `refresh_tokens`
7. **P0-07** Add core indexes from draft (sync, reminder lookups, dedupe, token lookup).
8. **P0-08** Add error catalog + global error middleware using standard error shape.
9. **P0-09** Add request validation pattern (schema-first, route-level).
10. **P0-10** Add `/health/live` and `/health/ready`.
11. **P0-11** Define API status mapping (validation/auth/forbidden/not-found/conflict/rate-limit/internal).
12. **P0-12** Start migration tooling skeleton (`export/import/reconcile` scaffolding only).
13. **P0-13** Document polling contract baseline (focus + 30s notes sync; cron/push-driven updates).
14. **P0-14** Set up HTTP integration test harness shape that can absorb converted contract tests in later phases.

### Deliverables

- Bootable backend service
- Re-runnable migrations
- Baseline DB schema and indexes
- Shared error contract documentation

### Exit criteria

- App starts with valid env and fails clearly with invalid env
- Migrations are idempotent
- Health probes behave as expected
- Error shape is consistent for all non-2xx responses

---

## PHASE 0.5 — Infrastructure: Docker + CI + pg-boss runtime base

### Goal

Prepare runtime and operational plumbing before domain features.

### Backend skills to learn

- Containerized service composition
- CI with service dependencies
- Queue-backed async processing fundamentals

### TODOs

1. **P05-01** Add backend Dockerfile and local docker-compose with Postgres.
2. **P05-02** Add backend `.env.example` with clear secret documentation.
3. **P05-03** Initialize pg-boss connection and lifecycle module.
4. **P05-04** Create dedicated worker entrypoint separate from HTTP server.
5. **P05-05** Add CI workflow for backend typecheck/lint/test against Postgres service.
6. **P05-06** Decide and document retry/backoff defaults for pg-boss jobs.
7. **P05-07** Add structured logging baseline (request + worker logs).
8. **P05-08** Finalize secrets matrix (JWT, DB, NVIDIA, Firebase).

### Deliverables

- Reproducible local runtime
- Backend CI pipeline
- Queue + worker foundation

### Exit criteria

- Backend and Postgres boot together locally
- Worker can connect and process a sample job
- CI can run backend checks in clean environment

---

## PHASE 1A — Auth parity: register/login/JWT/refresh/session upgrade

### Goal

Port auth logic while upgrading session architecture safely for existing users.

### Backend skills to learn

- Token-based session design
- Refresh token rotation and revocation
- Progressive password hash migration
- Backward compatibility planning

### TODOs

1. **P1A-01** Define token service: sign/verify access + refresh tokens.
2. **P1A-02** Create refresh token repository with hashed token persistence.
3. **P1A-03** Port register flow with username uniqueness + argon2id for new users.
4. **P1A-04** Port login flow with dual hash verification:
   - legacy `salt:sha256`
   - modern `argon2id`
5. **P1A-05** Implement lazy password hash upgrade on successful legacy login.
6. **P1A-06** Implement refresh token rotation (revoke old, issue new pair).
7. **P1A-07** Implement logout revocation path.
8. **P1A-08** Implement session validation endpoint for JWT flow.
9. **P1A-09** Add legacy upgrade endpoint `POST /auth/upgrade-session` accepting `{ userId }`.
10. **P1A-10** Gate legacy upgrade behavior behind feature flag (`backend_auth`).
11. **P1A-11** Convert auth-related contract tests into HTTP integration tests.

### Deliverables

- Full auth HTTP surface
- Backward-compatible session upgrade path
- Hash migration behavior documented and tested

### Exit criteria

- New user login flow works end-to-end
- Legacy user can login and get hash upgraded
- Legacy session holder can exchange `userId` for JWT pair
- Refresh rotation and logout revocation behave correctly

---

## PHASE 1B — Notes domain parity: CRUD + LWW sync + change events

### Goal

Port notes sync protocol with idempotency and conflict handling parity.

### Backend skills to learn

- Transaction boundaries
- Row-level locking
- LWW conflict resolution
- Event deduplication via payload hash

### TODOs

1. **P1B-01** Port notes repository methods for list/upsert/delete/trash purge.
2. **P1B-02** Port note change event repository with dedupe checks.
3. **P1B-03** Implement `syncNotes` service with transaction per request batch.
4. **P1B-04** Enforce LWW rule (`incoming.updatedAt > existing.updatedAt`).
5. **P1B-05** Enforce idempotency using payload hash event check.
6. **P1B-06** Preserve legacy + canonical recurrence fields in reads/writes.
7. **P1B-07** Port notes routes (`GET /notes`, `POST /notes/sync`, trash endpoints).
8. **P1B-08** Ensure ownership checks on all note mutations.
9. **P1B-09** Convert notes contract tests to HTTP integration tests.
10. **P1B-10** Add explicit concurrent sync scenario tests.

### Deliverables

- Notes API parity
- Sync conflict handling parity
- Idempotent change event write path

### Exit criteria

- Sync request replay is no-op on duplicate payload hash
- Concurrent syncs resolve consistently with LWW
- Contract test behavior matches Convex expectations

---

## PHASE 1C — Subscriptions + device tokens + AI capture parity

### Goal

Port adjacent domains needed before full reminder and worker parity.

### Backend skills to learn

- Domain service separation
- Soft-delete and restore semantics
- External provider fallback patterns

### TODOs

1. **P1C-01** Port subscription CRUD/list/trash/restore/hard-delete behavior.
2. **P1C-02** Preserve reminder scheduling fields (`nextReminderAt`, `nextTrialReminderAt`).
3. **P1C-03** Port device token upsert/delete behavior with uniqueness policy.
4. **P1C-04** Port AI parse endpoint (`/ai/parse-voice`) parity.
5. **P1C-05** Port AI clarify endpoint (`/ai/clarify`) parity.
6. **P1C-06** Preserve deterministic fallback when AI provider is unavailable.
7. **P1C-07** Add input validation + endpoint-level rate limits for AI routes.
8. **P1C-08** Convert subscription/AI contract tests to HTTP integration tests.

### Deliverables

- Subscriptions HTTP module
- Device token module
- AI capture module with fallback behavior

### Exit criteria

- Subscription lifecycle parity confirmed
- Device token updates are idempotent
- AI endpoints return stable fallback output when provider is down

---

## PHASE 2 — Reminders domain parity (full)

### Goal

Port reminders and reminder change events with timezone-safe recurrence behavior.

### Backend skills to learn

- Recurrence scheduling boundaries
- Timezone and DST correctness
- Ack/snooze state transitions

### TODOs

1. **P2-01** Port reminder query methods (list/get/filter by updatedSince).
2. **P2-02** Port create/update/delete reminder flows.
3. **P2-03** Port ack behavior:
   - recurring reminder advances schedule
   - one-time reminder becomes unscheduled
4. **P2-04** Port snooze behavior and due-state transitions.
5. **P2-05** Use shared recurrence helpers only (`packages/shared/utils/recurrence.ts`).
6. **P2-06** Preserve payload-hash change-event dedupe semantics.
7. **P2-07** Port reminder routes with strict auth + validation.
8. **P2-08** Convert reminder contract tests (CRUD/list/ack/snooze/update).
9. **P2-09** Add edge-case tests for timezone and DST rollover.

### Deliverables

- Reminder CRUD + action endpoints
- Recurrence parity with shared utility behavior
- Reminder change event consistency

### Exit criteria

- Ack/snooze outcomes match existing app expectations
- Recurrence edge cases are deterministic
- Reminder contract tests pass with parity behavior

---

## PHASE 3 — Jobs + cron + FCM push parity

### Goal

Replace Convex scheduler/crons with durable worker-based pg-boss jobs.

### Backend skills to learn

- Reliable cron windows
- Watermark deduplication
- Queue retry semantics
- Push provider error handling

### TODOs

1. **P3-01** Port push service (FCM v1 auth + send flow).
2. **P3-02** Port stale-token cleanup behavior on `UNREGISTERED` responses.
3. **P3-03** Implement retry/backoff parity for transient push failures.
4. **P3-04** Register pg-boss worker for push jobs.
5. **P3-05** Port and schedule all cron jobs from `convex/crons.ts`:
   - check-reminders (every minute)
   - purge-expired-trash (daily)
   - purge-expired-subscription-trash (daily)
   - check-subscription-reminders (daily)
6. **P3-06** Implement cron watermark storage in `cron_state`.
7. **P3-07** Preserve `MAX_LOOKBACK_MS` window guard for reminder scanning.
8. **P3-08** Ensure cron processing is idempotent across restart/retry conditions.
9. **P3-09** Add integration tests around restart and duplicate-prevention scenarios.

### Deliverables

- Worker-driven background processing stack
- Cron parity with safe restart behavior
- Push delivery and cleanup parity

### Exit criteria

- Due reminders are processed once with expected watermark updates
- Cron restart does not cause full-table scans
- Push retry/cleanup behavior matches existing reliability expectations

---

## PHASE 4 — User data merge + anti-abuse throttling parity

### Goal

Port merge workflows and security throttling from Convex behavior.

### Backend skills to learn

- Row-level locking for correctness
- Exponential backoff throttling
- Multi-strategy merge semantics

### TODOs

1. **P4-01** Port migration attempt repository with `SELECT ... FOR UPDATE`.
2. **P4-02** Implement throttle constants and behavior parity:
   - `THROTTLE_THRESHOLD = 3`
   - `MAX_BLOCK_MS = 15 * 60 * 1000`
3. **P4-03** Port preflight merge endpoint (counts/conflicts/emptiness checks).
4. **P4-04** Port apply merge endpoint with strategy behavior:
   - cloud wins
   - local wins
   - merge both
5. **P4-05** Preserve welcome-note detection logic from shared constants.
6. **P4-06** Ensure merge operation runs in explicit transaction.
7. **P4-07** Add conflict and race-condition tests for concurrent requests.
8. **P4-08** Convert merge security contract tests to HTTP integration tests.

### Deliverables

- Merge preflight/apply APIs
- Throttling with lock-safe state transitions
- Security parity tests

### Exit criteria

- Concurrent merge attempts do not corrupt data
- Throttle windows behave consistently under retries
- Merge strategies preserve expected data outcomes

---

## PHASE 5 — Data migration execution: Convex → PostgreSQL

### Goal

Perform safe migration with reconciliation and repeatable runbook.

### Backend skills to learn

- ETL scripting patterns
- Idempotent import design
- Reconciliation and drift detection

### TODOs

1. **P5-01** Implement Convex export script (tables + deterministic ordering).
2. **P5-02** Implement Postgres import script (mapping + idempotent insert policy).
3. **P5-03** Implement reconciliation script (counts + checksums + sampling).
4. **P5-04** Add dry-run modes for export/import/reconcile.
5. **P5-05** Add checkpoint/resume behavior for large imports.
6. **P5-06** Prepare staging rehearsal on production-like snapshot.
7. **P5-07** Document migration runbook with rollback checkpoints.
8. **P5-08** Evaluate one-off Convex migration functions (`notesMigration`, `subscriptionMigration`) and mirror as SQL/data-fix scripts if needed.
9. **P5-09** Define acceptable reconciliation thresholds and sign-off criteria.

### Deliverables

- Export/import/reconcile tooling
- Migration runbook
- Staging rehearsal evidence

### Exit criteria

- Import is repeatable and idempotent
- Reconciliation reports are clean and explainable
- Final cutover procedure is deterministic

---

## PHASE 6 — Web client migration to Express APIs

### Goal

Move web from Convex hooks to REST while keeping UI/service contracts stable.

### Backend skills to learn

- API adapter design
- Token refresh behavior at client boundary
- Progressive rollout with rollback controls

### TODOs

1. **P6-01** Build web API client wrapper (auth headers + typed error mapping).
2. **P6-02** Implement 401 refresh-and-retry flow once per request.
3. **P6-03** Migrate session storage shape to JWT model.
4. **P6-04** Implement legacy session upgrade call (`/auth/upgrade-session`) during transition.
5. **P6-05** Replace Convex service calls in notes/reminders/subscriptions services.
6. **P6-06** Gate backend usage behind feature flag.
7. **P6-07** Remove Convex provider only after all service migrations are complete.
8. **P6-08** Verify polling contract gate is met before go-live.
9. **P6-09** Execute gradual rollout plan (dev -> staging -> percentage rollout -> full).

### Deliverables

- Web running fully on Express APIs
- Safe rollout + rollback controls

### Exit criteria

- Web critical flows run without Convex dependency
- Session and refresh behavior is stable
- Polling contract is confirmed in production-like environment

---

## PHASE 7 — Mobile client migration to Express APIs

### Goal

Move mobile from Convex to REST while preserving offline sync and push behavior.

### Backend skills to learn

- Offline-first API compatibility
- Migration-safe session bootstrap
- Device push behavior validation

### TODOs

1. **P7-01** Build mobile API client with secure token storage integration.
2. **P7-02** Implement legacy `userId` session upgrade to JWT at app bootstrap.
3. **P7-03** Migrate note sync integration to new `/notes` + `/notes/sync` APIs.
4. **P7-04** Keep offline outbox + LWW semantics unchanged.
5. **P7-05** Migrate reminder and subscription flows to REST.
6. **P7-06** Validate FCM-driven sync behavior against new backend payloads.
7. **P7-07** Validate real-device behavior for offline/online transitions.
8. **P7-08** Roll out mobile migration behind feature flag with rollback path.

### Deliverables

- Mobile operating against Express backend
- Preserved offline and push workflows

### Exit criteria

- Offline-created notes sync correctly after reconnect
- Reminder notifications and follow-up sync remain correct
- Legacy users upgrade session without manual intervention

---

## PHASE 8 — Decommission Convex

### Goal

Retire Convex safely after both clients run stably on new backend.

### Backend skills to learn

- Final cutover discipline
- Dependency cleanup without regression
- Rollback readiness and archival

### TODOs

1. **P8-01** Execute final Convex→Postgres reconciliation.
2. **P8-02** Remove Convex environment variables from all apps.
3. **P8-03** Remove Convex runtime dependencies from workspace packages.
4. **P8-04** Remove Convex providers/clients/imports in web/mobile.
5. **P8-05** Archive final rollback artifacts and pre-decommission tag.
6. **P8-06** Update project docs for new backend operation model.
7. **P8-07** Disable Convex services only after stability window sign-off.

### Deliverables

- Clean monorepo without active Convex runtime dependency
- Documented rollback archive

### Exit criteria

- No runtime Convex imports remain
- All critical user flows run on Express/Postgres only
- Decommission decision and rollback artifacts are documented

---

## Relevant source files (reference list)

### Convex source to port

- `convex/schema.ts`
- `convex/crons.ts`
- `convex/functions/auth.ts`
- `convex/functions/notes.ts`
- `convex/functions/reminders.ts`
- `convex/functions/reminderTriggers.ts`
- `convex/functions/subscriptions.ts`
- `convex/functions/deviceTokens.ts`
- `convex/functions/push.ts`
- `convex/functions/aiNoteCapture.ts`
- `convex/functions/userDataMigration.ts`
- `convex/functions/notesMigration.ts`
- `convex/functions/subscriptionMigration.ts`

### Shared logic to reuse (do not reimplement)

- `packages/shared/utils/recurrence.ts`
- `packages/shared/utils/repeatCodec.ts`
- `packages/shared/utils/hash.ts`
- `packages/shared/utils/checklist.ts`
- `packages/shared/constants/welcomeNote.ts`

### Contract tests to migrate to HTTP integration tests

- `tests/contract/notes.crud.test.ts`
- `tests/contract/reminders.crud.test.ts`
- `tests/contract/reminders.ackReminder.test.ts`
- `tests/contract/reminders.snoozeReminder.test.ts`
- `tests/contract/reminders.update.test.ts`
- `tests/contract/reminders.list.test.ts`
- `tests/contract/subscriptions.reminders.test.ts`
- `tests/contract/subscriptions.trash.test.ts`
- `tests/contract/aiNoteCapture.contract.test.ts`
- `tests/contract/userDataMergeDecision.test.ts`
- `tests/contract/userDataMigration.security.test.ts`

---

## Out of scope (for this migration plan)

1. New realtime channel (SSE/WebSocket)
2. Non-parity product changes unrelated to migration
3. `appwrite-functions/` changes unless explicitly requested in separate work

