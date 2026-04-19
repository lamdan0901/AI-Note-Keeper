---
phase: 04-reminder-domain-parity
plan: 01
subsystem: api
tags: [reminders, repository, service, lww, dedupe]
requires:
  - phase: 03-notes-and-adjacent-domain-api-parity
    provides: note_change_events dedupe primitives and auth-first route pattern
provides:
  - reminder contracts/schemas for create-update-ack-snooze payloads
  - notes-backed reminders repository with ownership predicates
  - reminder service with strict LWW, recurrence recompute, ack/snooze transitions, and change-event dedupe
  - service-level parity tests for timezone/recurrence/no-op behavior
affects: [phase-04-plan-02, phase-04-plan-03, reminders]
tech-stack:
  added: []
  patterns:
    - contracts -> repository -> service layering for reminder domain
    - strict incoming.updatedAt > existing.updatedAt LWW guard
    - dedupe before append-event and post-change callback
key-files:
  created:
    - apps/backend/src/reminders/contracts.ts
    - apps/backend/src/reminders/repositories/reminders-repository.ts
    - apps/backend/src/reminders/service.ts
    - apps/backend/src/tests/reminders/service.test.ts
  modified: []
key-decisions:
  - 'Default service dependencies load lazily to avoid module-load DB env coupling during tests.'
  - 'No-op stale/equal updates return persisted reminder without emitting change events.'
  - 'Recurrence edits recompute nextTrigger using shared recurrence utility inputs.'
requirements-completed: [REMD-01, REMD-02, REMD-03]
completed: 2026-04-19
---

# Phase 04 Plan 01: Reminder Domain Core Summary

Reminder domain core is implemented with parity-aligned contracts, persistence, LWW conflict handling, recurrence recompute, and deduped event emission.

## Accomplishments

- Added reminder payload schemas/types and canonical patch normalization helpers.
- Added ownership-scoped reminders repository on top of reminder rows in notes storage.
- Added reminder service behavior for list/get/create/update/delete/ack/snooze with strict timestamp conflict semantics.
- Added reminder service tests covering timezone validation, recurrence recompute, stale/equal no-op behavior, and ack/snooze transitions.

## Verification

- `npm --workspace apps/backend run build`
- `node --test "apps/backend/dist/tests/reminders/service.test.js"`

Both commands pass in current workspace state.

## Deviations

- Lazy dependency loading was introduced in service defaults to keep node:test isolated from runtime DB env checks.

## Next Readiness

- Route mounting and HTTP contract tests can consume this service directly in plan 04-02.
