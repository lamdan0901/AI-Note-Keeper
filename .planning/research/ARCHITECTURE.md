# Architecture Research

**Domain:** Backend migration architecture (Convex -> Express/PostgreSQL) for AI Note Keeper
**Researched:** 2026-04-18
**Confidence:** HIGH

## Standard Architecture

### System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                             Client + Edge Cutover Layer                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Web App Service Layer     Mobile App Service Layer     Feature Decision Router    │
│  (REST + Convex adapter)   (REST + Convex adapter)      (user/env/percent rollout) │
│         │                            │                            │                 │
├─────────┴────────────────────────────┴────────────────────────────┴─────────────────┤
│                          Transitional Backend Coexistence Layer                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Convex Runtime (legacy) <---- parity harness ----> Express API (new)              │
│       │                                      │                                      │
│  Existing schedulers                    routes -> services -> repositories          │
│                                         │            │            │                 │
│                                         │            │            └─ transaction     │
│                                         │            └─ domain rules + shared utils │
│                                         └─ auth/validation/error middleware         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                         Data + Async + Observability Layer                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL     pg-boss Worker/Cron     Reconcile Tooling     Metrics + Diff Ledger│
│  (source-of-truth target) (push/reminders) (export/import/check) (parity evidence) │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Feature Decision Router | Decide Convex vs Express per request/cohort | Edge-level toggle evaluation (env + cohort + percentage + kill switch) |
| API Adapter Layer (web/mobile) | Keep client contract stable while backend target changes | Service-level adapter exposing existing app methods |
| Convex Legacy Backend | Stable baseline behavior and rollback target during migration | Existing Convex functions/schedulers |
| Express HTTP Layer | Canonical REST contract and input/auth/error boundaries | Modular routers + middleware |
| Service Layer | Domain behavior parity, transaction orchestration, idempotency rules | Notes/Reminders/Subscriptions/Auth services |
| Repository Layer | SQL-only persistence operations, locking and indexing usage | Parameterized queries + explicit transaction boundaries |
| PostgreSQL | Durable source of truth after cutover | Normalized schema + migration-managed DDL |
| pg-boss Worker | Durable asynchronous and cron workloads | Dedicated worker process, retry/backoff, dead-letter policies |
| Parity Harness | Compare legacy and new behavior before full traffic shift | Contract tests + shadow execution + mismatch reporting |
| Data Migration Tooling | Deterministic export/import/reconcile and checkpointed cutover | Scripted ETL with dry-run and resumable checkpoints |

## Recommended Project Structure

```text
apps/
└── backend/
    ├── src/
    │   ├── routes/                 # HTTP route modules by domain
    │   ├── middleware/             # auth, validation, error, request context
    │   ├── services/               # domain orchestration and parity logic
    │   ├── repositories/           # SQL-only persistence operations
    │   ├── jobs/                   # pg-boss job handlers and cron registration
    │   ├── cutover/                # toggle evaluation, shadow execution, parity compare
    │   ├── db/                     # pool, migrations, transaction helpers
    │   └── index.ts                # app bootstrap
    ├── worker/                     # dedicated worker process entrypoint
    └── scripts/                    # operational scripts (seed/maintenance)

packages/
└── shared/                         # reused domain logic (recurrence/hash/repeat codec)

tools/
└── migration/
    ├── export-convex.ts            # deterministic extract
    ├── import-postgres.ts          # idempotent load
    └── reconcile.ts                # parity and checksum reporting

tests/
├── contract/                       # existing Convex parity contracts
├── integration-http/               # Express endpoint parity tests
└── parity/                         # shadow-run compare suites
```

### Structure Rationale

- **apps/backend/src/cutover/**: isolates transitional code so it can be deleted cleanly after Convex decommission.
- **worker/** separate from HTTP server: avoids cron lifecycle coupling to web process restarts.
- **tools/migration/**: migration runbook automation is first-class, not ad hoc scripts at final cutover.
- **tests/parity/**: dedicated evidence-producing tests reduce subjective sign-off risk.

## Architectural Patterns

### Pattern 1: Edge-Gated Strangler Router

**What:** Decide backend target at the edge (adapter/router), not inside domain services.
**When to use:** Throughout coexistence period when Convex and Express run in parallel.
**Trade-offs:** Adds temporary complexity and toggle management overhead, but gives instant rollback and safe canaries.

**Example:**
```typescript
export async function routeNotesSync(ctx: RequestContext, payload: SyncPayload) {
  const decision = cutoverDecisions.notesSync(ctx.userId, ctx.clientVersion)

  if (decision.primary === 'express') {
    const expressResult = await expressClient.syncNotes(payload, ctx.auth)
    if (decision.shadowLegacy) {
      void parity.compareInBackground('notes.sync', payload, expressResult)
    }
    return expressResult
  }

  const convexResult = await convexClient.syncNotes(payload)
  if (decision.shadowNext) {
    void parity.compareInBackground('notes.sync', payload, convexResult)
  }
  return convexResult
}
```

### Pattern 2: Contract-First Parity Harness

**What:** Run the same behavior contracts against legacy and new implementations, then add shadow comparisons in production-like traffic.
**When to use:** Before each domain cutover gate and during canary rollout.
**Trade-offs:** Extra test matrix and telemetry, but massively lowers behavioral regression risk.

**Example:**
```typescript
type BackendTarget = 'convex' | 'express'

async function executeContract(target: BackendTarget, fixture: ScenarioFixture) {
  const client = target === 'convex' ? convexContractClient : expressContractClient
  return client.runScenario(fixture)
}

export async function verifyParity(fixture: ScenarioFixture) {
  const [legacy, next] = await Promise.all([
    executeContract('convex', fixture),
    executeContract('express', fixture),
  ])

  const diff = parityDiff(legacy, next)
  if (!diff.isEquivalent) throw new Error(`Parity mismatch: ${diff.summary}`)
}
```

### Pattern 3: Transactional Service + Idempotent Event Write

**What:** Keep business invariants in service transactions and persist idempotency artifacts (payload hash/change events) with writes.
**When to use:** Notes sync, reminders mutation, and merge-throttle operations.
**Trade-offs:** Slightly heavier write path, but prevents duplicate side effects and race bugs under retries.

**Example:**
```typescript
await db.tx(async (tx) => {
  const duplicate = await noteEventsRepo.existsByPayloadHash(tx, payload.hash)
  if (duplicate) return

  const existing = await notesRepo.getForUpdate(tx, payload.noteId)
  const shouldApply = !existing || payload.updatedAt > existing.updatedAt

  if (shouldApply) {
    await notesRepo.upsert(tx, payload)
    await noteEventsRepo.insert(tx, payload.hash, payload.noteId)
  }
})
```

### Pattern 4: Reconcile-Driven Data Migration

**What:** Treat export/import/reconcile as repeatable productized pipeline, not one-shot script.
**When to use:** Early in migration and at final cutover checkpoints.
**Trade-offs:** More up-front tooling, but avoids late surprises and supports rollback evidence.

## Data Flow

### Request Flow (Cutover + Parity)

```text
[User Action]
    ↓
[Client Service Adapter]
    ↓
[Feature Decision Router]
    ├── primary=Convex ──> [Convex Function] ──> [Convex Data]
    │                          │
    │                          └── optional shadow -> [Express Endpoint] -> [PostgreSQL]
    │
    └── primary=Express ─> [Express Route] -> [Service] -> [Repository] -> [PostgreSQL]
                               │
                               └── optional shadow -> [Convex Function]

[Parity Comparator] -> [Diff Ledger + Metrics + Alerting]
```

### Async/Reminder Flow

```text
[Cron Tick / Scheduled Trigger]
    ↓
[Worker Process]
    ↓
[pg-boss Queue Poll]
    ↓
[Reminder/Subscription Job Handler]
    ↓
[PostgreSQL state transition + watermark update]
    ↓
[FCM push attempt]
    ↓
[Token cleanup/retry/backoff]
```

### Key Data Flows

1. **Auth upgrade flow:** legacy userId session -> upgrade endpoint -> JWT pair + hashed refresh token -> client continues without forced re-login.
2. **Notes sync flow:** focus/30s polling -> sync endpoint -> LWW + idempotency checks -> updated notes + tombstones.
3. **Reminder execution flow:** cron watermark scan with MAX_LOOKBACK guard -> enqueue due reminders -> push + state transition.
4. **Parity verification flow:** mirrored execution (shadow) -> canonicalized response compare -> mismatch budget gate for rollout progression.
5. **Migration flow:** Convex export -> Postgres import -> reconciliation (counts/checksum/sampling) -> go/no-go checkpoint.

## Suggested Build Order and Dependencies

1. **Transitional backbone first**
   - Build: edge toggle router, adapter seam, parity diff ledger skeleton.
   - Depends on: none.
   - Why first: enables safe parallel migration for all later domains.

2. **Express foundation + DB primitives**
   - Build: app skeleton, pool, migrations, error contract, health probes.
   - Depends on: step 1.
   - Gate: deterministic migrations and stable error envelope.

3. **Auth compatibility slice**
   - Build: login/register/refresh/logout, legacy session upgrade, lazy password rehash.
   - Depends on: step 2.
   - Gate: legacy session holders can transition without user disruption.

4. **Core write/read domains in parallel (notes, subscriptions/devices, AI)**
   - Build: notes sync parity and adjacent domain endpoints.
   - Depends on: step 3.
   - Gate: contract parity passing and shadow mismatch within threshold.

5. **Reminder domain then worker migration**
   - Build: reminders CRUD/ack/snooze, pg-boss cron jobs, FCM parity.
   - Depends on: step 4.
   - Gate: restart-safe cron behavior and duplicate-prevention evidence.

6. **Merge-security and anti-abuse controls**
   - Build: merge preflight/apply with locking + throttle parity.
   - Depends on: step 5.
   - Gate: race-condition and abuse-path tests passing.

7. **Data migration rehearsals before full traffic cutover**
   - Build: export/import/reconcile + dry run + resume checkpoints.
   - Depends on: steps 4-6.
   - Gate: reconciliation sign-off and rollback checkpoint artifacts.

8. **Traffic cutover by cohort (web/mobile), then Convex retirement**
   - Build: percentage rollout, kill switch, final reconciliation, decommission scripts.
   - Depends on: step 7.
   - Gate: sustained parity/error-rate SLO and rollback confidence.

### Dependency Graph

```text
Seam + Toggle + Parity Harness
  -> Express Foundation
    -> Auth Compatibility
      -> Notes + Subs/Devices/AI (parallel)
        -> Reminders
          -> Worker/Cron/Push
            -> Merge + Throttle
              -> Export/Import/Reconcile (rehearsed)
                -> Cohort Cutover (web + mobile)
                  -> Convex Decommission
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Single Express API + single worker, conservative pool size, simple feature-flag config via env/file |
| 1k-100k users | Horizontal API replicas, separate worker autoscaling, indexed parity ledger, cohort-based rollout automation |
| 100k+ users | Split hot domains by service boundary (jobs vs API), queue partitioning, read replicas for analytics/reconciliation, stricter SLO gates |

### Scaling Priorities

1. **First bottleneck:** DB connection pressure and long transactions during sync bursts. Fix with pool tuning, short transactions, query/index tuning.
2. **Second bottleneck:** background job contention and retry storms. Fix with queue policies, per-queue concurrency caps, dead-letter monitoring.

## Anti-Patterns

### Anti-Pattern 1: Big-Bang Backend Switch

**What people do:** Redirect all clients from Convex to Express at once.
**Why it's wrong:** no controlled blast radius, no behavioral confidence window, hard rollback under load.
**Do this instead:** edge-gated canary rollout with cohort progression and kill switch.

### Anti-Pattern 2: Domain-Level Toggle Checks Everywhere

**What people do:** sprinkle backend-target conditionals inside service/business logic.
**Why it's wrong:** migration logic leaks into permanent code, hard to delete transitional paths, high bug risk.
**Do this instead:** keep toggles at edge adapters and inject decisions inward.

### Anti-Pattern 3: Dual-Write Without Reconciliation Evidence

**What people do:** write to both systems and assume parity.
**Why it's wrong:** silent divergence accumulates and is discovered late.
**Do this instead:** single-primary-per-request + optional shadow execution + explicit diff ledger and reconciliation gates.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Convex (legacy) | Transitional adapter + shadow invocation | remove after cutover stability window |
| PostgreSQL | Connection pool + transactional repositories | use explicit locking where merge/security correctness requires |
| pg-boss | Dedicated worker polling queues and cron schedules | supports retries/backoff/dead-letter behavior |
| Firebase FCM | Job-driven push delivery with stale-token cleanup | keep push side effects out of request path |
| NVIDIA/AI provider | Service wrapper with deterministic fallback path | preserve existing fallback semantics for parity |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| routes <-> services | direct function calls + validated DTOs | routes stay thin |
| services <-> repositories | transaction context + typed repository interfaces | repositories avoid business rules |
| api process <-> worker process | pg-boss queue and shared DB | independent deploy/restart lifecycle |
| parity harness <-> telemetry | append-only diff events and metrics | creates release evidence for go/no-go |
| migration tooling <-> operational runbook | scripted checkpoints | deterministic rollback and audit trail |

## Sources

- Project migration plan and constraints: docs/CONVEX_TO_EXPRESS_MIGRATION.md (HIGH)
- Project objectives and constraints: .planning/PROJECT.md (HIGH)
- Strangler modernization and transitional architecture patterns: https://martinfowler.com/bliki/StranglerFigApplication.html (MEDIUM)
- Legacy displacement/coexistence patterns: https://martinfowler.com/articles/patterns-legacy-displacement/ (MEDIUM)
- Express routing and middleware/error handling guidance: https://expressjs.com/en/guide/routing.html and https://expressjs.com/en/guide/error-handling.html (HIGH)
- node-postgres pooling guidance: https://node-postgres.com/features/pooling (HIGH)
- PostgreSQL explicit locking and isolation semantics: https://www.postgresql.org/docs/current/explicit-locking.html and https://www.postgresql.org/docs/current/transaction-iso.html (HIGH)
- pg-boss capabilities and requirements: https://timgit.github.io/pg-boss/ and https://github.com/timgit/pg-boss (HIGH)

---
*Architecture research for: AI Note Keeper Convex to Express migration*
*Researched: 2026-04-18*
