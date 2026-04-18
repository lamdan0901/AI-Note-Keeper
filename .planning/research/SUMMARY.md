# Project Research Summary

**Project:** AI Note Keeper: Convex to Express Migration
**Domain:** Brownfield backend parity migration (Convex to Express + PostgreSQL) for a production AI notes app
**Researched:** 2026-04-18
**Confidence:** HIGH

## Executive Summary

This project is a production backend migration, not a greenfield rewrite. The product already has active web and mobile users, so the winning approach is parity-first modernization: preserve auth continuity, notes/reminder behavior, and polling contracts while replacing Convex runtime concerns with Express APIs, PostgreSQL persistence, and durable pg-boss workers. Research strongly supports a strangler-style coexistence period with feature-flagged rollout and shadow parity checks before full cutover.

The recommended implementation model is SQL-first, migration-tool-first, and operations-first. Use node-pg-migrate for reversible schema changes, implement explicit service transactions and idempotency in write paths, and build deterministic export/import/reconcile tooling from the start. Keep shared domain logic from packages/shared as a migration invariant to avoid semantic drift in recurrence, hashes, and merge behavior.

The main risks are not framework setup; they are behavioral drift under concurrency, scheduler guarantee mismatch, auth lockout during legacy session transition, and migration drift caused by weak reconciliation discipline. The mitigation strategy is clear: contract-test parity gates, outbox-style async boundaries, restart/retry worker tests, cohort-based rollout with hard SLO gates, and explicit rollback policy validation before Convex decommission.

## Key Findings

### Recommended Stack

The stack is mature and strongly validated by official documentation: Node 24 LTS, Express 5.2, PostgreSQL 17/18, TypeScript 5.4+ baseline, node-postgres for direct SQL control, node-pg-migrate for reversible DDL, and pg-boss for durable jobs/cron replacement. The migration should remain SQL-centric through parity to reduce semantic drift risk.

**Core technologies:**
- Node.js 24 LTS: runtime baseline with long support runway and compatibility with Express 5 and pg-boss
- Express 5.2: HTTP/API layer with improved async handling and current migration guidance
- PostgreSQL 17/18: transactional source of truth for auth, notes, reminders, subscriptions, and job state
- TypeScript 5.4+: type-safe contracts with lower migration churn versus language-level upgrade during parity
- node-postgres (pg) 8.20: pooled SQL access with explicit transaction control for correctness-critical paths
- node-pg-migrate 8.0: reversible migration ownership and CI migration safety gates
- pg-boss 12.15: durable queue and cron workloads with retries/dead-letter support

### Expected Features

Research converges on strict parity features as P1 launch requirements. User-visible continuity is the product outcome: auth/session upgrade compatibility, notes sync correctness (LWW + idempotency), reminder lifecycle parity, subscription/token flows, durable background processing, and deterministic migration/reconciliation. Differentiators are mostly execution quality (contract-test gates, rehearsal-first migration, shared logic reuse), not new end-user features.

**Must have (table stakes):**
- Auth/session continuity with legacy upgrade and lazy password hash migration
- Notes sync parity with LWW conflict semantics, idempotent dedupe, and focus + 30s polling behavior
- Reminder, subscription, and device token lifecycle parity
- Durable worker/cron parity for reminders and push delivery
- Deterministic export/import/reconcile tooling with rollback checkpoints
- Feature-flagged web/mobile cutover with health and error contract stability

**Should have (competitive):**
- Contract-test-driven parity gates across legacy and new backend paths
- Shared-domain-logic reuse as a formal migration invariant
- Rehearsal-first migration pipeline with measurable go/no-go thresholds
- Security-aware merge/throttle parity verification under load

**Defer (v2+):**
- Realtime transport rewrite (SSE/WebSocket)
- Non-parity product expansion unrelated to migration goals
- Server-side duplication of intentionally local mobile notification ledgers

### Architecture Approach

The strongest architecture recommendation is a transitional strangler model with edge-gated routing, thin Express route boundaries, service-level transaction orchestration, SQL repositories, dedicated worker process, parity harness, and first-class migration tooling. Keep cutover logic isolated so it can be deleted post-decommission. Run one primary backend per request with optional shadow execution for evidence; avoid long-lived dual-write.

**Major components:**
1. Feature decision router and client adapters: direct traffic by cohort/flag, preserve stable client contracts, enable instant rollback
2. Express API (routes, middleware, services, repositories): enforce validation/auth/error boundaries and transactional domain invariants
3. PostgreSQL + migrations: durable source of truth with schema evolution discipline and explicit locking/idempotency constraints
4. pg-boss worker and cron orchestration: restart-safe reminder/push execution with retries and dead-letter control
5. Parity harness and diff ledger: produce objective parity evidence and rollout gates
6. Migration pipeline (export/import/reconcile): deterministic data movement with checkpoint/resume and numeric acceptance thresholds

### Critical Pitfalls

1. **Transaction semantics drift**: prevent with explicit service transactions, lock-safe updates, UPSERT idempotency, and concurrency integration tests
2. **Queue/scheduler guarantee mismatch**: prevent with stable dedupe keys, unique constraints, retry policy separation, and restart/retry validation
3. **Missing outbox boundary (dual-write failures)**: prevent with transactional outbox records and reliable relay to queue processing
4. **Auth cutover lockout for legacy clients**: prevent with compatibility endpoint retention, lazy hash upgrade, cohort-level auth telemetry, and rollout stop conditions
5. **Weak migration reconcile discipline**: prevent with deterministic export/import, staged rehearsals, and strict count/checksum/sample pass gates

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Transitional Safety Rails
**Rationale:** Every later domain depends on common infra and cutover controls.
**Delivers:** Express skeleton, DB pool, migration baseline, error envelope, health endpoints, feature decision router, parity diff ledger scaffold.
**Addresses:** API stability, deployment safety, staged cutover capability.
**Avoids:** Big-bang switch risk, migration tooling being deferred too late.

### Phase 2: Auth Compatibility and Session Continuity
**Rationale:** User identity continuity is a hard dependency for all user-scoped domain APIs.
**Delivers:** Login/register/refresh/logout, hashed refresh storage/rotation, legacy upgrade-session bridge, lazy legacy hash upgrade telemetry.
**Addresses:** Must-have auth/session parity.
**Avoids:** Lockout during rollout and auth-related forced re-onboarding.

### Phase 3: Core Domain Parity (Notes, Subscriptions, Device Tokens, AI)
**Rationale:** Notes and adjacent domain APIs should be stabilized before worker migration.
**Delivers:** Notes sync parity (LWW + idempotency + polling contract), subscriptions/device token parity, AI parse/clarify fallback compatibility.
**Uses:** Shared domain utilities and transaction/idempotency repository patterns.
**Avoids:** Polling contract regressions and semantic drift in shared logic.

### Phase 4: Reminder and Worker Reliability Layer
**Rationale:** Reminder correctness depends on prior domain schema and parity semantics.
**Delivers:** Reminder lifecycle parity (CRUD/ack/snooze/recurrence), pg-boss job handlers, cron watermark + lookback guards, push delivery/cleanup parity.
**Implements:** Dedicated worker process and queue retry/dead-letter policies.
**Avoids:** Duplicate/missed reminders, restart-induced job loss, DST/timezone divergence.

### Phase 5: Merge-Security and Abuse Controls
**Rationale:** Merge/throttle correctness is high risk under concurrent production traffic and should be hardened before broad traffic migration.
**Delivers:** Lock-safe merge preflight/apply flows, throttle parity, abuse guardrails, concurrency stress tests.
**Addresses:** Security and correctness parity for sensitive mutation paths.
**Avoids:** Race-condition regressions and abuse-path escalation.

### Phase 6: Data Migration Rehearsal and Cutover Readiness
**Rationale:** Production cutover must be gated by numeric evidence, not confidence.
**Delivers:** Deterministic export/import/reconcile scripts, checkpoint/resume, dry-runs on production-like snapshots, go/no-go thresholds.
**Addresses:** Must-have migration safety.
**Avoids:** Silent drift and irreversible partial migrations.

### Phase 7: Cohort Rollout and Observability-Gated Traffic Shift
**Rationale:** Controlled cohort rollout lowers blast radius while validating behavior at scale.
**Delivers:** Web/mobile feature-flag rollout, shadow validation, SLO-based promotion gates, rollback execution drills.
**Addresses:** Safe migration execution and parity confirmation under live traffic.
**Avoids:** Rollback fantasy and hidden worker/cutover incidents.

### Phase 8: Convex Decommission and Transitional Cleanup
**Rationale:** Decommission should happen only after stability window and reconciliation sign-off.
**Delivers:** Legacy path retirement, transitional adapter/toggle cleanup, final audit artifacts.
**Addresses:** Long-term maintainability and architecture simplification.
**Avoids:** Premature source shutdown or permanent migration debt.

### Phase Ordering Rationale

- Auth before domain parity: all domain routes are user-scoped and require stable identity semantics first.
- Core domain parity before worker migration: worker correctness depends on stable reminder/subscription models and idempotent write behavior.
- Migration rehearsals before cohort rollout: reconciliation evidence is a required cutover gate, not a post-cutover task.
- Cohort rollout before decommission: only sustained SLO and parity stability should allow Convex retirement.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4:** DST/timezone recurrence validation matrix and queue retry policy tuning for reminder-heavy workloads
- **Phase 6:** High-volume migration strategy (batch sizing, COPY tuning, checkpoint granularity) based on real dataset profile
- **Phase 7:** Rollback strategy choice (true reversible fallback vs one-way cutover with forward-fix runbooks) and drill criteria

Phases with standard patterns (can likely skip research-phase):
- **Phase 1:** Express foundation, health probes, middleware/error contracts, and migration scaffolding are well-documented
- **Phase 2:** JWT/refresh token rotation and legacy compatibility bridge are implementation-heavy but pattern-stable
- **Phase 8:** Transitional cleanup/decommission workflow is straightforward once rollout gates are satisfied

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Mostly official vendor docs plus validated package compatibility checks |
| Features | HIGH | Derived from concrete migration plan and existing parity test scope |
| Architecture | HIGH | Consistent alignment between migration constraints and established strangler/transactional patterns |
| Pitfalls | MEDIUM | Risks are well-known but impact depends on production traffic, data volume, and client version mix |

**Overall confidence:** HIGH

### Gaps to Address

- Production data shape and volume profile: required to finalize import batching and reconcile runtime estimates during phase planning.
- Client-version distribution at rollout time: required to calibrate legacy auth bridge duration and cohort progression policy.
- Reminder load characteristics by timezone/recurrence patterns: required to tune worker concurrency and DST validation coverage.
- Explicit rollback policy decision: must be codified and tested before broad cohort rollout.

## Sources

### Primary (HIGH confidence)
- docs/CONVEX_TO_EXPRESS_MIGRATION.md: phase sequencing, parity gates, migration constraints
- .planning/PROJECT.md: scope boundaries, non-negotiables, continuity requirements
- Express official docs (expressjs.com): Express 5 baseline, migration behavior, security practices
- PostgreSQL official docs (postgresql.org/docs): transactions, locking, UPSERT/isolation behavior
- Convex official docs (docs.convex.dev): function semantics, scheduling behavior, import/export tooling
- node-postgres docs (node-postgres.com): pooling and runtime compatibility

### Secondary (MEDIUM confidence)
- pg-boss project docs/README: queue semantics, retries, cron capabilities, runtime requirements
- node-pg-migrate docs: migration model and preconditions
- Martin Fowler references on strangler and legacy displacement patterns
- LaunchDarkly rollout documentation (percentage rollout strategy)

### Tertiary (LOW confidence)
- Community/adjacent migration guidance for generalized rollback and large-scale rehearsal practices; apply only after project-specific validation

---
*Research completed: 2026-04-18*
*Ready for roadmap: yes*
