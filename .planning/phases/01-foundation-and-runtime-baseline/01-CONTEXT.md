# Phase 1: Foundation and Runtime Baseline - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up a production-safe backend foundation for the Express/PostgreSQL migration: fail-fast startup configuration, deterministic migrations and schema history, liveness/readiness probes, stable API error contracts, schema-first request validation boundaries, independent HTTP and worker runtime split, and early migration tooling scaffolding (export/import/reconcile with dry-run interfaces).

This phase defines how the baseline behaves. It does not implement full domain parity APIs yet.

</domain>

<decisions>
## Implementation Decisions

### Error Contract Shape
- **D-01:** Standardize non-2xx failures on a flat error object shape: `{ code, message, status, details?, traceId? }`.
- **D-02:** Include `traceId` only when one is already provided (for example via `x-request-id`), otherwise omit.
- **D-03:** Return safe structured `details` for client-correctable errors (validation/auth/conflict), but never expose internals or stack traces.
- **D-04:** For `rate_limit`, include retry metadata in payload when available (for example `retryAfterSeconds` and/or `resetAt`).

### Readiness and Startup Gates
- **D-05:** `/health/ready` must require both DB connectivity and a successful `schema_migrations` check.
- **D-06:** Startup remains fail-fast for invalid configuration and for DB unavailability during initial boot checks.
- **D-07:** Database migrations remain an explicit command/pipeline step (`migrate`) rather than auto-run during HTTP server boot.
- **D-08:** On dependency degradation after startup, keep health endpoints available and fail API requests with the stable internal error contract.

### HTTP and Worker Split Model
- **D-09:** Use two runtime entrypoints within the same backend package (API and worker) rather than splitting into separate packages in Phase 1.
- **D-10:** Share config, DB pool factory, and error utilities; keep runtime bootstrap/lifecycle wiring separate per process.
- **D-11:** In Phase 1, define pg-boss adapter interfaces plus worker boot scaffolding; defer full job execution implementation.
- **D-12:** In local development, run worker as an independent command, with optional convenience script to run API + worker in parallel.

### Migration Tooling Depth
- **D-13:** Implement CLI skeleton commands for export/import/reconcile with typed options and no-op adapters in this phase.
- **D-14:** Dry-run output must include deterministic human summary plus machine-readable JSON artifact.
- **D-15:** Define checkpoint schema and resume validation now; defer production import behavior details to later phases.
- **D-16:** Define reconciliation report contract now with counts/checksums/sampling placeholders and explicit pass/fail threshold fields.

### the agent's Discretion
- Exact field names and versioning for migration dry-run/report artifacts as long as deterministic output and threshold fields are preserved.
- Internal module layout for worker adapter/scaffold as long as runtime boundaries stay explicit.
- Exact readiness internals (query strategy, timeout tuning) as long as DB + migration-state gate semantics remain unchanged.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Migration intent and constraints
- `.planning/PROJECT.md` - Core value, migration constraints, and locked migration principles.
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md` - Migration source of truth and sequencing constraints.

### Phase scope and acceptance
- `.planning/ROADMAP.md` - Phase 1 goal, requirements mapping, and success criteria.
- `.planning/REQUIREMENTS.md` - BASE-01..BASE-07 and SHRD-01 requirement definitions.

### Runtime baseline implementation anchors
- `apps/backend/src/config.ts` - Fail-fast env validation behavior.
- `apps/backend/src/index.ts` - Current HTTP bootstrap and health route wiring.
- `apps/backend/src/middleware/error-middleware.ts` - Current AppError and error payload contract.
- `apps/backend/src/errors/catalog.ts` - Canonical error category/status mapping.
- `apps/backend/src/migrate.ts` - Deterministic migration execution and schema tracking baseline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AppError` and error middleware in `apps/backend/src/middleware/error-middleware.ts`: already centralizes error response shaping and can be extended for the locked contract.
- Error catalog in `apps/backend/src/errors/catalog.ts`: stable category-to-status definitions for contract consistency.
- Env schema validation in `apps/backend/src/config.ts`: fail-fast config guard is already implemented.
- Migration runner in `apps/backend/src/migrate.ts`: deterministic ordered SQL execution with `schema_migrations` tracking table.
- Database bootstrap helper in `apps/backend/src/db/bootstrap.ts`: ensures target database exists before migration runs.

### Established Patterns
- Startup and migration paths use explicit fail-fast behavior (`process.exit`) on invalid runtime conditions.
- Migrations are deterministic and idempotent-oriented via sorted files + applied-version table.
- Typed boundary models (TypeScript + Zod) are used for safety at runtime boundaries.
- Shared semantics are intended to come from `packages/shared` to avoid drift.

### Integration Points
- HTTP pipeline starts at `apps/backend/src/index.ts` and routes through `notFoundMiddleware` and `errorMiddleware`.
- Runtime config and DB pool are centralized in `apps/backend/src/config.ts` and `apps/backend/src/db/pool.ts`.
- Migration command entrypoint is `apps/backend/src/migrate.ts` (via backend package scripts).
- Worker scaffolding should plug into backend package scripts while reusing shared infra modules.

</code_context>

<specifics>
## Specific Ideas

No specific requirements - open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-and-runtime-baseline*
*Context gathered: 2026-04-18*
