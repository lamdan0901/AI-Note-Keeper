# Stack Research

**Domain:** Convex-backed TypeScript app migration to Express + PostgreSQL
**Researched:** 2026-04-18
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology           | Version                                                   | Purpose                       | Why Recommended                                                                                                                        |
| -------------------- | --------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js              | 24 LTS (24.x)                                             | Runtime for API and workers   | Current production-safe LTS line in 2026; satisfies Express 5 and pg-boss runtime requirements.                                        |
| Express              | 5.2.x                                                     | HTTP API framework            | Current default/stable Express line; migration path and codemods are documented; async error handling behavior is improved in v5.      |
| PostgreSQL           | 17.9+ (default), 18.3+ compatible                         | System of record              | Mature transactional core for auth/session/notes/reminders; current PostgreSQL docs show 18 current, with 17 also actively maintained. |
| TypeScript           | 5.4+ (project baseline), plan upgrade to 6.x after parity | Type-safe backend contracts   | Keeps migration incremental and low risk now; avoid language-level churn during parity work.                                           |
| node-postgres (`pg`) | 8.20.x                                                    | PostgreSQL driver and pooling | Direct SQL control for parity migration; official guidance emphasizes pooling and explicit transaction handling.                       |

### Supporting Libraries

| Library                             | Version                 | Purpose                                    | When to Use                                                                                                                       |
| ----------------------------------- | ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| node-pg-migrate                     | 8.0.x                   | SQL schema migrations                      | Use for all schema evolution and rollback scripts. Keep repositories SQL-centric, not ORM-driven, during parity phase.            |
| pg-boss                             | 12.15.x                 | Durable background jobs + cron replacement | Use for reminder scans, push fanout, purge jobs, retries, and restart-safe execution. Required for this migration's worker model. |
| zod                                 | 4.3.x                   | Request/response validation                | Use at every route boundary to preserve API contract parity and fail fast on invalid payloads.                                    |
| jose                                | 6.2.x                   | JWT signing/verification                   | Use for access + refresh token implementation in Express auth parity work.                                                        |
| argon2                              | 0.44.x                  | Password hashing                           | Use for new hashes and lazy upgrades from legacy salt:sha256 on login.                                                            |
| helmet                              | 8.1.x                   | Security headers                           | Use in production API deployment per Express security best practices.                                                             |
| rate-limiter-flexible               | 11.0.x                  | Auth brute-force protection                | Use on login/upgrade/refresh endpoints to preserve security posture during cutover.                                               |
| pino + pino-http                    | 10.3.x + 11.0.x         | Structured logs                            | Use for API + worker correlation logs and migration/reconciliation observability.                                                 |
| pg-copy-streams                     | 7.0.x                   | High-throughput imports                    | Use for large data loads from Convex exports into staging/prod PostgreSQL.                                                        |
| supertest + vitest + testcontainers | 7.2.x + 4.1.x + 11.14.x | HTTP parity and DB integration tests       | Use to convert Convex contract tests to Express HTTP parity tests against real PostgreSQL.                                        |

## Migration Tooling Profile (Prescriptive)

### 1. Schema Track

- Use node-pg-migrate for ordered, reversible migrations.
- Keep SQL-first schema ownership in migration files; avoid ORM-generated schema drift during parity.
- Add migration CI gate: `migrate up` then `migrate down` on disposable PostgreSQL.

### 2. Data Movement Track

- Primary path: `npx convex export --path ...` then transform/import to PostgreSQL.
- If dataset is large, use staged JSONL/CSV transforms with `pg-copy-streams`.
- Build three scripts from day one: `export`, `import`, `reconcile` (dry-run and resume/checkpoint support).
- Reconciliation: row counts + deterministic checksums + sampled deep record compare.

### 3. Background Work Track

- Replace Convex cron/scheduler with pg-boss queues and dedicated worker process.
- Run reminder scanning with watermark state and lookback guard (`MAX_LOOKBACK_MS`) to prevent duplicate flood after restarts.
- Enforce idempotency keys/payload hashes at job-enqueue and job-handler boundaries.

### 4. API Parity and Cutover Track

- Keep clients behind backend feature flags (web/mobile independent flags).
- Cutover sequence: dark launch -> shadow verification -> canary users -> full rollout.
- Keep rollback path ready until reconciliation and production telemetry stabilize.
- Preserve temporary compatibility endpoints (`POST /auth/upgrade-session`) until old sessions age out.

## Development Tools

| Tool                               | Purpose                                   | Notes                                                                      |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| tsx 4.21.x                         | Fast TS dev runtime                       | Keep watch-mode feedback loop tight for backend migration phases.          |
| Docker Compose                     | Local backend + PostgreSQL + worker stack | Run app and worker in separate services to match production process model. |
| Testcontainers (PostgreSQL module) | Real DB in tests                          | Use for deterministic integration tests and migration smoke tests in CI.   |
| npm audit (plus optional Snyk)     | Dependency security checks                | Add to CI for migration period due high auth/session change risk.          |

## Installation

```bash
# Core
npm install express@^5.2 pg@^8.20 zod@^4.3 jose@^6.2 argon2@^0.44 dotenv@^17

# Supporting
npm install pg-boss@^12.15 helmet@^8.1 rate-limiter-flexible@^11 pino@^10.3 pino-http@^11 pg-copy-streams@^7

# Dev dependencies
npm install -D typescript@^5.4 tsx@^4.21 node-pg-migrate@^8 vitest@^4 supertest@^7 testcontainers@^11 @types/express@^5 @types/node@^24
```

## Alternatives Considered

| Recommended                                 | Alternative                | When to Use Alternative                                                                                                               |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| node-pg-migrate                             | drizzle-kit                | Use Drizzle if you choose TS-schema-first ownership across the whole backend after parity is complete.                                |
| node-pg-migrate                             | Prisma Migrate             | Use Prisma if you are also adopting Prisma Client broadly for data access; not ideal for SQL-first parity migration.                  |
| pg-boss                                     | BullMQ + Redis             | Use BullMQ only if Redis already exists as an operational dependency and team has mature Redis ops.                                   |
| Convex CLI export/import + custom reconcile | Airbyte/Fivetran streaming | Use streaming if you need continuous sync windows or phased coexistence across long migration periods (accept beta/plan constraints). |

## What NOT to Use

| Avoid                                                                | Why                                                                                                           | Use Instead                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Express 4.x for new backend work                                     | Express 5 is now default and migration guidance is v5-focused; v4 introduces avoidable future migration debt. | Express 5.2.x                                          |
| Node 20.x / 22.x as migration baseline                               | These lines are at/near end-of-life in 2026 and shorten support runway for a long migration.                  | Node 24 LTS                                            |
| In-memory timers or `node-cron` for critical reminder delivery       | Not durable across process restarts; unsafe for parity with existing reminder guarantees.                     | pg-boss with DB-backed scheduling                      |
| ORM-first rewrite during parity (large Prisma/Drizzle refactor now)  | Increases semantic drift risk vs Convex behavior and slows cutover.                                           | SQL-first repositories + focused migration tool        |
| Long-lived dual-write (Convex + PostgreSQL) as steady-state strategy | Drift and conflict risk grows quickly; reconciliation cost becomes unbounded.                                 | Time-boxed shadow verification + single-writer cutover |

## Stack Patterns by Variant

**If migration data volume is moderate (<10M rows equivalent):**

- Use Convex CLI export zip + transform + transactional PostgreSQL import.
- Because this is simpler to reason about, easier to rehearse, and adequate for deterministic reconciliation.

**If migration data volume is high or cutover window is narrow:**

- Use batched export slices + `pg-copy-streams` imports + checkpointed resume.
- Because this reduces wall-clock import time and improves recovery from partial failures.

**If you need near-zero perceived downtime:**

- Use shadow reads and parity diff dashboards before final writer switch.
- Because it validates behavior under production traffic without committing to risky permanent dual-write.

## Version Compatibility

| Package A             | Compatible With               | Notes                                                    |
| --------------------- | ----------------------------- | -------------------------------------------------------- |
| express@5.2.x         | node@>=18                     | Express v5 migration docs require Node 18+.              |
| pg-boss@12.15.x       | node@>=22.12, postgresql@>=13 | pg-boss README requirements.                             |
| node-pg-migrate@8.0.x | node@>=20.11, postgresql@>=13 | Official preconditions in project docs.                  |
| pg@8.20.x             | node 18/20/22/24              | node-postgres compatibility guidance includes Node 24.   |
| @types/express@5.x    | express@5.x                   | Keep runtime and types aligned to avoid signature drift. |

## Sources

- https://expressjs.com/ (Express 5.2.1 current, v5 default) - HIGH
- https://expressjs.com/en/guide/migrating-5.html (Express v5 migration details, codemods, Node >=18) - HIGH
- https://expressjs.com/en/advanced/best-practice-security.html (Helmet, TLS, brute-force/rate-limit guidance) - HIGH
- https://nodejs.org/en/about/previous-releases (Node LTS/EOL schedule) - HIGH
- https://www.postgresql.org/docs/ (PostgreSQL current manuals and supported branches) - HIGH
- https://node-postgres.com/ (pooling guidance and version compatibility) - HIGH
- https://github.com/timgit/pg-boss (requirements and exactly-once queue semantics) - MEDIUM-HIGH
- https://github.com/salsita/node-pg-migrate (preconditions and migration model) - MEDIUM-HIGH
- https://docs.convex.dev/cli (official `convex export/import` commands) - HIGH
- https://docs.convex.dev/database/import-export/ (import/export capabilities and beta status) - HIGH
- https://docs.convex.dev/database/import-export/export (backup/CLI export path) - HIGH
- https://docs.convex.dev/database/import-export/import (import semantics, warnings, atomic behavior) - HIGH
- https://docs.convex.dev/production/integrations/streaming-import-export (Airbyte/Fivetran streaming options, beta/plan constraints) - HIGH
- https://node.testcontainers.org/ (Node testcontainers support for disposable PostgreSQL tests) - HIGH
- https://orm.drizzle.team/docs/migrations (Drizzle migration modes) - MEDIUM
- https://www.prisma.io/docs/orm/prisma-migrate (Prisma Migrate workflow and capabilities) - MEDIUM

---

_Stack research for: Convex to Express/PostgreSQL backend migration (AI Note Keeper)_
_Researched: 2026-04-18_
