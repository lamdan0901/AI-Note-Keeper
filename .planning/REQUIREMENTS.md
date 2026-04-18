# Requirements: AI Note Keeper Convex to Express Migration

**Defined:** 2026-04-18
**Core Value:** Migrate backend infrastructure to Express/PostgreSQL with no user-facing regressions in core notes, reminders, subscriptions, and session flows.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation and Infrastructure

- [ ] **BASE-01**: Backend service starts only with valid environment configuration and fails fast with explicit startup errors on invalid configuration
- [ ] **BASE-02**: Database migrations are re-runnable and tracked with deterministic ordering and schema history
- [ ] **BASE-03**: Health endpoints expose liveness and readiness for orchestration and CI checks
- [ ] **BASE-04**: API error responses follow one stable contract across validation, auth, conflict, rate-limit, and internal failures
- [ ] **BASE-05**: Request validation is schema-first and enforced at route boundaries
- [ ] **BASE-06**: Worker process runs independently from HTTP server process for cron and queue execution

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
- [ ] **DECM-01**: Convex runtime dependencies are removed only after web and mobile stability window sign-off

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Realtime and Non-Parity Enhancements

- **V2RT-01**: Add SSE/WebSocket realtime channels after parity migration is complete
- **V2NP-01**: Introduce non-parity product enhancements only after decommission milestone

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New realtime channel during migration | Polling parity is the defined migration strategy and a hard gate |
| Non-parity product feature expansion | Migration stability and behavior parity are prioritized first |
| appwrite-functions changes | Excluded unless requested in separate scoped work |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BASE-01 | TBD | Pending |
| BASE-02 | TBD | Pending |
| BASE-03 | TBD | Pending |
| BASE-04 | TBD | Pending |
| BASE-05 | TBD | Pending |
| BASE-06 | TBD | Pending |
| AUTH-01 | TBD | Pending |
| AUTH-02 | TBD | Pending |
| AUTH-03 | TBD | Pending |
| AUTH-04 | TBD | Pending |
| AUTH-05 | TBD | Pending |
| NOTE-01 | TBD | Pending |
| NOTE-02 | TBD | Pending |
| NOTE-03 | TBD | Pending |
| NOTE-04 | TBD | Pending |
| SUBS-01 | TBD | Pending |
| SUBS-02 | TBD | Pending |
| DEVC-01 | TBD | Pending |
| AICP-01 | TBD | Pending |
| AICP-02 | TBD | Pending |
| AICP-03 | TBD | Pending |
| REMD-01 | TBD | Pending |
| REMD-02 | TBD | Pending |
| REMD-03 | TBD | Pending |
| REMD-04 | TBD | Pending |
| REMD-05 | TBD | Pending |
| JOBS-01 | TBD | Pending |
| JOBS-02 | TBD | Pending |
| JOBS-03 | TBD | Pending |
| PUSH-01 | TBD | Pending |
| PUSH-02 | TBD | Pending |
| MERG-01 | TBD | Pending |
| MERG-02 | TBD | Pending |
| MERG-03 | TBD | Pending |
| THRT-01 | TBD | Pending |
| MIGR-01 | TBD | Pending |
| MIGR-02 | TBD | Pending |
| MIGR-03 | TBD | Pending |
| MIGR-04 | TBD | Pending |
| WEB-01 | TBD | Pending |
| WEB-02 | TBD | Pending |
| MOBL-01 | TBD | Pending |
| MOBL-02 | TBD | Pending |
| DECM-01 | TBD | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 0
- Unmapped: 44 ⚠

---
*Requirements defined: 2026-04-18*
*Last updated: 2026-04-18 after initial definition*