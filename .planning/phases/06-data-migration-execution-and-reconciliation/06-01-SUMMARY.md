---
phase: 06-data-migration-execution-and-reconciliation
plan: 01
subsystem: migration-tools
tags: [migration, export, determinism]
requires: []
provides:
  - Deterministic export command with canonical entity ordering
  - Stable checksum generation for repeated export runs
  - CLI script path for migration-tools export execution
affects: [migration-rehearsal, import-readiness]
tech-stack:
  added: []
  patterns:
    - Canonical entity ordering and stable per-entity sorting
    - Deterministic dry-run artifact generation with checksum locking
key-files:
  created:
    - apps/backend/src/migration-tools/sources/ordering.ts
    - apps/backend/src/migration-tools/sources/convex-export-source.ts
    - apps/backend/src/tests/migration-tools.export.test.ts
  modified:
    - apps/backend/src/migration-tools/contracts.ts
    - apps/backend/src/migration-tools/commands/export.ts
    - apps/backend/src/migration-tools/index.ts
    - apps/backend/package.json
key-decisions:
  - Export artifacts are always written to outputPath so downstream import/reconcile commands can consume deterministic fixtures.
  - Export ordering is enforced through a canonical entity sequence and per-entity sort keys.
requirements-completed:
  - MIGR-01
duration: 22 min
completed: 2026-04-19
---

# Phase 06 Plan 01: Deterministic Export Summary

Deterministic export behavior is now implemented with canonical entity ordering, stable per-record sorting, artifact checksum repeatability, and a runnable backend CLI command path.

## Task Commits

1. Task 1 (RED tests): 3641c5c
2. Task 2 (export implementation): f360497
3. Task 3 (CLI wiring): e184144

## Verification

- `npm --workspace apps/backend run build`
- `node --test "apps/backend/dist/tests/migration-tools.export.test.js"`
- `npm --workspace apps/backend run migration-tools -- export --dry-run --output tmp/export.json --batch-size 50`

## Deviations from Plan

None - plan executed as written.

## Self-Check: PASSED
