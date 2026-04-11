# Plan: Migrate Convex Backend to Appwrite

## TL;DR

Replace Convex (BaaS) with Appwrite Cloud. Migrate 7 tables, 30+ functions, 4 crons, FCM push, and AI voice. Use incremental dual-write transition.

**Key design changes from v1 review:**

1. **Local identity preserved** — Appwrite Anonymous sessions replace device UUID, with the same promote-on-login / snapshot-on-logout lifecycle
2. **Notes + reminders are one migration track** — single unified collection, never split
3. **Write-heavy flows stay server-side** — syncNotes, reminder mutations, merge are Appwrite Functions, not client SDK calls
4. **Adapter layer first** — a `BackendClient` abstraction wraps all 8 ConvexHttpClient sites + 2 React hook entry points before any Appwrite code is written

---

## Phase 0: Backend Adapter Layer (pre-requisite for everything)

**Goal**: Decouple all code from Convex SDK before writing any Appwrite code. This creates a seam where the backend can be swapped without touching consumers.

**Steps**:

1. Define `BackendClient` interface in `packages/shared/backend/types.ts` with methods matching every imperative and reactive Convex call:
   - **Auth**: `login(username, password)`, `register(username, password)`, `validateSession(userId)`
   - **Notes**: `getNotes(userId)`, `syncNotes(userId, changes, lastSyncAt)` — returns `{ notes, syncedAt }` (server-authoritative)
   - **Reminders**: `getReminder(id)`, `listReminders(updatedSince?)`, `createReminder(data)`, `updateReminder(id, patch)`, `deleteReminder(id)`, `ackReminder(id, ackType, opts)`, `snoozeReminder(id, snoozedUntil, opts)`
   - **Subscriptions**: `listSubscriptions(userId)`, `listDeletedSubscriptions(userId)`, `createSubscription(data)`, `updateSubscription(id, patch)`, `deleteSubscription(id)`, `restoreSubscription(id)`, `permanentlyDeleteSubscription(id)`, `emptySubscriptionTrash(userId)`
   - **Push tokens**: `upsertDevicePushToken(data)`
   - **Merge**: `preflightUserDataMerge(from, to, username, password)`, `applyUserDataMerge(from, to, strategy)`
   - **Voice AI**: `parseVoiceNoteIntent(data)`, `continueVoiceClarification(data)`
   - **Reactive**: `subscribeNotes(userId, onChange)`, `subscribeSubscriptions(userId, onChange)` — returns unsubscribe function
2. Create `ConvexBackendClient` implementing `BackendClient` — wraps existing Convex HTTP/React client calls 1:1. No behavior change.
3. Update all 8 imperative sites + 2 React entry points to use `BackendClient`:

| Site           | File                                                                                  | Current Pattern                                                     |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Auth (mobile)  | `apps/mobile/src/auth/AuthContext.tsx` (lines 102, 208, 323, 377, 434, 462, 520)      | `getConvexClient().mutation(api.functions.auth.*)`                  |
| Auth (web)     | `apps/web/src/auth/AuthContext.tsx` (lines 64, 133-152, 174-194, 301)                 | `getClient().mutation(api.functions.auth.*)`                        |
| Sync processor | `apps/mobile/src/sync/syncQueueProcessor.ts` (line 205, 307)                          | `client.mutation(api.functions.notes.syncNotes)`                    |
| Fetch notes    | `apps/mobile/src/sync/fetchNotes.ts` (line 30, 38)                                    | `client.query(api.functions.notes.getNotes)`                        |
| Fetch reminder | `apps/mobile/src/sync/fetchReminder.ts` (line 31, 40)                                 | `client.query(api.functions.reminders.getReminder)`                 |
| Device token   | `apps/mobile/src/sync/registerDeviceToken.ts` (line 175, 177)                         | `client.mutation(api.functions.deviceTokens.upsertDevicePushToken)` |
| Headless ack   | `apps/mobile/src/reminders/headless.ts` (line 65, 122)                                | `client.mutation(api.functions.reminders.ackReminder)`              |
| Voice AI       | `apps/mobile/src/voice/aiIntentClient.ts` (line 87, 113, 127)                         | `client.action(api.functions.aiNoteCapture.*)`                      |
| React notes    | `apps/mobile/src/notes/realtimeService.ts` + `apps/web/src/services/notes.ts`         | `useQuery(api.functions.notes.getNotes)`                            |
| React subs     | `apps/mobile/src/subscriptions/service.ts` + `apps/web/src/services/subscriptions.ts` | `useQuery(api.functions.subscriptions.list*)`                       |

4. Provide `BackendClient` via React Context (for hook consumers) and as injectable parameter (for imperative consumers like `syncQueueProcessor`, `headless.ts`)
5. Verify: all existing tests pass, app behavior unchanged

**Relevant files**:

- NEW `packages/shared/backend/types.ts` — `BackendClient` interface
- NEW `packages/shared/backend/convex.ts` — `ConvexBackendClient` (wrapper, no behavior change)
- MODIFY all 10 sites listed above to consume `BackendClient` instead of raw Convex SDK

---

## Phase 1: Appwrite Project Setup & Schema

**Goal**: Create Appwrite Cloud project, database, collections matching Convex schema.

**Steps**:

1. Create Appwrite Cloud project, add `appwrite` SDK to root/mobile/web packages
2. Shared client config at `packages/shared/appwrite/client.ts` — reads `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`
3. Create database `ai-note-keeper` with 6 collections:

| Convex Table        | Appwrite Collection | Notes                                                                         |
| ------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `users`             | **Appwrite Auth**   | No collection — Auth service manages users                                    |
| `notes`             | `notes`             | **Unified notes+reminders** — single collection, all reminder fields included |
| `noteChangeEvents`  | `noteChangeEvents`  | Audit trail                                                                   |
| `subscriptions`     | `subscriptions`     | Billing reminder subscriptions                                                |
| `devicePushTokens`  | `devicePushTokens`  | FCM tokens                                                                    |
| `cronState`         | `cronState`         | Cron watermarks                                                               |
| `migrationAttempts` | `migrationAttempts` | Merge throttle state                                                          |

4. Define attributes + indexes via `scripts/setup-appwrite-schema.ts` using Appwrite Server SDK
5. **Nested objects** (`repeat`/RepeatRule, `repeatConfig`): stored as JSON string attributes — Appwrite has no nested object type
6. **Document IDs**: use existing UUID `id` field as Appwrite document `$id` for notes. Generate UUIDs for other collections.
7. **Permissions**: `Permission.read/write(Role.user(userId))` per document — enforced by Appwrite Auth

**Relevant files**:

- NEW `packages/shared/appwrite/client.ts`
- NEW `packages/shared/appwrite/collections.ts` — collection ID constants
- NEW `packages/shared/appwrite/types.ts` — TypeScript document types
- NEW `scripts/setup-appwrite-schema.ts`
- MODIFY root + mobile + web `package.json` — add `appwrite`

---

## Phase 2: Identity & Auth Migration

**Goal**: Replace custom SHA256 auth with Appwrite Auth while preserving the local-install identity model.

### The local identity lifecycle (must be preserved):

- **Unauthenticated**: app uses device UUID as `userId`, data stored locally in SQLite + synced to cloud under that ID
- **Login**: `preflightUserDataMerge(deviceId → accountId)` → strategy resolution → `applyUserDataMerge()` → data promoted to account namespace
- **Logout**: `applyUserDataMerge(accountId → deviceId, 'local')` → cloud data snapshotted back to device namespace → reset to device UUID

### Appwrite replacement:

1. **Anonymous sessions** for unauthenticated state: Appwrite supports `account.createAnonymousSession()` — creates a real Appwrite user with `$id`, no credentials required. This becomes the device identity.
   - On first app launch → `account.createAnonymousSession()` → store returned `$id` as device userId
   - All documents created under this anonymous user get `Permission.read/write(Role.user(anonUserId))`
   - Anonymous user persists across app restarts (session cookie in Appwrite SDK)
2. **Login converts anonymous → credentialed**: Appwrite `account.updateEmail()` + `account.updatePassword()` converts anonymous account to email/password account. But this doesn't help with _merging into an existing account_. For the merge case:
   - Keep the two-phase merge flow as an Appwrite Function: `preflightUserDataMerge(fromAnonId, toAccountId)` → `applyUserDataMerge(fromAnonId, toAccountId, strategy)`
   - After merge: delete anonymous session, create email/password session for target account
3. **Logout → snapshot back**: Call Appwrite Function `applyUserDataMerge(accountId → newAnonId, 'local')`, then `account.deleteSessions()` + `account.createAnonymousSession()` for fresh device identity
4. **Username→email mapping**: Appwrite requires email. Use synthetic `{username}@app.notekeeper.local` — preserves current UX. Store original `username` in Appwrite user `name` field.
5. **Password hashing**: Appwrite handles hashing internally. No SHA256 concern for new registrations. Existing users → force password reset during data migration (Phase 7).

**Relevant files**:

- NEW `packages/shared/appwrite/auth.ts` — `register()`, `login()`, `validateSession()`, `logout()`, `createAnonymousSession()`
- MODIFY `apps/mobile/src/auth/AuthContext.tsx` — replace Convex auth calls, preserve merge lifecycle
- MODIFY `apps/web/src/auth/AuthContext.tsx` — same
- MODIFY `apps/mobile/src/auth/session.ts` — `resolveCurrentUserId()` now checks Appwrite session

---

## Phase 3: Notes + Reminders (Unified Server Functions)

**Goal**: Migrate all notes AND reminders as one track — they are the same `notes` collection.

### Why server-side, not client-side:

- `syncNotes` is an atomic batched operation: processes N changes, emits N change events, returns authoritative state. Client-side writes can't replicate this atomicity.
- Reminder mutations (create/update/delete/ack/snooze) write the note + emit change event + enqueue push notification. Three writes that must succeed together.
- `syncQueueProcessor` (mobile offline sync) depends on server returning canonical `notes[]` + `syncedAt` after batch processing.

### Steps:

1. Create Appwrite Function `notes-sync` (HTTP trigger):
   - Receives `{ userId, changes[], lastSyncAt }` — same contract as `convex/functions/notes.ts syncNotes`
   - Uses Appwrite Server SDK: `databases.listDocuments()`, `createDocument()`, `updateDocument()`, `deleteDocument()`
   - Implements last-write-wins conflict resolution
   - Emits `noteChangeEvents` documents
   - Returns `{ notes: Note[], syncedAt: number }` — server-authoritative response
   - Reference: port logic from `convex/functions/notes.ts` lines 14-165

2. Create Appwrite Function `reminders-api` (HTTP trigger, multiple routes):
   - `GET /reminder/:id` — single reminder fetch
   - `GET /reminders?updatedSince=` — list with filter
   - `POST /reminder` — create: write note + change event + call push function
   - `PATCH /reminder/:id` — update: LWW check + recalculate `nextTriggerAt` + change event + push
   - `DELETE /reminder/:id` — delete: hard delete + change event + push
   - `POST /reminder/:id/ack` — ack: compute next occurrence (if recurring) or mark done + change event + push
   - `POST /reminder/:id/snooze` — snooze: set `snoozedUntil`/`nextTriggerAt` + change event + push
   - Reference: port logic from `convex/functions/reminders.ts`

3. Extract shared recurrence logic to `packages/shared/utils/recurrence.ts` — used by both the Appwrite Function and mobile local computation. Currently embedded in `convex/functions/reminders.ts`.

4. Create `AppwriteBackendClient` (implements `BackendClient` from Phase 0):
   - `getNotes()` → call `notes-sync` function or direct `databases.listDocuments()`
   - `syncNotes()` → call `notes-sync` function endpoint
   - All reminder methods → call `reminders-api` function endpoints
   - Reactive `subscribeNotes()` → `databases.listDocuments()` + Appwrite Realtime subscription on `databases.ai-note-keeper.collections.notes.documents`

5. Plug `AppwriteBackendClient` into consumers via feature flag — Phase 0 adapter makes this a config swap

**Relevant files**:

- NEW `appwrite-functions/notes-sync/` — `src/main.ts` + `package.json`
- NEW `appwrite-functions/reminders-api/` — `src/main.ts` + `package.json`
- NEW `packages/shared/utils/recurrence.ts` — extracted from `convex/functions/reminders.ts`
- NEW `packages/shared/backend/appwrite.ts` — `AppwriteBackendClient` implementing `BackendClient`
- Reference: `convex/functions/notes.ts`, `convex/functions/reminders.ts`, `convex/functions/reminderChangeEvents.ts`

---

## Phase 4: Subscriptions (Server Function)

**Goal**: Migrate subscription CRUD to Appwrite Function (same rationale — reminder computation + consistency).

**Steps**:

1. Create Appwrite Function `subscriptions-api` (HTTP trigger):
   - CRUD + soft-delete/restore + trash operations
   - Computes `nextReminderAt` and `nextTrialReminderAt` on create/update
   - Reference: port from `convex/functions/subscriptions.ts`
2. Extract billing computation to `packages/shared/utils/billing.ts` — `computeNextReminderAt()`, `computeAdvancedBillingDate()`
3. Add subscription methods to `AppwriteBackendClient`
4. Reactive `subscribeSubscriptions()` → Appwrite Realtime on `subscriptions` collection

**Relevant files**:

- NEW `appwrite-functions/subscriptions-api/` — `src/main.ts` + `package.json`
- NEW `packages/shared/utils/billing.ts`
- MODIFY `packages/shared/backend/appwrite.ts` — add subscription methods

---

## Phase 5: Crons, Push & AI (Server Functions)

### 5a. Push Notification Function

1. Create `appwrite-functions/push-notification/` — HTTP trigger
   - Same FCM OAuth2 JWT logic from `convex/functions/push.ts`
   - Query `devicePushTokens`, send FCM v1, handle UNREGISTERED tokens
   - Called by reminder/subscription functions after mutations
   - Retry: re-invoke self with incremented `retryCount` (replaces Convex `ctx.scheduler.runAfter`)
   - Env vars: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`

### 5b. Cron Functions (Scheduled Executions)

| Function                       | Schedule    | Logic                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-reminders`              | `* * * * *` | Watermark-based: query `cronState` for last check, find notes where `nextTriggerAt` OR `snoozedUntil` OR **`triggerAt`** (legacy fallback!) in [watermark, now], send push, advance recurrence, update watermark. **Must keep `triggerAt` fallback during dual-write period.** Uses stable `eventId = ${noteId}-${triggerTime}` for push dedup. |
| `purge-trash`                  | `0 3 * * *` | Delete notes + subscriptions where `deletedAt` < 14 days ago                                                                                                                                                                                                                                                                                    |
| `check-subscription-reminders` | `0 3 * * *` | Query due subscription/trial reminders, send push, advance billing dates                                                                                                                                                                                                                                                                        |

### 5c. AI Voice Capture Function

1. Create `appwrite-functions/ai-voice-capture/` — HTTP trigger
   - `parseVoiceNoteIntent` + `continueVoiceClarification`
   - NVIDIA API via OpenAI SDK (same as `convex/functions/aiNoteCapture.ts`)
   - Env vars: `NVIDIA_API_KEY`, `NVIDIA_MODEL_PARSE`, `NVIDIA_MODEL_CLARIFY`, `NVIDIA_TRANSCRIPT_ZERO_RETENTION`

### 5d. User Data Migration Function

1. Create `appwrite-functions/user-data-migration/` — HTTP trigger
   - `preflightUserDataMerge` + `applyUserDataMerge`
   - Merge throttle logic using `migrationAttempts` collection
   - Reference: `convex/functions/userDataMigration.ts`

### 5e. Device Token Function

1. Create `appwrite-functions/device-tokens/` — HTTP trigger
   - `upsertDevicePushToken` — or use direct client SDK write (simpler)

**Relevant files**:

- NEW `appwrite-functions/push-notification/`
- NEW `appwrite-functions/check-reminders/`
- NEW `appwrite-functions/purge-trash/`
- NEW `appwrite-functions/check-subscription-reminders/`
- NEW `appwrite-functions/ai-voice-capture/`
- NEW `appwrite-functions/user-data-migration/`
- Reference: `convex/functions/push.ts`, `convex/functions/reminderTriggers.ts`, `convex/functions/aiNoteCapture.ts`, `convex/functions/userDataMigration.ts`

---

## Phase 6: Realtime Subscriptions

**Goal**: Replace Convex auto-reactive `useQuery()` with Appwrite Realtime.

**Steps**:

1. In `AppwriteBackendClient.subscribeNotes()`: initial fetch via `databases.listDocuments()`, then subscribe to `databases.ai-note-keeper.collections.notes.documents` WebSocket channel
2. On events (`create`/`update`/`delete`), update local state immutably (filter by userId from event payload)
3. Same for `subscribeSubscriptions()`
4. **Caveat**: Appwrite Realtime reconnects on sub/unsub — subscribe at app level, not per-component
5. **Caveat**: Appwrite Realtime is client-only (no Server SDK support)
6. Permissions must be set correctly — user only receives events for documents with `Permission.read(Role.user(userId))`

**Relevant files**:

- MODIFY `packages/shared/backend/appwrite.ts` — implement `subscribeNotes()`, `subscribeSubscriptions()`

---

## Phase 7: Data Migration Script

**Steps**:

1. Create `scripts/migrate-convex-to-appwrite.ts`:
   - Export all Convex documents per table
   - Create Appwrite Auth users:
     - For each Convex `users` row → `users.create()` with synthetic email `{username}@app.notekeeper.local`
     - **Force password reset** (SHA256→bcrypt incompatible) — set flag or send reset email
   - Map Convex userId → Appwrite Auth `$id` across all collections
   - Transform nested objects (RepeatRule etc.) → JSON strings
   - Batch-import documents with Appwrite rate limit handling
2. Create rollback script
3. Validation: document count comparison + spot-check per collection

**Relevant files**:

- NEW `scripts/migrate-convex-to-appwrite.ts`
- NEW `scripts/rollback-appwrite-migration.ts`

---

## Phase 8: Test Migration

**Goal**: Update ALL tests to mock `BackendClient` instead of Convex internals.

**Scope** (addresses review finding — tests are broader than originally scoped):

| Test Location                                             | Count | Current Mock Pattern                                                      |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `tests/contract/*.test.ts`                                | 11    | Mock `convex/_generated/server`, `convex/values`, `convex/_generated/api` |
| `tests/integration/*.test.ts`                             | 1     | Same Convex mocks                                                         |
| `apps/mobile/tests/unit/aiIntentClient.test.ts`           | 1     | Mock `ConvexHttpClient` action method                                     |
| `apps/mobile/tests/unit/fetchNotes.userIdMapping.test.ts` | 1     | Mock `convex/browser` ConvexHttpClient constructor + query                |

**Steps**:

1. Contract tests: now test Appwrite Function handlers directly (import handler, pass mock Appwrite SDK context). Same assertions — change events emitted, conflict resolution, etc.
2. Mobile unit tests: mock `BackendClient` interface (Phase 0 adapter makes this trivial)
3. Update `jest.config.js` — transform `appwrite` module, remove `convex` transforms
4. Add new integration test: Appwrite Function `notes-sync` handler round-trip

---

## Phase 9: Frontend Provider Swap & Cleanup

**Steps**:

1. Remove `ConvexProvider`/`ConvexReactClient` from `apps/mobile/App.tsx` and web entry
2. Feature-flag cutover: switch `BackendClient` implementation from `ConvexBackendClient` → `AppwriteBackendClient`
3. Delete `convex/` directory, `convex.json`
4. Remove `convex`, `convex-test` from all `package.json`
5. Remove Convex env vars (`EXPO_PUBLIC_CONVEX_URL`, `VITE_CONVEX_URL`)
6. Remove `ConvexBackendClient` and all Convex imports
7. Update `AGENTS.md`

---

## Verification

1. Schema setup script → verify collections in Appwrite Console
2. **Anonymous identity**: fresh install → anonymous session created → notes stored under anon userId → data syncs
3. **Login merge**: login with existing account → preflight shows conflicts → apply strategy → data merged correctly
4. **Logout snapshot**: logout → cloud data snapshotted to new anon identity → anon notes accessible
5. Notes CRUD → data in Appwrite DB, realtime updates propagate across tabs/devices
6. Reminders with recurrence → cron fires → push received → ack advances correctly
7. **Legacy triggerAt**: old reminders with only `triggerAt` (no `nextTriggerAt`) still fire during dual-write
8. Subscriptions → billing reminder triggers → push sent
9. AI voice → transcript parsed → draft returned
10. Data migration → document count match + spot-check 10 docs/collection
11. Offline sync (mobile) → airplane mode → create notes → reconnect → `syncNotes` function returns authoritative state
12. ALL tests pass: `npm test` (root), `apps/mobile/tests/` (mobile unit), lint + typecheck

---

## Decisions

- **Appwrite Cloud** (not self-hosted)
- **Anonymous sessions** replace device UUID identity — preserves promote-on-login / snapshot-on-logout lifecycle
- **Server-side writes** for syncNotes, reminders, subscriptions, merge — preserves atomicity + consistency guarantees
- **Client-side reads** + Appwrite Realtime for reactive UI
- **BackendClient adapter** first — decouples all code from Convex before writing Appwrite code
- **Notes + reminders are ONE migration track** — same collection, never split
- **Legacy `triggerAt` fallback** kept in cron function during dual-write
- **Synthetic email** (`{username}@app.notekeeper.local`) for Appwrite Auth — preserves username UX
- **Password reset required** for migrated users (SHA256→Appwrite native hashing)
- **Excluded**: iOS, new features, schema redesign

## Open Questions

1. **Function cold-start**: Appwrite Function cold starts may add 2-5s. For the every-minute reminder cron, verify this is acceptable.

## Resolved Questions

**Anonymous session limits (researched)**: No count cap beyond MAU limits (75K Free, 200K Pro). Sessions stored in Android SharedPreferences — lost on app uninstall (same risk as current AsyncStorage UUID). Risk profile is unchanged from current system. Mitigations required:

- App calls `account.updateSession({ sessionId: 'current' })` on each startup to refresh expiry timer
- Existing "create an account" prompt to users remains critical

**Rate limits / plan**: Free plan pauses projects after 1 week inactivity — **production requires Pro ($25/month)**. Write rate limits are per-endpoint (headers provide current limit). Acceptable for expected volume.

**Bonus: built-in push targets**: Appwrite has native `account.createPushTarget()` / `account.updatePushTarget()` — replaces the custom `devicePushTokens` collection. Simplifies Phase 5 push registration. The `registerDeviceToken.ts` file can call `account.createPushTarget()` directly instead of writing to a custom collection. The `push-notification` Appwrite Function then queries `users.listTargets()` via Server SDK instead of the custom collection.
