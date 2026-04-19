# Migration Runbook: Convex to Express/PostgreSQL

## Scope

This runbook defines the production-safe process for export/import/reconcile execution, rollback checkpoints, and sign-off decisions for Phase 06 migration operations.

## Prerequisites

- Backend dependencies installed and build passing.
- PostgreSQL migrations applied through `npm --workspace apps/backend run migrate`.
- Access to Convex export source credentials and production-safe read access.
- Staging rehearsal evidence completed and attached from `.planning/phases/06-data-migration-execution-and-reconciliation/06-rehearsal-checklist.md`.

## Dry-Run Sequence

1. Build backend tooling:

```bash
npm --workspace apps/backend run build
```

2. Export dry-run artifact:

```bash
npm --workspace apps/backend run migration-tools -- export --dry-run --output tmp/export.json --checkpoint tmp/export.checkpoint.json --batch-size 100
```

3. Import dry-run with checkpoint tracking:

```bash
npm --workspace apps/backend run migration-tools -- import --dry-run --input tmp/export.json --checkpoint tmp/import.checkpoint.json --batch-size 100
```

4. Reconcile dry-run with sign-off thresholds:

```bash
npm --workspace apps/backend run migration-tools -- reconcile --dry-run --source tmp/export.json --target tmp/target-snapshot.json --max-count-drift 0 --max-checksum-mismatch 0 --max-sample-drift 0
```

## Checkpoint Resume Procedure

- If import exits after partial progress, do not delete `tmp/import.checkpoint.json`.
- Re-run import with the same `--input` and `--checkpoint` arguments.
- Validate resumed output reports monotonically increasing `processedRecords` and preserves `lastProcessedId` continuity.
- Abort and investigate immediately if checkpoint validation fails or `resumeToken` regresses.

## Rollback Checkpoints

Rollback checkpoint 1: Pre-import database snapshot.
- Capture a PostgreSQL snapshot before first import write.
- Abort criteria: Any migration-tools validation failure before import start.

Rollback checkpoint 2: Post-batch import verification.
- After each entity batch, verify row counts and dedupe constraints.
- Abort criteria: duplicate writes detected or conflict policy mismatch in import logs.

Rollback checkpoint 3: Reconcile threshold gate.
- Reconcile must return `pass=true` and remain within configured thresholds.
- Abort criteria: any threshold breach for count drift, checksum mismatch, or sample drift.

Rollback checkpoint 4: Post-cutover smoke gate.
- Validate core auth/notes/reminders flows against Express endpoints before expanding traffic.
- Abort criteria: core flow regression or sustained non-2xx rate above SLO.

## Sign-off Thresholds

- `maxCountDrift = 0`
- `maxChecksumMismatch = 0`
- `maxSampleDrift = 0`

Any non-zero drift blocks production sign-off unless an explicit exception is approved and documented by operators.

## Backfill Verification Requirements

After import and before final sign-off, run and document parity checks for legacy Convex backfills:

- `notesMigration.backfillCanonicalRecurrence`
- `notesMigration.backfillDeletedAt`
- `subscriptionMigration.backfillDeletedAt`

Record command outputs and sample record IDs in the rehearsal checklist.

## Staging Rehearsal Evidence

Staging rehearsal evidence is mandatory before production cutover.

Required evidence bundle:
- Export checksum and entity counts.
- Import processed-record totals with checkpoint resume proof.
- Reconcile report with thresholds and pass/fail decision.
- Backfill parity verification outputs.
- Operator sign-off and timestamp.

## Incident Rollback Flow

1. Pause migration writes and stop additional import/reconcile runs.
2. Restore PostgreSQL to the latest approved rollback checkpoint snapshot.
3. Re-run reconcile in dry-run mode to confirm drift returns to expected baseline.
4. Document incident root cause and corrected procedure in the rehearsal checklist before retry.
