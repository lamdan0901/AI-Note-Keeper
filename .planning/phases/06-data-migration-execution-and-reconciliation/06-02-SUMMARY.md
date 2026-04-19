---
phase: 06-data-migration-execution-and-reconciliation
plan: 02
subsystem: migration-tools
tags: [migration, import, checkpoints, idempotency]
requires:
  - phase: 06-01
    provides: deterministic export artifact and canonical entity ordering
provides:
  - Idempotent import orchestration with dry-run and checkpoint resume semantics
  - Postgres import target with table-specific conflict policies
  - Import regression suite for dry-run safety, rerun idempotency, and resume validation
affects: [migration-execution, data-safety, replay-resilience]
tech-stack:
  added: []
  patterns:
    - Canonical artifact load -> ordered flatten -> batched apply pipeline
    - Checkpoint file validation and fail-fast schema rejection
key-files:
  created:
    - apps/backend/src/migration-tools/io/json-artifact.ts
    - apps/backend/src/migration-tools/targets/postgres-import-target.ts
    - apps/backend/src/tests/migration-tools.import.test.ts
  modified:
    - apps/backend/src/migration-tools/contracts.ts
    - apps/backend/src/migration-tools/checkpoints.ts
    - apps/backend/src/migration-tools/commands/import.ts
key-decisions:
  - Import uses checkpoint processed-record offsets and lastProcessedId to resume deterministically.
  - Note change event imports preserve payload-hash dedupe using ON CONFLICT DO NOTHING semantics.
requirements-completed:
  - MIGR-02
duration: 29 min
completed: 2026-04-19
---

# Phase 06 Plan 02: Idempotent Import Summary

Import tooling now supports deterministic dry-run execution, checkpoint resume, and idempotent reruns through explicit table-level conflict policies.

## Task Commits

1. Task 1 (RED tests): a30c68a
2. Task 2 (import implementation): 9bc0235
3. Task 3 (checkpoint/parser tests): 9a9cb23
4. Post-task fix (dry-run checkpoint side-effect): 1c963cd

## Verification

- `npm --workspace apps/backend run build`
- `node --test "apps/backend/dist/tests/migration-tools.import.test.js"`
- `npm --workspace apps/backend run migration-tools -- export --dry-run --output tmp/export.json --batch-size 100`
- `npm --workspace apps/backend run migration-tools -- import --dry-run --input tmp/export.json --checkpoint tmp/import.checkpoint.json --batch-size 100`

## Deviations from Plan

- [Rule 2 - Missing Critical] Dry-run import initially persisted checkpoint files; fixed to keep dry-run side-effect free and added regression coverage in commit 1c963cd.

## Self-Check: PASSED
