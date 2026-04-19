# Phase 06 Research: Data Migration Execution and Reconciliation

Date: 2026-04-19
Phase: 06-data-migration-execution-and-reconciliation
Requirements: MIGR-01, MIGR-02, MIGR-03, MIGR-04

## Inputs Reviewed

- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `copilot-instructions.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/TESTING.md`
- `.planning/phases/01-foundation-and-runtime-baseline/01-03-SUMMARY.md`
- `.planning/phases/05-worker-push-merge-and-throttle-hardening/05-04-SUMMARY.md`
- `apps/backend/src/migration-tools/*`
- `apps/backend/src/tests/migration-tools.test.ts`
- `apps/backend/src/db/migrations/*.sql`
- `convex/schema.ts`
- `convex/functions/notesMigration.ts`
- `convex/functions/subscriptionMigration.ts`
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md`

## Context Gate Result

No phase-specific `06-CONTEXT.md` exists. Planning and execution should proceed using roadmap requirements, codebase facts, and migration document constraints.

## Current Baseline

- Migration runner (`apps/backend/src/migrate.ts`) is deterministic and re-runnable for SQL files.
- Migration tools (`apps/backend/src/migration-tools`) currently parse CLI options and execute no-op adapters.
- Dry-run artifacts and checksum helpers already exist (`createDryRunArtifact`).
- Checkpoint schema validation exists (`createCheckpoint`, `validateCheckpoint`) but is not connected to real import progress.
- There is no backend script yet for migration tools in `apps/backend/package.json`.

## Schema and Domain Mapping

Convex source tables to export:

1. users
2. notes
3. subscriptions
4. devicePushTokens
5. noteChangeEvents
6. cronState
7. migrationAttempts

PostgreSQL target tables:

1. users
2. notes
3. subscriptions
4. device_push_tokens
5. note_change_events
6. cron_state
7. migration_attempts
8. refresh_tokens (kept for completeness; likely empty in Convex export)

Cross-system mapping concerns:

- Convex timestamps are epoch milliseconds; PostgreSQL uses timestamptz.
- Convex `subscriptions.status` uses `cancelled`; backend contracts currently use `canceled` in some places.
- Convex `devicePushTokens` and SQL `device_push_tokens` have unique `device_id` semantics.
- Convex one-off backfills (`notesMigration`, `subscriptionMigration`) include canonical recurrence/deletedAt repair logic that should be represented in migration rehearsal/runbook checks.

## Implementation Strategy by Requirement

### MIGR-01 Deterministic Convex export ordering

- Create canonical dataset contract with explicit entity order and stable per-entity sort keys.
- Implement deterministic serializer that normalizes object keys recursively.
- Export should produce identical checksums for identical source data across repeated runs.
- Export artifact should include metadata: generatedAt, command, source cursor/token, entity counts, checksum.

### MIGR-02 Idempotent import with dry-run and checkpoint resume

- Implement import pipeline with:
  - dry-run mode (no DB writes)
  - checkpoint write/read hooks (resumeToken, processedRecords, lastProcessedId)
  - idempotent upsert semantics (`ON CONFLICT` + deterministic update fields)
- Import batching must preserve deterministic order of records from export.
- Re-running import with the same artifact should not duplicate rows or drift materialized values.

### MIGR-03 Reconciliation counts/checksums/sampling with thresholds

- Implement reconciliation command over source export and target snapshot:
  - row counts by entity
  - deterministic checksums by entity and global rollup
  - sampling drift over deterministic sample slice (e.g., every Nth record or hash-bucket sampling)
- Use threshold contract already defined in `ReconcileThresholds` and produce explicit pass/fail.

### MIGR-04 Rollback-ready runbook and staging rehearsal evidence

- Add runbook doc with:
  - pre-flight checklist
  - dry-run rehearsal steps
  - production execution steps
  - rollback checkpoints with hard stop conditions
  - sign-off template for thresholds and sample drift
- Add rehearsal evidence template/checklist under `.planning/phases/06...` so execution summary can link objective proof artifacts.

## Security and Reliability Risks

1. PII leakage risk in export artifacts.
- Mitigation: include strict output path policy, avoid logging record payloads, and document artifact handling.

2. Replay/import duplication risk.
- Mitigation: idempotent conflict handling and checkpoint continuity checks.

3. Partial import failure causing inconsistent target state.
- Mitigation: per-batch transactions, checkpoint only after successful commit, and resume from last committed boundary.

4. False-positive reconciliation.
- Mitigation: combine count, checksum, and sample drift; fail closed when thresholds exceeded.

## Recommended Plan Split

- Plan 06-01: deterministic export and canonical artifact contract.
- Plan 06-02: idempotent import with checkpoint resume and dry-run parity.
- Plan 06-03: reconciliation scoring plus rollback-ready runbook and staging rehearsal evidence templates.

This split aligns with requirement boundaries and avoids shared-file conflicts across same-wave plans.

## Validation Architecture

### Tooling

- Framework: node:test (compiled TS tests under `apps/backend/dist/tests/**/*.test.js`)
- Quick command: `npm --workspace apps/backend run build ; node --test "apps/backend/dist/tests/migration-tools*.test.js"`
- Full command: `npm --workspace apps/backend run test`
- Lint/type gate: `npm run lint` and `npm --workspace apps/backend run build`

### Sampling Strategy

- After each migration-tools task commit: run quick migration-tools tests.
- After each plan completion: run backend full test command.
- Before phase verification: run backend full suite + root lint.

### Required New Tests

- `apps/backend/src/tests/migration-tools.export.test.ts`
- `apps/backend/src/tests/migration-tools.import.test.ts`
- `apps/backend/src/tests/migration-tools.reconcile.test.ts`

### Acceptance Signals

- Deterministic repeated export checksum equality.
- Import re-run leaves row counts and checksums unchanged.
- Reconciliation report contains explicit `pass`/`fail` with threshold fields and per-entity metrics.
- Runbook includes rollback checkpoints and staged rehearsal evidence capture section.

## Recommendation

Research indicates implementation can proceed with existing stack and patterns (Level 0 domain extension + existing dependency reuse). No new external dependency is required.
