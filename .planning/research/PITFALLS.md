# Pitfalls Research

**Domain:** Convex to Express/PostgreSQL backend migration with worker/queue architecture and phased web/mobile cutover
**Researched:** 2026-04-18
**Confidence:** MEDIUM-HIGH

## Critical Pitfalls

### Pitfall 1: Transaction Semantics Drift (Convex -> Express + PostgreSQL)

**What goes wrong:**
Behavior that was previously consistent in Convex becomes race-prone in Express services, especially around sync, merge, and reminder updates. Lost updates and inconsistent reads appear under concurrency.

**Why it happens:**
Convex mutations are transactional and deterministic by default, while Express code can accidentally split read/modify/write across multiple statements or requests without explicit locking and retry logic.

**How to avoid:**
- Define explicit transaction boundaries in service methods for all multi-step domain writes.
- Use unique constraints + `INSERT ... ON CONFLICT` for idempotent write paths.
- Use `SELECT ... FOR UPDATE` where merge/throttle state can race.
- Add concurrency integration tests for notes sync, reminder ack/snooze, and merge preflight/apply.

**Warning signs:**
- Intermittent test failures under parallel load.
- Duplicate or missing note/reminder change events.
- Merge/throttle state flipping unexpectedly between retries.

**Phase to address:**
Phase 1B, Phase 2, and Phase 4.

---

### Pitfall 2: Scheduler and Queue Guarantee Mismatch

**What goes wrong:**
Reminder/push jobs are duplicated, skipped, or reordered after retries and restarts, causing duplicate notifications or missed sends.

**Why it happens:**
Teams assume queue execution semantics are identical to Convex scheduling semantics. In migration, job delivery, retries, and side effects need explicit idempotency design.

**How to avoid:**
- Make all workers idempotent using stable domain keys (e.g., reminderId + dueAt bucket + channel).
- Persist dedupe tokens in DB and guard with unique constraints.
- Use dead letter queues and retry policy per job type (transient vs permanent failure).
- Add restart/retry integration tests before cutover.

**Warning signs:**
- Spike in push retries without matching success.
- Repeated sends for the same reminder window.
- Growing failed/dead-letter jobs with no runbook.

**Phase to address:**
Phase 0.5 and Phase 3.

---

### Pitfall 3: Missing Transactional Outbox Boundary

**What goes wrong:**
Database write commits but enqueue/send does not, or enqueue/send happens while DB write later rolls back. User state and async side effects diverge.

**Why it happens:**
The classic dual-write problem appears when DB state and queue publish are handled as separate non-atomic operations.

**How to avoid:**
- Write an outbox/event record in the same DB transaction as the domain mutation.
- Relay outbox records to pg-boss in a separate reliable dispatcher.
- Make consumer processing idempotent and monotonic by event ID.

**Warning signs:**
- Rows show new state but corresponding job/event does not exist.
- Manual requeue scripts become common in operations.
- Incidents where "saved but no notification" or "notification without save" occur.

**Phase to address:**
Phase 1B/1C for event creation paths and Phase 3 for worker relay processing.

---

### Pitfall 4: Auth Cutover Lockout (Legacy Session + Password Migration)

**What goes wrong:**
Existing users are unexpectedly logged out or unable to sign in during rollout, especially older clients carrying only raw `userId` session assumptions.

**Why it happens:**
JWT/refresh rotation is introduced without complete compatibility bridges (`/auth/upgrade-session`, legacy hash verification, lazy hash upgrade telemetry).

**How to avoid:**
- Keep legacy session upgrade endpoint active until web and mobile migrations complete.
- Support legacy `salt:sha256` verification with immediate `argon2id` upgrade on successful login.
- Track auth failures by app version and rollout cohort.
- Block rollout progression when compatibility SLO is violated.

**Warning signs:**
- 401/403 surge after enabling backend flag.
- Elevated password reset volume.
- Client-version-skewed login failures.

**Phase to address:**
Phase 1A, validated again in Phase 6 and Phase 7.

---

### Pitfall 5: Incomplete Data Migration Discipline (No Checkpoints/Reconcile Gates)

**What goes wrong:**
Migration appears complete but contains silent drift: missing rows, duplicated rows, stale timestamps, or partially migrated relationships.

**Why it happens:**
Export/import scripts are treated as one-shot utilities instead of deterministic, resumable, and auditable pipelines with strict acceptance thresholds.

**How to avoid:**
- Use deterministic export ordering and stable key mapping rules.
- Implement checkpoint/resume for long-running imports.
- Run dry-run + staging rehearsal on production-like snapshots.
- Define pass/fail thresholds for counts, checksums, and sample parity before cutover.

**Warning signs:**
- Reconciliation output not reproducible between runs.
- Manual SQL patches accumulate to "fix drift".
- Cutover readiness depends on subjective confidence instead of numeric gates.

**Phase to address:**
Phase 0 (tooling skeleton) and Phase 5 (execution and sign-off).

---

### Pitfall 6: Rollback Fantasy During Phased Cutover

**What goes wrong:**
Rollback is declared but not operationally possible once clients begin writing to Express/PostgreSQL, leading to prolonged outage risk if critical defects appear post-cutover.

**Why it happens:**
Teams defer reverse-sync/fallback design, assuming forward migration success; they discover too late that target->source synchronization is missing.

**How to avoid:**
- Decide explicitly between:
  - true reversible fallback (bidirectional sync and tested drain-back), or
  - one-way cutover with strict freeze windows and rapid forward-fix runbooks.
- Test rollback drills in staging with real migration artifacts.

**Warning signs:**
- Rollback plan exists only as prose, not executable scripts/tests.
- No validated process to move post-cutover writes back to source.
- Decommission discussions start before stability window closes.

**Phase to address:**
Phase 5 (design and drills), enforced in Phase 6/7 rollout gates, finalized in Phase 8.

---

### Pitfall 7: Polling Contract Regression After Realtime Backend Swap

**What goes wrong:**
Users see stale notes/reminders after migration because client refresh cadence and server `updatedSince` semantics are not parity-accurate.

**Why it happens:**
Convex reactive query behavior is replaced by REST polling without strict parity checks (focus-trigger sync + 30s polling + correct incremental filters/indexes).

**How to avoid:**
- Enforce polling contract as a release gate (focus + 30s for notes sync).
- Back endpoints with proper `updated_at` indexes and deterministic ordering.
- Add client/server contract tests for incremental sync windows.

**Warning signs:**
- "I edited on one device and don’t see it on another" reports.
- Backend QPS rises while freshness still degrades.
- Sync windows repeatedly return overlapping or missing ranges.

**Phase to address:**
Phase 1B (backend sync semantics), verified at Phase 6 and Phase 7 cutover.

---

### Pitfall 8: Reminder Timezone and DST Drift

**What goes wrong:**
Recurring reminders fire at wrong local times around DST changes or timezone transitions, despite appearing correct in simple tests.

**Why it happens:**
Recurrence logic is partially reimplemented or interpreted differently between worker scheduling and API update paths.

**How to avoid:**
- Reuse shared recurrence utilities only (`packages/shared`), no backend reimplementation.
- Add DST boundary test matrix (spring-forward/fall-back, timezone changes, snooze/ack interactions).
- Store timezone and recurrence source-of-truth fields consistently.

**Warning signs:**
- Reminder fire times shift by +/-1 hour around DST.
- Same reminder behaves differently between web and mobile.
- High support volume after timezone travel or DST weekends.

**Phase to address:**
Phase 2 and Phase 3.

---

### Pitfall 9: Missing Operational Guardrails for Worker/Cron Health

**What goes wrong:**
Queue lag and cron stalls go unnoticed until users report missed reminders and stale subscriptions.

**Why it happens:**
Migration focuses on feature parity, but not observability parity (lag metrics, retry saturation, stuck job detection, cron watermark health).

**How to avoid:**
- Define and alert on queue lag, retry rate, dead-letter growth, and cron watermark freshness.
- Add health probes for worker process readiness and scheduler heartbeat.
- Document on-call runbooks for replay, requeue, and safe backfill.

**Warning signs:**
- No alert before user-visible incident.
- Cron watermark unchanged beyond expected window.
- Dead-letter queue grows continuously.

**Phase to address:**
Phase 0.5 and Phase 3.

---

### Pitfall 10: Migrating Client-Local Ledgers Into Server State

**What goes wrong:**
Notification dedupe logic breaks when mobile-local `notification_ledger` semantics are moved or mirrored incorrectly in PostgreSQL, causing repeat notifications or cross-device artifacts.

**Why it happens:**
During migration, teams centralize all state in PostgreSQL and overlook intentional local-only boundaries.

**How to avoid:**
- Keep `notification_ledger` local SQLite only, as a hard architecture constraint.
- Validate server payloads do not assume server-owned ledger state.
- Add mobile regression tests for local dedupe and offline->online transitions.

**Warning signs:**
- Same reminder notification delivered repeatedly on one device.
- Device-to-device dedupe behavior changes unexpectedly.
- Server schema proposals include ledger parity tables.

**Phase to address:**
Phase 7 (mobile cutover) and checked again in Phase 8 decommission cleanup.

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reimplementing shared domain logic in backend services | Faster initial coding | Semantic drift from existing client/test assumptions | Never for parity migration |
| Skipping concurrency tests for sync/merge paths | Shorter sprint cycle | Production-only race bugs, hard rollback | Never |
| One-off manual SQL fixes during migration rehearsal | Fast visible progress | Hidden drift and non-repeatable cutover | Only for exploratory sandbox, never for release path |
| "Temporary" no-metrics worker launch | Earlier demo success | Silent job loss/lag until users report issues | Only in local dev |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| pg-boss | Assuming retries are harmless without idempotent handlers | Use stable dedupe keys + unique constraints + dead-letter monitoring |
| FCM push | Retrying all failures blindly | Classify transient vs permanent failures; remove stale tokens on terminal errors |
| Feature flags/rollout | Enabling all endpoints at once | Progressive rollout by cohort with auth/sync/error SLO gates |
| NVIDIA/AI parsing | Treating external parse as always available | Keep deterministic fallback behavior and endpoint-specific rate limits |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unindexed `updated_since` polling queries | CPU/IO spike, slow sync responses | Add composite indexes for ownership + updated timestamp + ordering | Around multi-tenant growth and frequent 30s polling |
| Large transactional sync batches without chunking | DB lock contention, long p95 latencies | Chunk sync writes and bound per-request transaction size | As concurrent mobile/web sync traffic increases |
| Queue consumers with no backpressure controls | Queue lag climbs during spikes | Configure concurrency, retry, and rate policies per queue | At first sustained reminder burst window |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Accepting user identifiers from request body as trust source after migration | Account takeover or cross-user access | Derive user identity from validated auth token/session only |
| Keeping legacy session upgrade endpoint permanently broad | Privilege abuse via stale compatibility path | Time-box and gate upgrade endpoint, add abuse detection and strict validation |
| Storing raw refresh tokens | Token replay from DB exposure | Hash refresh tokens at rest, rotate on use, revoke old token atomically |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent fallback from failed sync | Users think data is saved everywhere when it is not | Surface sync status and retry state clearly on clients |
| Forced re-auth during rollout | Perceived data loss and trust drop | Preserve legacy upgrade flow and do seamless token bootstrap |
| Reminder timing regressions | Users miss important tasks/bills | Validate timezone/DST parity before broad rollout |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Auth migration:** Often missing legacy session exchange telemetry - verify failure rate by client version and rollout cohort.
- [ ] **Notes sync parity:** Often missing replay/idempotency verification - verify duplicate payload hashes are true no-ops.
- [ ] **Worker migration:** Often missing restart/retry chaos tests - verify no duplicate or skipped reminders after worker restart.
- [ ] **Data migration:** Often missing deterministic reconcile gates - verify counts/checksums/sample parity before each environment cutover.
- [ ] **Cutover readiness:** Often missing rollback drill - verify executable fallback or explicit one-way policy with sign-off.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Auth lockout after rollout | HIGH | Disable backend auth flag cohort, restore compatibility path, replay failed upgrades, ship hotfix, re-enable gradually |
| Duplicate reminder sends | MEDIUM | Pause affected queue, deploy idempotency guard, dedupe in DB by stable key, replay only missing jobs |
| Data reconciliation drift | HIGH | Halt cutover, rerun from last checkpoint, fix mapping logic, regenerate reconcile report, re-approve gates |
| Polling freshness regressions | MEDIUM | Roll back client flag cohort, patch incremental sync query/indexes, validate with contract suite, ramp again |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Transaction semantics drift | Phase 1B, 2, 4 | Concurrency integration tests and deterministic conflict outcomes under parallel load |
| Scheduler/queue guarantee mismatch | Phase 0.5, 3 | Restart/retry tests show no duplicate or skipped domain outcomes |
| Missing transactional outbox boundary | Phase 1B/1C, 3 | Every committed domain event has exactly one relay record and traceable job lifecycle |
| Auth cutover lockout | Phase 1A, 6, 7 | Legacy clients upgrade session without forced logout; auth SLO stable during rollout |
| Incomplete data migration discipline | Phase 0, 5 | Reconcile reports pass predefined thresholds in rehearsal and production run |
| Rollback fantasy | Phase 5, 6, 7, 8 | Rollback drill completed or one-way policy formally accepted with mitigations |
| Polling contract regression | Phase 1B, 6, 7 | Focus + 30s sync gate passes in production-like environment |
| Reminder timezone/DST drift | Phase 2, 3 | DST/timezone test matrix passes for ack/snooze/recurrence cases |
| Missing worker observability | Phase 0.5, 3 | Alerts fire on synthetic lag/failure tests before user-visible impact |
| Migrating client-local ledger to server | Phase 7, 8 | Mobile dedupe regression tests pass and no server ledger coupling introduced |

## Sources

- docs/CONVEX_TO_EXPRESS_MIGRATION.md (project migration plan and phase gates)
- .planning/PROJECT.md (project constraints and non-negotiables)
- https://docs.convex.dev/functions/mutation-functions (transaction model and ordering)
- https://docs.convex.dev/functions/query-functions (consistency and deterministic behavior)
- https://docs.convex.dev/scheduling/scheduled-functions (scheduling guarantees and retries)
- https://docs.convex.dev/understanding/best-practices (anti-patterns and execution pitfalls)
- https://www.postgresql.org/docs/current/transaction-iso.html (isolation/concurrency behavior)
- https://www.postgresql.org/docs/current/sql-insert.html (atomic UPSERT and conflict handling)
- https://github.com/timgit/pg-boss and https://raw.githubusercontent.com/timgit/pg-boss/master/docs/README.md (queue capabilities, retries, DLQ, cron)
- https://microservices.io/patterns/data/transactional-outbox.html (dual-write failure mode and outbox pattern)
- https://cloud.google.com/architecture/database-migration-concepts-principles-part-2 (cutover, draining, fallback, migration failure mitigation)
- https://launchdarkly.com/docs/home/releases/percentage-rollouts (progressive rollout risk control)
- https://martinfowler.com/bliki/StranglerFigApplication.html (incremental modernization risk framing)

---
*Pitfalls research for: Convex to Express/PostgreSQL migration with phased client cutover*
*Researched: 2026-04-18*
