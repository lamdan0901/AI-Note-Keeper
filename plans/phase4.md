# Plan: Phase 4 — Subscriptions (Server Function)

## TL;DR

Create the `subscriptions-api` Appwrite Function (HTTP trigger), extract billing computation helpers to a shared module, and wire `AppwriteBackendClient` to call the new function instead of delegating to Convex. Pattern mirrors Phase 3's `reminders-api`.

---

## Steps

### Phase A — Billing utility extraction (prerequisite for function)

1. Create `packages/shared/utils/billing.ts` — extract `computeNextReminderAt(nextBillingDate, reminderDaysBefore)` and `computeAdvancedBillingDate(nextBillingDate, billingCycle, customDays?)` from `convex/functions/subscriptions.ts` (lines ~14-57). These are pure functions with no Convex-specific code.

2. Create `appwrite-functions/subscriptions-api/src/utils/billing.ts` — local copy for self-contained function deployment (mirrors how `reminders-api/src/utils/recurrence.ts` duplicates `packages/shared/utils/recurrence.ts`).

### Phase B — Appwrite Function (subscriptions-api)

3. Create `appwrite-functions/subscriptions-api/package.json` — copy from `appwrite-functions/reminders-api/package.json` verbatim (same deps: `node-appwrite`, same scripts).

4. Create `appwrite-functions/subscriptions-api/tsconfig.json` + `jest.config.js` — copy from `reminders-api/`.

5. Create `appwrite-functions/subscriptions-api/src/main.ts` — HTTP trigger. Route dispatch on `req.method + req.path`:

   | Route                                      | Handler                                                                  |
   | ------------------------------------------ | ------------------------------------------------------------------------ |
   | `GET /subscriptions?userId=`               | listActive subscriptions (`active=true`)                                 |
   | `GET /subscriptions/deleted?userId=`       | listDeleted (`active=false`) sorted by deletedAt DESC                    |
   | `POST /subscriptions`                      | create — compute `nextReminderAt`/`nextTrialReminderAt` via billing util |
   | `PATCH /subscriptions/:id`                 | update — LWW check on userId + recompute billing timestamps              |
   | `DELETE /subscriptions/:id`                | soft delete — `active=false`, stamp `deletedAt`                          |
   | `POST /subscriptions/:id/restore`          | restore — `active=true`, clear `deletedAt`                               |
   | `POST /subscriptions/:id/permanent-delete` | hard delete — only when `active=false`                                   |
   | `DELETE /subscriptions/trash?userId=`      | empty trash — delete all `active=false` for userId                       |
   - Auth: `req.headers['x-appwrite-user-id']` (injected by Appwrite). Reject 403 if userId in body/query doesn't match session. _Exception: cron-initiated paths won't have a user header — use `x-appwrite-key` presence to detect server-side context._
   - Uses `SUBSCRIPTIONS_COLLECTION = 'subscriptions'`, `DATABASE_ID = 'ai-note-keeper'` (define locally, no shared import).
   - Return shape for create: `{ id: string }` (Appwrite `$id` of new document).
   - Reference `convex/functions/subscriptions.ts` handlers 1:1 for business logic.

6. Create `appwrite-functions/subscriptions-api/src/main.test.ts` — unit tests:
   - `createSubscription` computes `nextReminderAt` and `nextTrialReminderAt`
   - `updateSubscription` recomputes billing timestamps when `nextBillingDate` or `reminderDaysBefore` changes
   - `deleteSubscription` sets `active=false` + stamps `deletedAt`
   - `listDeletedSubscriptions` returns most-recently-deleted first
   - `restoreSubscription` sets `active=true`, clears `deletedAt`
   - `permanentlyDeleteSubscription` rejects active docs (`deleted: false`)
   - `emptySubscriptionTrash` deletes all inactive docs for user

### Phase C — AppwriteBackendClient wiring

7. Modify `packages/shared/backend/appwrite.ts`:
   - Add `subscriptionsApiFunctionId?: string` to constructor params (same position pattern as `remindersApiFunctionId`).
   - Add `private async callSubscriptionsApi<T>(method, path, body?)` — identical structure to `callRemindersApi<T>()`.
   - Replace all 8 delegation calls:
     - `listSubscriptions` → `GET /subscriptions?userId=${userId}`
     - `listDeletedSubscriptions` → `GET /subscriptions/deleted?userId=${userId}`
     - `createSubscription` → `POST /subscriptions`, returns `{ id }` response → return `id`
     - `updateSubscription` → `PATCH /subscriptions/${id}`
     - `deleteSubscription` → `DELETE /subscriptions/${id}`
     - `restoreSubscription` → `POST /subscriptions/${id}/restore`
     - `permanentlyDeleteSubscription` → `POST /subscriptions/${id}/permanent-delete`
     - `emptySubscriptionTrash` → `DELETE /subscriptions/trash?userId=${userId}`
   - When `subscriptionsApiFunctionId` is falsy, fall through to `this.delegate.*` (unchanged behavior).

---

## Relevant Files

- `convex/functions/subscriptions.ts` — source of business logic to port
- `packages/shared/utils/billing.ts` — NEW: `computeNextReminderAt`, `computeAdvancedBillingDate`
- `appwrite-functions/subscriptions-api/src/utils/billing.ts` — NEW: local copy for function bundle
- `appwrite-functions/subscriptions-api/src/main.ts` — NEW: HTTP trigger
- `appwrite-functions/subscriptions-api/src/main.test.ts` — NEW: unit tests
- `appwrite-functions/subscriptions-api/package.json` — NEW
- `appwrite-functions/subscriptions-api/tsconfig.json` — NEW
- `appwrite-functions/subscriptions-api/jest.config.js` — NEW
- `packages/shared/backend/appwrite.ts` — MODIFY: add subscriptions-api wiring
- `appwrite-functions/reminders-api/src/main.ts` — reference for function pattern
- `appwrite-functions/reminders-api/package.json` — template for package.json

---

## Verification

1. `cd appwrite-functions/subscriptions-api && npm test` — all 7 handler unit tests pass
2. `cd packages/shared && npx tsc --noEmit` — no type errors in billing.ts or appwrite.ts
3. Lint: `npm run lint` from root passes with no new violations
4. Manual spot-check: in `AppwriteBackendClient`, all 8 subscription methods have if-guards that call `callSubscriptionsApi` when `subscriptionsApiFunctionId` is set, else delegate

---

## Decisions

- **Reactive `useSubscriptions()` hook deferred to Phase 6** — `BackendHooks.useSubscriptions` still via Convex; Phase 6 adds Appwrite Realtime
- **No shared package imports in function** — billing utils are duplicated locally (same pattern as recurrence.ts in reminders-api)
- **`computeNextReminderAt` / `computeAdvancedBillingDate` extracted from Convex** — not added to existing `packages/shared/utils/subscription.ts` (that file is for UI display helpers); new `billing.ts` for server-side timestamp logic
- **`createSubscription` returns `id: string`** — matches existing `BackendClient` interface which returns `Promise<string>`
- **Cron-use functions** (`getDueSubscriptionReminders`, `advanceSubscriptionAfterReminder`, etc.) are NOT exposed as HTTP routes — the Phase 5 cron function will call Appwrite DB directly using Server SDK
