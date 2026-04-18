# Feature Research

**Domain:** Backend parity migration (Convex to Express/PostgreSQL) for an existing production AI notes app
**Researched:** 2026-04-18
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken during cutover.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Auth/session parity with legacy upgrade | Existing users must continue logging in without forced re-auth or lockout | HIGH | Requires JWT access + rotating refresh tokens, hashed refresh token storage, legacy `userId` session upgrade endpoint, and lazy password hash migration from legacy `salt:sha256` to `argon2id`. |
| Notes CRUD + sync parity (LWW + idempotency) | Notes are the product core; users expect no data loss or duplicate writes | HIGH | Keep last-write-wins behavior and payload-hash dedupe semantics; preserve focus + 30s polling contract before cutover. |
| Reminder lifecycle parity (CRUD, ack, snooze, recurrence) | Reminder correctness is trust-critical for retention | HIGH | Must preserve recurrence/timezone behavior from shared utilities and existing ack/snooze outcomes. |
| Subscription lifecycle parity | Subscription reminders and billing-adjacent state must remain stable | MEDIUM | Preserve trash/restore/hard-delete semantics and scheduling fields used by reminder jobs. |
| Device push token + notification delivery parity | Mobile users expect reminders to fire reliably | MEDIUM | Keep idempotent token upsert/delete behavior and stale-token cleanup on push provider responses. |
| Durable cron/job execution parity | Existing Convex cron behaviors must keep running after backend swap | HIGH | Replace scheduler/crons with pg-boss + dedicated worker; preserve `MAX_LOOKBACK_MS` guard and `cron_state.key` uniqueness semantics. |
| AI endpoint parity with deterministic fallback | Voice capture and clarification flows must not regress when provider fails | MEDIUM | Keep `/ai/parse-voice` and `/ai/clarify` compatible; preserve deterministic fallback output under provider outages. |
| Deterministic data migration tooling (export/import/reconcile) | Existing production data must be migrated safely with auditable correctness | HIGH | Start tooling early; require idempotent import, dry runs, checkpoint/resume, reconciliation, and rollback checkpoints. |
| Feature-flagged client cutover (web/mobile) | Production migrations need controlled rollout and rollback | HIGH | Ship backend swap behind flags with staged rollout (dev -> staging -> percentage -> full) and rollback guardrails. |
| Stable API error contracts + health probes | Clients and operations depend on predictable error handling and readiness signals | MEDIUM | Enforce standardized non-2xx error envelope and `/health/live` + `/health/ready` for deploy safety. |

### Differentiators (Competitive Advantage)

Features that set this migration apart from a typical backend rewrite.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Zero-friction legacy continuity path | Minimizes churn by upgrading sessions/passwords in-place rather than forcing user re-onboarding | HIGH | Combines legacy session exchange + lazy hash upgrade to avoid mass re-auth incidents during cutover. |
| Contract-test-driven parity gates | Reduces migration risk by proving HTTP behavior matches current Convex contract before cutover | MEDIUM | Convert existing contract suites to HTTP integration tests and gate rollout on parity outcomes. |
| Shared domain logic reuse as migration invariant | Prevents semantic drift in recurrence/repeat/hash logic across old/new backends | MEDIUM | Reuse `packages/shared` utilities directly instead of reimplementing logic in backend services. |
| Idempotent, rehearsal-first migration execution | Moves migration from a one-shot event to a repeatable operational practice | HIGH | Early tooling + staging rehearsals + reconciliation thresholds produce predictable cutover execution. |
| Security-aware merge/throttle parity | Preserves abuse protections and safe merge semantics under migration pressure | MEDIUM | Carry forward lock-safe migration attempts, throttle backoff constants, and merge strategy parity. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create migration risk or delay parity.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time transport rewrite (SSE/WebSocket) during migration | Team may want “modern realtime” while touching sync paths | Adds protocol and state complexity, expands blast radius, and delays parity validation | Keep polling parity first (focus + 30s), revisit realtime after stable cutover |
| Product feature expansion unrelated to parity | Stakeholders may want to bundle new UX/features with backend work | Scope creep obscures regression root causes and slows migration exit | Freeze product scope; ship parity migration first, then iterate in post-cutover phases |
| Server-side notification ledger duplication in PostgreSQL | Centralized tracking can look cleaner operationally | Conflicts with established mobile-local dedupe design and introduces cross-surface inconsistency risk | Keep `notification_ledger` mobile-local SQLite; migrate only server responsibilities |
| Big-bang cutover without feature flags | Faster on paper, less temporary code | Increases outage and rollback risk, especially across web/mobile with mixed client versions | Progressive flag rollout with rollback checkpoints and validation gates |
| Rewriting shared recurrence/hash/checklist logic | Team may assume backend “clean slate” is better | High regression risk in edge cases already encoded in shared utilities | Reuse `packages/shared` logic and treat it as migration invariant |
| In-memory timers instead of durable queue workers | Appears simpler for cron and retry flows | Fails reliability requirements across restarts/redeploys; weak retry/visibility semantics | Use pg-boss with dedicated worker process and explicit retry/backoff policy |

## Feature Dependencies

```text
[Backend foundation: config + DB pool + migrations + error contract]
    └──requires──> [Auth/session parity + legacy upgrade]
                       ├──requires──> [Notes sync parity]
                       │                 └──requires──> [Reminder/subscription/device token parity]
                       │                                    └──requires──> [Cron/job + push parity]
                       │                                                       └──requires──> [Web/mobile cutover via flags]
                       │                                                                          └──requires──> [Convex decommission]
                       └──requires──> [Merge/throttle security parity]

[Shared domain utility reuse] ──enhances──> [Notes/reminders/subscriptions parity]

[Deterministic export/import/reconcile tooling] ──blocks-until-complete──> [Production cutover]

[Realtime transport rewrite] ──conflicts──> [Parity-first migration timeline]
```

### Dependency Notes

- **Auth/session parity requires backend foundation:** token issuance, refresh rotation, and legacy upgrade endpoints depend on validated config, DB schema, and consistent error handling.
- **Notes/reminders/subscriptions depend on auth parity:** all domain routes are user-scoped and require stable identity/session semantics first.
- **Cron/job parity depends on domain parity:** workers require correct reminder/subscription models and indexes before safe scheduling.
- **Client cutover depends on worker and polling parity:** web/mobile can only switch when sync and background processing are behaviorally equivalent.
- **Convex decommission depends on successful data migration and cutover stability:** remove Convex only after reconciliation and rollout gates are met.
- **Realtime rewrite conflicts with parity-first scope:** introducing transport changes before parity undermines deterministic migration verification.

## MVP Definition

### Launch With (v1)

Minimum viable migration to maintain production continuity.

- [ ] Backend foundation (migrations, health, error contract, operational config)
- [ ] Auth/session parity with legacy upgrade and lazy password hash migration
- [ ] Notes sync parity (LWW + idempotent dedupe + polling contract)
- [ ] Reminders/subscriptions/device token parity
- [ ] Durable cron/job + push parity in dedicated worker
- [ ] Deterministic data migration tooling with reconciliation + rollback checkpoints
- [ ] Feature-flagged staged cutover for web and mobile

### Add After Validation (v1.x)

Features to add once parity cutover is stable in production.

- [ ] Operational dashboards/alerts beyond baseline health probes — add after stable SLO baseline is observed
- [ ] Performance optimization passes (query tuning, batch sizing, queue throughput tuning) — trigger after production traffic profiling

### Future Consideration (v2+)

Features to defer until migration risk is retired.

- [ ] Realtime sync transport (SSE/WebSocket) — defer until parity behavior is stable and measurable
- [ ] Net-new product capabilities unrelated to migration — defer until post-migration roadmap milestone

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Auth/session parity + legacy continuity | HIGH | HIGH | P1 |
| Notes sync parity (LWW + dedupe + polling gate) | HIGH | HIGH | P1 |
| Reminder/subscription/device token parity | HIGH | HIGH | P1 |
| Durable cron/job + push parity | HIGH | HIGH | P1 |
| Data migration export/import/reconcile + rollback checkpoints | HIGH | HIGH | P1 |
| Feature-flagged staged cutover (web/mobile) | HIGH | MEDIUM | P1 |
| Contract-test-driven parity gates | MEDIUM | MEDIUM | P2 |
| Post-cutover performance tuning | MEDIUM | MEDIUM | P2 |
| Realtime sync rewrite | LOW (for migration milestone) | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Convex-native baseline behavior | Typical rushed backend rewrite | Our Approach |
|---------|--------------------------------|-------------------------------|--------------|
| Session continuity | Existing users may carry legacy session shapes | Often forces re-auth on cutover | Preserve continuity via explicit `/auth/upgrade-session` and lazy hash upgrades |
| Sync correctness | Established LWW/idempotent semantics already trusted by users | Semantics drift common during rewrite | Preserve exact parity via shared utilities + converted contract tests |
| Background jobs | Built-in Convex cron/runtime semantics | In-memory timers or ad-hoc workers | Use durable pg-boss workers with watermark + lookback guards |
| Cutover strategy | Existing production traffic and mixed client versions | Big-bang deployment | Feature-flagged staged rollout with rollback checkpoints |
| Data migration safety | Existing dataset already in production | Late, one-shot migration scripts | Early, rehearsal-first export/import/reconcile tooling |

## Sources

- Internal migration plan: docs/CONVEX_TO_EXPRESS_MIGRATION.md
- Project requirements and constraints: .planning/PROJECT.md
- Existing parity contract references listed in migration plan: tests/contract/* (notes, reminders, subscriptions, AI capture, merge-security)

---
*Feature research for: Convex to Express/PostgreSQL parity migration*
*Researched: 2026-04-18*
