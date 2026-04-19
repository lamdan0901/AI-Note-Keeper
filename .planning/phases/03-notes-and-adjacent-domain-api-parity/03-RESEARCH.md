# Phase 3: Notes and Adjacent Domain API Parity - Research

**Researched:** 2026-04-19
**Domain:** Express + PostgreSQL domain parity migration (notes, subscriptions, device tokens, AI capture)
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- D-01: Keep batch notes sync endpoint (not CRUD-only) returning server state and sync metadata.
- D-02: Keep LWW rule exactly: apply only when `incoming.updatedAt > existing.updatedAt`.
- D-03: Keep duplicate-sync idempotency via note change-event payload-hash dedupe.
- D-04: Keep canonical recurrence merge rule: omitted fields preserve; explicit null clears.
- D-05: Notes trash remains soft-delete first, with restore/permanent-delete/empty-trash and 14-day purge.
- D-06: Keep subscription lifecycle parity with strict ownership checks on all mutations.
- D-07: Compute `nextReminderAt` and `nextTrialReminderAt` server-side from billing/trial/reminder fields.
- D-08: Subscription trash purge follows 14-day retention and remains backend-owned cleanup.
- D-09: Device token upsert is idempotent by stable `deviceId`; delete-by-deviceId is safe no-op.
- D-10: Device-token surface remains Android-only for this phase.
- D-11: `notification_ledger` remains mobile-local SQLite only; no PostgreSQL table/repository/API.
- D-12: Keep `parseVoiceNoteIntent` and `continueVoiceClarification` DTO shapes compatible with current clients.
- D-13: On AI provider missing/failure, return deterministic local fallback (not endpoint error).
- D-14: Normalize provider output and backfill missing title/reminder/repeat fields deterministically.

### the agent's Discretion

- Exact backend module split and route names, as long as behavior parity is preserved.
- SQL index/query optimization details, as long as contracts remain intact.

### Deferred Ideas (OUT OF SCOPE)

- Reminder acknowledge/snooze/recurrence worker lifecycle behavior.
- Cron scheduling and worker hardening.
- Web/mobile cutover mechanics and polling gate enforcement.
  </user_constraints>

<research_summary>

## Summary

Phase 3 should be implemented as API-parity modules on top of the Phase 1 and Phase 2 backend foundation: route validation via zod middleware, typed service/repository boundaries, stable `AppError` envelopes, and PostgreSQL-first ownership enforcement. Existing schema migrations already include the required core tables (`notes`, `note_change_events`, `subscriptions`, `device_push_tokens`) and indexes for most parity-critical lookups.

The safest execution pattern is to build domain modules in parallel with strict file ownership and a final integration plan that mounts routes and runs parity-focused contract tests against HTTP endpoints. For notes sync, the critical behavior is batch processing with deterministic LWW and payload-hash idempotency; for subscriptions and device tokens, ownership and derived scheduling fields must remain server-owned; for AI capture, fallback and normalization paths are first-class behavior, not error paths.

**Primary recommendation:** Implement Phase 3 as four plans: (1) notes sync domain, (2) subscriptions + device tokens domain, (3) AI capture domain, (4) integration + parity verification and route mounting.
</research_summary>

<standard_stack>

## Standard Stack

### Core

| Library | Version | Purpose                   | Why Standard                           |
| ------- | ------- | ------------------------- | -------------------------------------- |
| express | ^5.2.1  | HTTP routing              | Already adopted in backend runtime     |
| pg      | ^8.20.0 | PostgreSQL access         | Existing backend persistence adapter   |
| zod     | ^4.3.6  | Route-boundary validation | Existing middleware pattern in backend |
| jose    | ^6.2.2  | JWT verification          | Existing auth token contract stack     |

### Supporting

| Library         | Version | Purpose                                          | When to Use                         |
| --------------- | ------- | ------------------------------------------------ | ----------------------------------- |
| openai          | ^6.33.0 | NVIDIA-compatible AI provider calls              | AI parse/clarify provider path      |
| @node-rs/argon2 | ^2.0.2  | Already used in auth (no new phase-3 dependency) | Shared auth continuity from Phase 2 |

### Alternatives Considered

| Instead of                 | Could Use                       | Tradeoff                                           |
| -------------------------- | ------------------------------- | -------------------------------------------------- |
| zod route validation       | Hand-rolled request checks      | Higher drift and inconsistent error contract       |
| Payload-hash dedupe table  | In-memory dedupe map            | Breaks cross-process idempotency and replay safety |
| Provider-only AI responses | Deterministic fallback pipeline | Provider outages would break capture reliability   |

**Installation:**
No new package install required for Phase 3. Reuse existing backend dependencies.
</standard_stack>

<architecture_patterns>

## Architecture Patterns

### Recommended Project Structure

```text
apps/backend/src/
  notes/
    contracts.ts
    repositories/*.ts
    service.ts
    routes.ts
  subscriptions/
    contracts.ts
    repositories/*.ts
    service.ts
    routes.ts
  device-tokens/
    contracts.ts
    repositories/*.ts
    service.ts
    routes.ts
  ai/
    contracts.ts
    service.ts
    routes.ts
    rate-limit.ts
  tests/
    notes/*.test.ts
    subscriptions/*.test.ts
    device-tokens/*.test.ts
    ai/*.test.ts
```

### Pattern 1: Repository + Service split with ownership-first methods

**What:** Repositories encapsulate SQL; services enforce ownership and parity behavior.
**When to use:** All notes/subscriptions/device-token mutations.

### Pattern 2: Batch sync transaction with explicit dedupe gate

**What:** Process each sync change in a transaction with LWW comparison and payload-hash dedupe check.
**When to use:** `POST /api/notes/sync` implementation.

### Pattern 3: Deterministic fallback-first AI normalization

**What:** Normalize provider output through one pipeline and fallback deterministically when provider unavailable.
**When to use:** `parseVoiceNoteIntent` and `continueVoiceClarification` endpoints.

### Anti-Patterns to Avoid

- Replacing batch sync with isolated CRUD endpoints (breaks D-01).
- Treating omitted and null canonical fields the same (breaks D-04).
- Returning provider failure directly to caller instead of fallback (breaks D-13).
- Creating any backend persistence/API surface for `notification_ledger` (breaks D-11).
  </architecture_patterns>

<dont_hand_roll>

## Don't Hand-Roll

| Problem                               | Don't Build                                 | Use Instead                                         | Why                                              |
| ------------------------------------- | ------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Recurrence calculations               | New recurrence engine in backend module     | `packages/shared/utils/recurrence.ts`               | Prevents parity drift across surfaces            |
| Request validation and error envelope | Per-route ad hoc validation/response format | `validateRequest` + `AppError` middleware stack     | Keeps stable API contract and checker compliance |
| Sync idempotency replay guard         | Process-local dedupe cache                  | `note_change_events` payload-hash uniqueness checks | Works across retries and concurrent workers      |

**Key insight:** Existing shared utilities and backend middleware already encode parity-critical behavior; Phase 3 should compose them, not duplicate them.
</dont_hand_roll>

<common_pitfalls>

## Common Pitfalls

### Pitfall 1: Cross-user note/subscription mutation leaks

**What goes wrong:** IDs collide or are guessed and other-user resources are modified.
**Why it happens:** Queries filter by resource ID only, not `(id, user_id)`.
**How to avoid:** Every mutation query and update must enforce `(resource_id + authenticated user_id)` ownership predicate.
**Warning signs:** Tests pass for happy path but lack cross-user collision scenarios.

### Pitfall 2: LWW and idempotency drift in sync endpoint

**What goes wrong:** Stale updates overwrite fresh state or duplicate payload replays mutate state.
**Why it happens:** Missing `updatedAt` strict comparison and no payload-hash dedupe guard.
**How to avoid:** Enforce `incoming.updatedAt > existing.updatedAt` and unique hash dedupe gate before apply.
**Warning signs:** Replay tests create duplicate events or version increments.

### Pitfall 3: AI provider coupling without deterministic fallback

**What goes wrong:** Provider outage causes endpoint failure and user flow breaks.
**Why it happens:** Service returns transport/provider error directly.
**How to avoid:** Always run deterministic fallback branch on provider missing/error, then normalize output.
**Warning signs:** Tests stub provider failure and receive non-200/exception response.
</common_pitfalls>

<code_examples>

## Code Examples

### Notes ownership query pattern

```ts
const note = await notesRepository.findByIdForUser({
  noteId,
  userId,
});
if (!note) {
  throw new AppError({ code: 'not_found', message: 'Note not found' });
}
```

### Notes sync LWW + null-vs-omitted merge pattern

```ts
if (incoming.updatedAt > existing.updatedAt) {
  const patch = {
    ...(Object.prototype.hasOwnProperty.call(incoming, 'repeat')
      ? { repeat: incoming.repeat ?? undefined }
      : {}),
    updatedAt: incoming.updatedAt,
  };
  await notesRepository.patch(existing.id, patch);
}
```

### AI fallback-first service pattern

```ts
const providerResult = await maybeCallProvider(input);
const normalized = normalizeVoiceIntentResponse(
  providerResult ?? buildTranscriptFallbackResponse(input),
  input,
);
return normalized;
```

</code_examples>

<validation_architecture>

## Validation Architecture

- Per-task fast verification: `npm --workspace apps/backend run test`
- Phase-level parity checks: run contract suites covering notes, subscriptions/device tokens, and AI capture behavior.
- Must include replay/idempotency, cross-user ownership, null-vs-omitted canonical field handling, Android-only device token assertions, and deterministic provider-failure fallback checks.
- Security checks: ensure all domain routes are authenticated, validated, and rate-limited for AI endpoints.
  </validation_architecture>

<sources>
## Sources

### Primary (HIGH confidence)

- `.planning/phases/03-notes-and-adjacent-domain-api-parity/03-CONTEXT.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `docs/CONVEX_TO_EXPRESS_MIGRATION.md`
- `convex/functions/notes.ts`
- `convex/functions/subscriptions.ts`
- `convex/functions/deviceTokens.ts`
- `convex/functions/aiNoteCapture.ts`
- `convex/functions/aiSchemas.ts`
- `tests/contract/notes.crud.test.ts`
- `tests/contract/subscriptions.reminders.test.ts`
- `tests/contract/aiNoteCapture.contract.test.ts`
- `apps/backend/src/runtime/createApiServer.ts`
- `apps/backend/src/middleware/validate.ts`
- `apps/backend/src/errors/catalog.ts`
- `apps/backend/src/db/migrations/00002_notes.sql`
- `apps/backend/src/db/migrations/00003_subscriptions.sql`
- `apps/backend/src/db/migrations/00004_device_push_tokens.sql`
- `apps/backend/src/db/migrations/00005_note_change_events.sql`

### Secondary (MEDIUM confidence)

- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/STACK.md`
- `.planning/codebase/TESTING.md`
  </sources>

---

_Phase: 03-notes-and-adjacent-domain-api-parity_
_Research completed: 2026-04-19_
_Ready for planning: yes_
