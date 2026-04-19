# Phase 4: Reminder Domain Parity - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver reminder-domain parity on Express/PostgreSQL for list/create/update/delete plus acknowledge and snooze actions, while preserving recurrence, timezone/DST correctness, and payload-hash change-event semantics.

This phase is behavior-parity implementation, not worker durability hardening or broader push reliability redesign.

</domain>

<decisions>
## Implementation Decisions

### Reminder HTTP Contract
- **D-01:** Expose dedicated reminder routes under `/api/reminders` for list/get/create/update/delete plus action endpoints for acknowledge and snooze.
- **D-02:** For missing reminders on get/update/delete/ack/snooze, keep parity-style nullable/boolean responses (HTTP 200 with null/false-style outcomes) instead of introducing 404-only behavior.
- **D-03:** Reminder listing supports optional `updatedSince` for incremental sync while preserving strict auth ownership scoping.
- **D-04:** Reminder mutation identity is always derived from the access token; request body `userId` is not trusted as authority.

### Acknowledge and Snooze State Transitions
- **D-05:** On acknowledge (`ackType=done`) for recurring reminders, preserve Convex parity: mark `done=true`, compute `nextTriggerAt` via shared recurrence, keep `scheduleStatus=scheduled` when a next occurrence exists, and unschedule when the series ends.
- **D-06:** On acknowledge for one-time reminders, honor future `snoozedUntil` first; otherwise unschedule as completed one-off behavior.
- **D-07:** Snooze applies a focused patch: set `snoozedUntil`, set `nextTriggerAt=snoozedUntil`, set `scheduleStatus=scheduled`, set `active=true`, and do not mutate recurrence definition fields.
- **D-08:** Acknowledge updates `updatedAt` and `lastAcknowledgedAt`; when recurrence advances, set `lastFiredAt` as part of the transition.

### Recurrence and Timezone Policy
- **D-09:** Use `packages/shared/utils/recurrence.ts` as the only recurrence computation source in Phase 4.
- **D-10:** Create/update writes require a valid IANA timezone value.
- **D-11:** Invalid timezone input is a validation error and must not mutate reminder state.
- **D-12:** DST behavior must match shared recurrence utility semantics exactly (including deterministic handling of DST gaps/overlaps).

### Change Events and Dedupe
- **D-13:** Preserve reminder change-event dedupe key as `(noteId, userId, operation, payloadHash)`.
- **D-14:** Write reminder change events only for effective state changes (not stale/no-op mutation attempts).
- **D-15:** Preserve immediate post-change enqueue hook behavior in this phase for parity; deeper dispatch durability changes remain Phase 5.
- **D-16:** Compute `payloadHash` server-side from normalized reminder state; use provided `deviceId` when present, otherwise default to `web`.

### Update Conflict and Canonical Patch Semantics
- **D-17:** Reminder update conflict gate is strict LWW: apply only when `incoming.updatedAt > existing.updatedAt`.
- **D-18:** Equal/older timestamp updates are deterministic no-ops and return current persisted reminder state.
- **D-19:** Repeated stale attempts remain silent idempotent (no escalation contract in Phase 4).
- **D-20:** Canonical recurrence patch semantics preserve omitted vs explicit null behavior.
- **D-21:** Canonical omitted/null rules apply to `repeat`, `startAt`, `baseAtLocal`, `nextTriggerAt`, `lastFiredAt`, and `lastAcknowledgedAt`.
- **D-22:** If `repeat` is present on update, it must be a fully valid rule object for its kind (no partial repeat merge behavior).
- **D-23:** When recurrence definition changes (`repeat`, `startAt`, or `baseAtLocal`), backend recomputes `nextTriggerAt` via shared recurrence rather than trusting client-provided value.

### the agent's Discretion
- Exact backend module split across `routes/services/repositories` as long as the locked contracts above are preserved.
- Exact naming of request/response DTOs, SQL helpers, and internal service functions.
- Exact error wording for validation/conflict paths while preserving existing error contract shape.

</decisions>

<specifics>
## Specific Ideas

- Priority is parity-first behavior, not domain redesign.
- Keep reminder transitions deterministic under retry and concurrency pressure.
- Preserve existing mobile/web compatibility expectations by avoiding semantic drift in timestamps, recurrence fields, and change-event behavior.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and migration constraints
- `.planning/ROADMAP.md` - Phase 4 goal, scope, and success criteria.
- `.planning/REQUIREMENTS.md` - REMD-01 through REMD-05 requirement definitions.
- `.planning/PROJECT.md` - Migration constraints and parity-first guardrails.
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md` - Reminder parity TODOs and exit criteria for recurrence/timezone/change-event behavior.

### Prior locked context to carry forward
- `.planning/phases/03-notes-and-adjacent-domain-api-parity/03-CONTEXT.md` - prior decisions on strict ownership, payload-hash semantics, and shared utility reuse.

### Existing reminder and recurrence source of truth
- `convex/functions/reminders.ts` - current reminder CRUD/ack/snooze behavior to mirror.
- `convex/functions/reminderChangeEvents.ts` - current reminder change-event dedupe behavior.
- `packages/shared/utils/recurrence.ts` - canonical timezone/DST-safe recurrence computation.
- `packages/shared/utils/hash.ts` - payload hash calculation utility.

### Backend parity patterns to reuse
- `apps/backend/src/runtime/createApiServer.ts` - current API mounting and middleware boundaries.
- `apps/backend/src/notes/routes.ts` - auth + validation route style to mirror for reminders.
- `apps/backend/src/notes/service.ts` - strict LWW and canonical omitted-vs-null patch semantics.
- `apps/backend/src/notes/repositories/note-change-events-repository.ts` - repository pattern for dedupe/event append.
- `apps/backend/src/db/migrations/00002_notes.sql` - reminder-capable columns in `notes` table.
- `apps/backend/src/db/migrations/00005_note_change_events.sql` - change-event storage and unique dedupe index.
- `apps/backend/src/db/migrations/00009_core_indexes.sql` - reminder query indexes (`next_trigger_at`, `snoozed_until`).

### Reminder parity contract coverage
- `tests/contract/reminders.crud.test.ts` - create/delete expectations.
- `tests/contract/reminders.list.test.ts` - list and updatedSince behavior.
- `tests/contract/reminders.update.test.ts` - update + change-event expectations.
- `tests/contract/reminders.ackReminder.test.ts` - acknowledge transition matrix and recurrence expectations.
- `tests/contract/reminders.snoozeReminder.test.ts` - snooze state transition expectations.
- `tests/integration/reminders.concurrentEdits.test.ts` - concurrency/LWW behavior expectations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/shared/utils/recurrence.ts`: canonical recurrence engine with timezone and DST handling.
- `packages/shared/utils/hash.ts`: payload-hash helper for change-event dedupe.
- `apps/backend/src/notes/repositories/note-change-events-repository.ts`: dedupe + append repository pattern.
- `apps/backend/src/notes/service.ts`: strict `>` LWW conflict gate and canonical patch semantics implementation pattern.
- `apps/backend/src/middleware/validate.ts` and route-level Zod schemas: existing request-boundary validation pattern.

### Established Patterns
- Auth user is derived from token via access middleware; ownership checks are server-enforced.
- Route handlers are thin; service and repository layers hold behavior logic.
- Non-2xx errors use one stable AppError contract.
- Change-event dedupe relies on a unique tuple and server-side payload normalization.

### Integration Points
- Mount `createRemindersRoutes(...)` in `apps/backend/src/runtime/createApiServer.ts` under `/api/reminders`.
- Implement reminder domain service/repositories alongside existing backend notes architecture.
- Reuse `notes` table reminder-capable fields plus `note_change_events` for parity behavior.
- Add phase-4 HTTP parity tests under backend test suites while keeping root contract behavior as comparison source.

</code_context>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 04-reminder-domain-parity*
*Context gathered: 2026-04-19*
