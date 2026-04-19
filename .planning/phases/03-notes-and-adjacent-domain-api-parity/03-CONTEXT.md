# Phase 3: Notes and Adjacent Domain API Parity - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver Express APIs for notes and adjacent domains with parity in sync, idempotency, soft-delete/purge behavior, subscription lifecycle fields, device token persistence, and AI capture. Reminder lifecycle, cron/worker hardening, migration execution, and client cutover are separate later phases.

</domain>

<decisions>
## Implementation Decisions

### Notes sync and lifecycle

- **D-01:** Preserve the existing batch sync model rather than splitting notes into isolated CRUD-only mutations; the backend should support a sync endpoint that can process create/update/delete batches and return current server state plus sync metadata.
- **D-02:** Keep last-write-wins semantics exactly as today: apply an incoming note change only when `incoming.updatedAt > existing.updatedAt`; stale writes are no-ops.
- **D-03:** Preserve duplicate-sync idempotency by recording note change events and deduping on the payload hash contract used by the current clients.
- **D-04:** Preserve the existing canonical recurrence merge rule: fields that are omitted must leave server state unchanged, while explicit `null` clears the field.
- **D-05:** Notes trash behavior stays soft-delete first (`active=false`, `deletedAt` set) with user-scoped restore/permanent-delete/empty-trash operations; hard purge uses the existing 14-day retention cutoff.

### Subscriptions

- **D-06:** Keep subscription lifecycle behavior aligned with the current app model: create, update, trash, restore, and hard-delete are all supported, and ownership checks stay mandatory on every mutation.
- **D-07:** Derive `nextReminderAt` and `nextTrialReminderAt` server-side from `nextBillingDate`, `trialEndDate`, and `reminderDaysBefore`; the client should not be responsible for maintaining those derived fields directly.
- **D-08:** Trash purging for subscriptions follows the same 14-day retention rule as notes and remains a backend-owned cleanup concern.

### Device tokens and notification ledger

- **D-09:** Device push tokens are idempotent upserts keyed by stable `deviceId`; delete-by-deviceId is a safe no-op when the token is already gone.
- **D-10:** Keep the device-token surface aligned with the current mobile registration flow, which only emits the Android platform today; do not broaden platform semantics in this phase.
- **D-11:** `notification_ledger` stays mobile-local SQLite only. It must not be introduced as a PostgreSQL table, repository, or HTTP endpoint.

### AI capture

- **D-12:** Preserve the current voice-intent request/response contract used by mobile and web: `parseVoiceNoteIntent` and `continueVoiceClarification` should keep the same DTO shape and normalization rules.
- **D-13:** When the provider is missing or fails, return a deterministic in-process fallback instead of surfacing an error; the fallback should normalize the transcript, preserve the transcript/content retention rule, and backfill reminder/title/repeat fields when they can be derived locally.
- **D-14:** Provider responses are normalized, not passed through raw. Missing fields should be backfilled from deterministic transcript parsing where possible, and clarification output should be normalized through the same pipeline.

### the agent's Discretion

- Exact Express route naming and module split for notes, subscriptions, device tokens, and AI capture, so long as the request/response behavior above stays intact.
- Exact SQL table/index naming for the phase 3 domain models, provided they preserve the contracts already encoded by the current Convex behavior and contract tests.

</decisions>

<specifics>
## Specific Ideas

- The selected discussion stayed within the phase boundary: notes sync behavior, subscription lifecycle fields, device token idempotency, `notification_ledger` confinement, and deterministic AI fallback.
- Existing client code already expects the Convex-style note sync and AI intent DTOs, so the Express APIs should be shaped to preserve those semantics rather than redesign them.

</specifics>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and migration constraints

- `.planning/ROADMAP.md` - Phase 3 goal, dependencies, and success criteria for notes and adjacent domains.
- `.planning/REQUIREMENTS.md` - NOTE-01 through AICP-03 requirement definitions.
- `.planning/PROJECT.md` - Migration constraints, shared-package reuse rule, and the `notification_ledger` boundary.
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md` - Authoritative migration plan and locked cross-phase constraints.

### Notes behavior and sync contract

- `tests/contract/notes.crud.test.ts` - Existing sync, LWW, canonical-field, delete, and trash behavior expectations.
- `convex/functions/notes.ts` - Current Convex notes sync and trash implementation being mirrored.
- `apps/web/src/services/notes.ts` - Current web note mapping and sync helpers that define client-facing behavior.
- `apps/web/src/services/notesTypes.ts` - Canonical WebNote shape, including nullable and optional reminder fields.

### Subscriptions and device tokens

- `tests/contract/subscriptions.reminders.test.ts` - Current subscription field derivation and lifecycle behavior.
- `convex/functions/subscriptions.ts` - Current subscription CRUD and reminder-field computation logic.
- `convex/functions/deviceTokens.ts` - Current idempotent device-token upsert/delete contract.
- `apps/mobile/src/sync/registerDeviceToken.ts` - Current mobile registration payload and Android-only platform behavior.

### AI capture

- `tests/contract/aiNoteCapture.contract.test.ts` - Deterministic fallback and normalization contract for voice intent parsing.
- `convex/functions/aiNoteCapture.ts` - Current provider/fallback implementation and normalization pipeline.
- `convex/functions/aiSchemas.ts` - Voice intent request/response DTOs and validation rules.
- `apps/mobile/src/voice/types.ts` - Mobile-facing voice intent DTOs consumed by the client.
- `apps/mobile/src/voice/aiIntentClient.ts` - Current client call pattern and retry/timeout expectations.

### Shared recurrence semantics

- `packages/shared/utils/recurrence.ts` - Canonical recurrence computation used by note reminder behavior.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `packages/shared/utils/recurrence.ts`: canonical recurrence math that should be reused instead of reimplemented.
- `apps/backend/src/errors/catalog.ts` and `apps/backend/src/middleware/validate.ts`: the established error/validation pattern for new note, subscription, device-token, and AI routes.
- `apps/web/src/services/notes.ts` and `apps/mobile/src/voice/aiIntentClient.ts`: current client adapters that show how the phase-3 HTTP API needs to behave for future cutover.

### Established Patterns

- Sync semantics are batch-oriented and stateful, not simple CRUD replacements.
- Nullable versus omitted fields are semantically different in note and AI payloads; explicit `null` means clear, omission means preserve.
- Device IDs are stable identifiers, not transport tokens, and token writes should be idempotent around that key.
- AI fallback behavior is deterministic and local-first when provider config is absent or invalid.

### Integration Points

- New Express domain modules will connect through the backend runtime in `apps/backend/src/index.ts` and inherit the existing error/validation middleware pipeline.
- Web and mobile clients will later swap from Convex calls to HTTP adapters without changing the contracts captured here.
- The phase must avoid introducing any PostgreSQL persistence path for `notification_ledger`.

</code_context>

<deferred>
## Deferred Ideas

- Reminder acknowledge/snooze/recurrence worker behavior remains a later phase.
- Cron scheduling, push retry policy, and `pg-boss` worker hardening remain later phases.
- Web/mobile cutover mechanics and polling-gate enforcement remain later phases.

</deferred>

---

_Phase: 03-notes-and-adjacent-domain-api-parity_
_Context gathered: 2026-04-19_
