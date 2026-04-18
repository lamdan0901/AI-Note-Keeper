# Codebase Concerns

**Analysis Date:** 2026-04-17

## Tech Debt

**Dual backend reality (Convex active + Express scaffold):**

- Issue: Product behavior currently spans mature Convex logic and early Express migration modules.
- Why: Ongoing platform migration with phased parity strategy.
- Impact: High risk of drift in behavior/contracts if parity tests are not continuously migrated.
- Fix approach: Continue contract-to-HTTP migration and enforce one source of truth per domain as phases complete.

**Backend target folder split not yet populated:**

- Issue: Planned `routes/services/repositories/jobs` directories exist under `apps/backend`, but active code is mostly in `apps/backend/src`.
- Why: Foundation phase completed before full domain porting.
- Impact: Architectural intent can diverge from implementation as new code lands quickly.
- Fix approach: As each domain is ported, move to explicit route/service/repository boundaries and document conventions.

## Known Bugs / Incomplete Behavior

**Offline create integration test intentionally skipped:**

- Symptoms: `apps/mobile/tests/integration/offlineCreateSync.test.ts` is skipped and contains failing placeholder intent.
- Trigger: Running integration suite with skipped tests visible.
- Workaround: None; this is a known gap marker.
- Root cause: Offline create/outbox reconciliation path still evolving.

**Reminder outbox reliability TODO exists in headless path:**

- Symptoms: TODO in `apps/mobile/src/reminders/headless.ts` notes missing outbox push for stronger offline reliability.
- Trigger: Reminder action while offline/recovery edge cases.
- Workaround: Current sync logic may eventually reconcile, but reliability is not maximal.
- Root cause: Deferred implementation in background path.

## Security Considerations

**Sensitive token logging risk in device token flow:**

- Risk: `convex/functions/deviceTokens.ts` logs the first part of FCM tokens (`slice(0, 20)`).
- Current mitigation: Partial masking only.
- Recommendations: Remove token content from logs entirely or hash before logging.

**Legacy password hashing still present in active auth path:**

- Risk: Current Convex auth uses salted SHA-256 pattern.
- Current mitigation: Salted format and username validation.
- Recommendations: Complete migration to stronger password hashing (planned argon2id in migration doc) and ensure lazy upgrade is verified.

**Secrets management requires discipline across multiple runtimes:**

- Risk: Many env vars power AI/push/auth flows; accidental leakage or misconfiguration can break key paths.
- Current mitigation: `.env.example`, EAS docs, and runtime checks.
- Recommendations: Add CI secret scanning and centralized secret management docs per environment.

## Performance Bottlenecks

**Cron-trigger scan pressure under growth:**

- Problem: Reminder trigger scan checks due windows and may become heavy with large note volumes.
- Measurement: No checked-in p95 metrics found.
- Cause: Query/filter workload scale with active reminders despite watermark and lookback guard.
- Improvement path: Track cardinality and execution time metrics; validate indexes continuously (migration tests help).

**Push fan-out done per token with network calls in loop:**

- Problem: Large user-device fanout can increase action latency and retry churn.
- Measurement: No benchmark data checked in.
- Cause: Per-target HTTP send model with retries.
- Improvement path: Add batched observability and circuit-breaker/rate handling telemetry.

## Fragile Areas

**Reminder recurrence logic spans shared utility + Convex state transitions:**

- Why fragile: Small changes to recurrence anchors/timezone rules can alter trigger behavior globally.
- Common failures: DST edge-case regressions, duplicate/missed triggers.
- Safe modification: Change only with focused unit tests in shared utils and integration coverage in reminder flows.
- Test coverage: Utility tests exist; end-to-end cron/device behavior remains sensitive.

**Auth transition and merge flow in mobile context:**

- Why fragile: Multiple transition states (`preflight`, `awaiting-strategy`, `applying`, etc.) plus local DB/session migration.
- Common failures: Session mismatch, partial merge state, wrong userId mapping.
- Safe modification: Preserve transition-state contract and test both success/fallback paths.
- Test coverage: Unit coverage exists; full-device real-world path remains high risk.

## Scaling Limits

**Operational visibility limit:**

- Current capacity signal: Console logs only, no centralized metrics pipeline detected.
- Limit: Hard to detect gradual degradation before user-facing incidents.
- Symptoms at limit: Late detection of cron/push/sync regressions.
- Scaling path: Introduce structured logging + metrics dashboards for cron latency, push success, and sync errors.

## Dependencies at Risk

**Convex as critical runtime dependency during migration:**

- Risk: Migration work must preserve Convex behavior until complete cutover; partial divergence can create inconsistent client experiences.
- Impact: User-facing parity regressions.
- Migration plan: Continue phased parity gates and contract migration to HTTP.

**Multiple test runners across workspace:**

- Risk: Inconsistent testing ergonomics and uneven coverage expectations.
- Impact: Increased maintenance overhead and potential missed checks in CI.
- Migration plan: Define per-workspace test policy and optionally consolidate where practical.

## Missing Critical Features / Process Gaps

**CI workflow definitions are not present in repo (`.github/workflows` absent):**

- Problem: No repository-native automated gate visibility in checked files.
- Current workaround: Manual/local execution of lint/test/typecheck.
- Blocks: Reliable enforced quality/security checks on every change.
- Implementation complexity: Medium.

**Migration toolchain scaffolding exists but not yet fully operationalized for end-to-end cutover:**

- Problem: Export/import/reconcile scripts are planned but not all fully active in checked source yet.
- Current workaround: Phase-by-phase migration execution.
- Blocks: deterministic cutover rehearsal confidence.
- Implementation complexity: Medium to high.

## Test Coverage Gaps

**Offline-to-online sync edge paths:**

- What's not fully tested: Complete offline create/retry/reconcile behavior under adverse timing.
- Risk: Silent data sync drift or delayed user visibility.
- Priority: High.
- Difficulty to test: Medium (needs integration harness and deterministic timing).

**Push + cron full-loop verification under restart/retry conditions:**

- What's not fully tested: Combined watermark, retry, and dedupe behavior across process interruptions.
- Risk: Duplicate notifications or missed reminders.
- Priority: High.
- Difficulty to test: Medium to high.

---

_Concerns audit: 2026-04-17_
_Update as migration phases close gaps and concerns are resolved_
