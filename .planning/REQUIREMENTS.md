# Requirements: AI Note Keeper Convex to Express Migration

**Defined:** 2026-04-18
**Core Value:** Migrate backend infrastructure to Express/PostgreSQL with no user-facing regressions in core notes, reminders, subscriptions, and session flows.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation and Infrastructure

- [x] **BASE-01**: Backend service starts only with valid environment configuration and fails fast with explicit startup errors on invalid configuration
- [x] **BASE-02**: Database migrations are re-runnable and tracked with deterministic ordering and schema history
- [x] **BASE-03**: Health endpoints expose liveness and readiness for orchestration and CI checks
- [x] **BASE-04**: API error responses follow one stable contract across validation, auth, conflict, rate-limit, and internal failures
- [x] **BASE-05**: Request validation is schema-first and enforced at route boundaries
- [x] **BASE-06**: Worker process runs independently from HTTP server process for cron and queue execution
- [x] **BASE-07**: Migration tooling scaffolding (export/import/reconcile skeleton and dry-run interfaces) exists early to enable rehearsal before final cutover
- [x] **SHRD-01**: Backend domain logic reuses canonical packages/shared utilities where applicable and does not reimplement shared semantics

### Authentication Compatibility

- [ ] **AUTH-01**: User can register with unique credentials and receive secure session tokens under JWT model
- [ ] **AUTH-02**: Existing user can log in with legacy salt:sha256 credentials and be upgraded lazily to argon2id without lockout
- [ ] **AUTH-03**: Existing client with legacy userId can exchange session identity via upgrade endpoint without forced re-authentication
- [ ] **AUTH-04**: Refresh token rotation revokes prior token and issues a new token pair on each refresh
- [ ] **AUTH-05**: Logout revokes active refresh token so future reuse is rejected

### Notes Sync Parity

- [ ] **NOTE-01**: User can list, create, update, trash, and purge notes with ownership enforcement
- [ ] **NOTE-02**: Notes sync applies last-write-wins using updatedAt precedence matching existing behavior
- [ ] **NOTE-03**: Duplicate sync payloads are idempotent via payload-hash event deduplication
- [ ] **NOTE-04**: Concurrent sync operations resolve deterministically without data corruption

### Subscriptions, AI, and Device Tokens

- [ ] **SUBS-01**: User can create, update, trash, restore, and hard-delete subscriptions with parity behavior
- [ ] **SUBS-02**: Subscription reminder scheduling fields are preserved and updated consistently
- [ ] **DEVC-01**: Device push token upsert and delete operations are idempotent with uniqueness guarantees
- [ ] **DEVC-02**: notification_ledger remains mobile-local SQLite only and is never persisted or exposed through PostgreSQL-backed APIs
- [ ] **AICP-01**: Voice parse API returns parity-compatible structure for known inputs
- [ ] **AICP-02**: Clarify API returns deterministic fallback output when provider is unavailable
- [ ] **AICP-03**: AI endpoints enforce input validation and endpoint-level rate limiting

### Reminders Parity

- [ ] **REMD-01**: User can list, create, update, and delete reminders with strict ownership and auth checks
- [ ] **REMD-02**: Acknowledge operation advances recurring reminders and unschedules one-time reminders with parity semantics
- [ ] **REMD-03**: Snooze operation updates due state and timing deterministically
- [ ] **REMD-04**: Recurrence behavior uses shared recurrence utilities and is timezone/DST safe
- [ ] **REMD-05**: Reminder change-event writes preserve payload-hash dedupe semantics

### Jobs and Push Parity

- [ ] **JOBS-01**: Cron jobs run in dedicated worker and preserve reminder scanning guard MAX_LOOKBACK_MS
- [ ] **JOBS-02**: cron_state watermark updates are durable and rely on unique key upsert semantics
- [ ] **JOBS-03**: Due reminder processing is idempotent across retries and restarts
- [ ] **PUSH-01**: Push delivery retries transient failures with defined backoff policy
- [ ] **PUSH-02**: Unregistered device tokens are cleaned up automatically on provider error responses

### Merge and Throttle Parity

- [ ] **MERG-01**: Merge preflight reports conflicts, counts, and emptiness checks consistently with legacy behavior
- [ ] **MERG-02**: Merge apply supports cloud-wins, local-wins, and merge-both strategies in explicit transaction boundaries
- [ ] **MERG-03**: Merge attempts are lock-safe under concurrency using row-level locking
- [ ] **THRT-01**: Anti-abuse throttle applies threshold and block-window behavior equivalent to existing system

### Data Migration Execution

- [ ] **MIGR-01**: Export tooling produces deterministic Convex dataset ordering for repeatable imports
- [ ] **MIGR-02**: Import tooling is idempotent and supports dry-run and checkpoint resume
- [ ] **MIGR-03**: Reconciliation reports counts, checksums, and sampling drift with explicit sign-off thresholds
- [ ] **MIGR-04**: Migration runbook includes rollback checkpoints and staging rehearsal evidence

### Client Cutover and Decommission

- [ ] **WEB-01**: Web client can operate entirely via Express APIs with 401 refresh-and-retry behavior
- [ ] **WEB-02**: Polling gate is enforced before web full cutover (focus sync and 30-second note polling contract)
- [ ] **MOBL-01**: Mobile client preserves offline outbox and LWW sync behavior while using Express APIs
- [ ] **MOBL-02**: Mobile bootstrap upgrades legacy userId sessions to JWT seamlessly
- [ ] **CUTV-01**: Cutover rollout progresses by cohorts with explicit parity/SLO gates and validated rollback drills before full traffic migration
- [ ] **DECM-01**: Convex runtime dependencies are removed only after web and mobile stability window sign-off

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Realtime and Non-Parity Enhancements

- **V2RT-01**: Add SSE/WebSocket realtime channels after parity migration is complete
- **V2NP-01**: Introduce non-parity product enhancements only after decommission milestone

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                               | Reason                                                           |
| ------------------------------------- | ---------------------------------------------------------------- |
| New realtime channel during migration | Polling parity is the defined migration strategy and a hard gate |
| Non-parity product feature expansion  | Migration stability and behavior parity are prioritized first    |
| appwrite-functions changes            | Excluded unless requested in separate scoped work                |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| BASE-01     | Phase 1 | Complete |
| BASE-02     | Phase 1 | Complete |
| BASE-03     | Phase 1 | Complete |
| BASE-04     | Phase 1 | Complete |
| BASE-05     | Phase 1 | Complete |
| BASE-06     | Phase 1 | Complete |
| BASE-07     | Phase 1 | Complete |
| SHRD-01     | Phase 1 | Complete |
| AUTH-01     | Phase 2 | Pending |
| AUTH-02     | Phase 2 | Pending |
| AUTH-03     | Phase 2 | Pending |
| AUTH-04     | Phase 2 | Pending |
| AUTH-05     | Phase 2 | Pending |
| NOTE-01     | Phase 3 | Pending |
| NOTE-02     | Phase 3 | Pending |
| NOTE-03     | Phase 3 | Pending |
| NOTE-04     | Phase 3 | Pending |
| SUBS-01     | Phase 3 | Pending |
| SUBS-02     | Phase 3 | Pending |
| DEVC-01     | Phase 3 | Pending |
| DEVC-02     | Phase 3 | Pending |
| AICP-01     | Phase 3 | Pending |
| AICP-02     | Phase 3 | Pending |
| AICP-03     | Phase 3 | Pending |
| REMD-01     | Phase 4 | Pending |
| REMD-02     | Phase 4 | Pending |
| REMD-03     | Phase 4 | Pending |
| REMD-04     | Phase 4 | Pending |
| REMD-05     | Phase 4 | Pending |
| JOBS-01     | Phase 5 | Pending |
| JOBS-02     | Phase 5 | Pending |
| JOBS-03     | Phase 5 | Pending |
| PUSH-01     | Phase 5 | Pending |
| PUSH-02     | Phase 5 | Pending |
| MERG-01     | Phase 5 | Pending |
| MERG-02     | Phase 5 | Pending |
| MERG-03     | Phase 5 | Pending |
| THRT-01     | Phase 5 | Pending |
| MIGR-01     | Phase 6 | Pending |
| MIGR-02     | Phase 6 | Pending |
| MIGR-03     | Phase 6 | Pending |
| MIGR-04     | Phase 6 | Pending |
| WEB-01      | Phase 7 | Pending |
| WEB-02      | Phase 7 | Pending |
| MOBL-01     | Phase 7 | Pending |
| MOBL-02     | Phase 7 | Pending |
| CUTV-01     | Phase 7 | Pending |
| DECM-01     | Phase 8 | Pending |

**Coverage:**

- v1 requirements: 48 total
- Mapped to phases: 48
- Unmapped: 0

---

_Requirements defined: 2026-04-18_
_Last updated: 2026-04-18 after roadmap creation_
