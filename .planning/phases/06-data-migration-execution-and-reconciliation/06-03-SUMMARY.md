---
phase: 06-data-migration-execution-and-reconciliation
plan: 03
subsystem: migration-tools
tags: [migration, reconcile, runbook, rollback]
requires:
  - phase: 06-01
    provides: deterministic export artifact structure
  - phase: 06-02
    provides: import checkpoints and idempotent execution model
provides:
  - Thresholded reconciliation command with count/checksum/sample drift metrics
  - Deterministic target snapshot loader and per-entity reconciliation outputs
  - Rollback-ready migration runbook and staging rehearsal evidence checklist
affects: [migration-signoff, production-cutover-readiness]
tech-stack:
  added: []
  patterns:
    - Fail-closed threshold evaluation for reconciliation pass/fail decisions
    - Operator runbook gating with explicit rollback checkpoints and evidence capture
key-files:
  created:
    - apps/backend/src/migration-tools/io/postgres-snapshot.ts
    - apps/backend/src/tests/migration-tools.reconcile.test.ts
    - docs/migration-runbook.md
    - .planning/phases/06-data-migration-execution-and-reconciliation/06-rehearsal-checklist.md
  modified:
    - apps/backend/src/migration-tools/contracts.ts
    - apps/backend/src/migration-tools/reporting.ts
    - apps/backend/src/migration-tools/commands/reconcile.ts
    - apps/backend/src/tests/migration-tools.test.ts
key-decisions:
  - Reconciliation compares deterministic ordered snapshots and aggregates entity-level metrics into explicit threshold-gated pass/fail output.
  - Production sign-off is blocked unless count/checksum/sample drift remain within configured limits and rehearsal evidence is complete.
requirements-completed:
  - MIGR-03
  - MIGR-04
duration: 33 min
completed: 2026-04-19
---

# Phase 06 Plan 03: Reconciliation and Runbook Summary

Reconciliation now computes real source-vs-target metrics with fail-closed thresholds, and migration operators have a rollback-ready runbook plus structured rehearsal evidence checklist.

## Task Commits

1. Task 1 (RED tests): 18089c7
2. Task 2 (reconcile implementation): d2ba229
3. Task 3 (runbook + checklist): 182bc2e

## Verification

- `npm --workspace apps/backend run build`
- `node --test "apps/backend/dist/tests/migration-tools.reconcile.test.js"`
- `Select-String -Path "docs/migration-runbook.md" -Pattern "Rollback checkpoint|Staging rehearsal evidence|Sign-off thresholds|backfillCanonicalRecurrence|backfillDeletedAt"`
- `Select-String -Path ".planning/phases/06-data-migration-execution-and-reconciliation/06-rehearsal-checklist.md" -Pattern "Dataset timestamp|Command output|Operator sign-off"`

## Deviations from Plan

None - plan executed as written.

## Self-Check: PASSED
