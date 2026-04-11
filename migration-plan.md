## Plan: Migrate Convex to Appwrite

Replace Convex with Appwrite Cloud. **Four structural changes from v1** based on your review:

1. Local device identity preserved via **Appwrite Anonymous Sessions**
2. Notes + reminders are **one migration track** (same collection)
3. Write-heavy flows (**syncNotes, reminders, merge**) stay **server-side as Appwrite Functions**
4. **BackendClient adapter** abstracts all 10 Convex call sites before any Appwrite code is written

---

### Phase 0: Backend Adapter Layer _(pre-requisite)_

Define a `BackendClient` interface in `packages/shared/backend/types.ts` covering every Convex call: auth, notes sync, reminders, subscriptions, push tokens, merge, voice AI, and reactive subscriptions. Create `ConvexBackendClient` wrapping existing calls 1:1. Rewire all **10 call sites** (8 imperative `ConvexHttpClient` locations + 2 React hook entry points) to consume the interface. Zero behavior change — just a seam for swapping implementations.

The 10 sites: AuthContext (mobile+web), syncQueueProcessor, fetchNotes, fetchReminder, registerDeviceToken, headless.ts, aiIntentClient, realtimeService (notes), subscriptions service.

### Phase 1: Appwrite Project Setup & Schema

Create Appwrite Cloud project, database `ai-note-keeper` with 6 collections: `notes` (unified notes+reminders), `noteChangeEvents`, `subscriptions`, `devicePushTokens`, `cronState`, `migrationAttempts`. Users handled by Appwrite Auth. Nested objects (`repeat`, `repeatConfig`) stored as JSON strings. Document IDs use existing UUIDs. Schema created programmatically via `scripts/setup-appwrite-schema.ts`.

### Phase 2: Identity & Auth Migration

**Preserves the full local identity lifecycle:**

- **Unauthenticated** → `account.createAnonymousSession()` creates a real Appwrite user. This anonymous `$id` replaces the device UUID as `userId`. Documents get `Permission.read/write(Role.user(anonId))`.
- **Login (merge)** → Two-phase merge stays as an Appwrite Function: `preflightUserDataMerge(anonId → accountId)` → strategy → `applyUserDataMerge()`. Then kill anon session, create credentialed session.
- **Logout (snapshot)** → Appwrite Function `applyUserDataMerge(accountId → newAnonId, 'local')`. Delete sessions. Create fresh anonymous session.
- **Username→email**: synthetic `{username}@app.notekeeper.local`, store username in Appwrite user `name`. Existing users force password reset (SHA256 incompatible).

### Phase 3: Notes + Reminders _(unified, server-side)_

**Why server-side**: `syncNotes` is an atomic batch (N changes → N change events → authoritative state return). Reminder mutations write note + emit change event + enqueue push — three writes that must succeed together. Mobile `syncQueueProcessor` depends on server returning canonical state.

- Appwrite Function `notes-sync` (HTTP): same contract as current `syncNotes` — receives `{ userId, changes[], lastSyncAt }`, returns `{ notes[], syncedAt }`
- Appwrite Function `reminders-api` (HTTP): create/update/delete/ack/snooze — each writes note + change event + calls push function
- Extract recurrence logic to recurrence.ts (shared by Function + mobile)
- Create `AppwriteBackendClient` implementing `BackendClient` — plugs in via feature flag

### Phase 4: Subscriptions _(server-side)_

Appwrite Function `subscriptions-api` (HTTP): full CRUD + soft-delete/restore + trash. Computes `nextReminderAt`/`nextTrialReminderAt`. Extract billing math to `packages/shared/utils/billing.ts`.

### Phase 5: Crons, Push, AI & Merge _(Appwrite Functions)_

| Function                       | Trigger          | Key Detail                                                                                        |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| `push-notification`            | HTTP             | FCM OAuth2 JWT, retry via self-reinvocation                                                       |
| `check-reminders`              | Cron `* * * * *` | Watermark-based. **Keeps legacy `triggerAt` fallback** during dual-write + stable `eventId` dedup |
| `purge-trash`                  | Cron `0 3 * * *` | Notes + subscriptions, 14-day window                                                              |
| `check-subscription-reminders` | Cron `0 3 * * *` | Billing + trial reminders                                                                         |
| `ai-voice-capture`             | HTTP             | NVIDIA API, parse + clarification endpoints                                                       |
| `user-data-migration`          | HTTP             | preflight + apply merge, throttle protection                                                      |

### Phase 6: Realtime Subscriptions

`AppwriteBackendClient.subscribeNotes()` does initial `listDocuments()` then subscribes to Appwrite Realtime WebSocket. Subscribe once at app level (Appwrite reconnects on every sub/unsub change). Same for subscriptions.

### Phase 7: Data Migration Script

`scripts/migrate-convex-to-appwrite.ts`: export Convex → create Appwrite Auth users (force password reset) → map Convex userId → Appwrite `$id` across all collections → batch import. Rollback script included.

### Phase 8: Test Migration _(full scope)_

| Location                         | Count | Action                                                                |
| -------------------------------- | ----- | --------------------------------------------------------------------- |
| `tests/contract/*.test.ts`       | 11    | Mock Appwrite Function handlers instead of `convex/_generated/server` |
| `tests/integration/*.test.ts`    | 1     | Same                                                                  |
| aiIntentClient.test.ts           | 1     | Mock `BackendClient.parseVoiceNoteIntent`                             |
| fetchNotes.userIdMapping.test.ts | 1     | Mock `BackendClient.getNotes` instead of `convex/browser`             |

### Phase 9: Frontend Provider Swap & Cleanup

Feature-flag cutover: swap `BackendClient` from Convex → Appwrite implementation. Remove `ConvexProvider` from App.tsx. Delete convex directory, convex.json, all Convex dependencies + env vars.

---

### Verification

1. Fresh install → anonymous session → notes stored → sync works
2. Login → merge prompt → strategy applied → data merged correctly
3. Logout → cloud data snapshotted to new anon identity
4. **Legacy `triggerAt`** reminders still fire during dual-write
5. Realtime updates across tabs
6. Offline → create notes → reconnect → `syncNotes` returns authoritative state
7. ALL tests pass: root + mobile unit tests

### Open Questions

1. **Anonymous session limits** — Does Appwrite Cloud auto-expire anonymous sessions or cap count? Needs verification.
2. **Rate limits** — Free tier write limits sufficient for production volume?
3. **Function cold-start** — 2-5s overhead on the every-minute reminder cron acceptable?
