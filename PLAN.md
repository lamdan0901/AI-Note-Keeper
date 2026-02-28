# Web Notes MVP Plan (CRUD+Lite, No Notifications)

## Summary

Build a web notes app that is intentionally minimal but production-usable: `list/create/edit/delete` plus `pin/done/color`, styled to mirror the mobile notes experience.  
Use `Convex` as online-first source of truth, no notification/reminder UX, no offline outbox, and a single fixed user (`local-user`) for this phase.

## Scope

- In scope:
- Notes list view with mobile-like cards.
- Create/edit/delete notes.
- Mark done/undone.
- Pin/unpin.
- Color presets matching mobile.
- Grid/list toggle (lightweight parity with mobile).
- Optimistic UI with rollback on mutation failure.
- Out of scope:
- Notifications/reminders UX and logic on web.
- Multi-select/bulk actions.
- Auth/login.
- Offline write queue.
- Search, labels, templates, archive/trash flows.

## Implementation Plan

### 1. Backend API Layer (Convex)

- **No new Convex functions needed.** The existing functions already cover all required operations:
  - `getNotes` — reads all notes for a `userId`. Web filters `active === true` and sorts client-side.
  - `syncNotes` — accepts an array of changes with `operation: "create" | "update" | "delete"`. Web calls it with a single-item `changes` array and `deviceId: "web"`.
- No schema migration needed in [convex/schema.ts](C:/prj/ai-note-keeper/convex/schema.ts).

### 2. Web App Foundation

- **This must be completed before any Convex hooks are usable.**
- Update [apps/web/src/main.tsx](C:/prj/ai-note-keeper/apps/web/src/main.tsx):
- Create `ConvexReactClient` using `import.meta.env.VITE_CONVEX_URL`.
- Wrap app root with `ConvexProvider`.
- Ensure `VITE_CONVEX_URL` is set for web runtime (use existing `apps/web/.env` or `apps/web/.env.local`).
- Replace scaffold content in [apps/web/src/App.tsx](C:/prj/ai-note-keeper/apps/web/src/App.tsx) with a single Notes page container.
- Keep reminders files untouched but unused for now.

### 3. Web Notes Feature Modules

- Follow the existing flat layout (`src/services/`, `src/components/`, `src/pages/`) rather than introducing a new `features/notes/` sub-tree, to stay consistent with the current web app structure.
- `src/services/notes.ts`: typed hooks for list/create/update/delete.
- `src/services/notesTypes.ts`: web-local draft/view model types (`NoteEditorDraft`, `NotesViewMode`).
- `src/services/notesUtils.ts`: sorting/filtering/mapping helpers.
- `src/components/NotesHeader.tsx`: title + view toggle + "new note".
- `src/components/NoteCard.tsx`: title/content preview, pin/done badges, color surface.
- `src/components/NotesList.tsx`: responsive grid/list renderer.
- `src/components/NoteEditorModal.tsx`: create/edit form with title/content/pin/done/color + delete action.
- `src/pages/NotesPage.tsx`: orchestrates hooks, optimistic updates, mutation status.
- Add/update styles in [apps/web/src/styles.css](C:/prj/ai-note-keeper/apps/web/src/styles.css):
- Reuse mobile palette and typography tokens.
- Keep responsive behavior for desktop and mobile widths.

### 4. UX/Interaction Specification (Decision Complete)

- Default view mode: `grid`.
- Grid columns: `1` on mobile, `2` on tablet, `3` on large desktop.
- Optional list mode via header toggle.
- Note ordering in UI: pinned first, then non-done before done, then newest updated.
- Create note:
- Click “New note” opens modal.
- Empty title+content on save closes without creating.
- Edit note:
- Click card opens same modal.
- Save updates in place.
- Delete:
- Available only in edit mode.
- Confirmation required before soft delete.
- Done toggle:
- Inline action in card and editor.
- Done notes appear visually muted/strikethrough.
- Pin toggle:
- Inline in editor header.
- Pinned notes always remain at top group.
- Color:
- Use same preset IDs as mobile (`default/red/yellow/green/blue/purple`).
- Persist preset ID in `note.color`.

### 5. State/Data Flow

- Use `USER_ID = "local-user"` constant in web notes service.
- Read path:
  - `useQuery(api.functions.notes.getNotes, { userId: USER_ID })` → filter `active === true` → sort in JS (pinned first, non-done before done, newest `updatedAt`).
- Write path:
  - All mutations go through `useMutation(api.functions.notes.syncNotes)`.
  - Create: `operation: "create"`, `active: true`, `deviceId: "web"`, client-generated `id` via `crypto.randomUUID()`.
  - Update: `operation: "update"`, `active: true`, `deviceId: "web"`. Last-write-wins is already enforced server-side.
  - Update payloads must preserve reminder-related fields from the existing note unless explicitly changed on web: `triggerAt`, `repeat`, `repeatRule`, `repeatConfig`, `snoozedUntil`, `scheduleStatus`, `timezone`, `baseAtLocal`, `startAt`, `nextTriggerAt`, `lastFiredAt`, `lastAcknowledgedAt`.
  - Delete: `operation: "delete"`, `active: false`, `deviceId: "web"`.
  - All calls pass `lastSyncAt: Date.now()`.
- Failure handling:
  - Roll back local optimistic state.
  - Use per-mutation rollback snapshots to avoid collisions with concurrent query refreshes.
  - Show non-blocking inline error toast/banner.
- Success feedback:
  - Brief "Saved" state near header.
- No global state library needed; React local state + Convex hooks only.

## Public API / Interface Changes

- No new Convex functions. Web reuses existing:
  - `getNotes(args: { userId: string }) => Note[]` — read all; web filters + sorts client-side.
  - `syncNotes(args: { userId, changes, lastSyncAt }) => { notes, syncedAt }` — write for create/update/delete.
- New web-local interfaces only:
  - `NoteEditorDraft` for modal state.
  - `NotesViewMode = "grid" | "list"`.
  - `WebNote` mapped from Convex doc shape.

## Test Cases and Scenarios

### Automated

1. Unit tests for web notes utils (`apps/web/src/services/notesUtils.ts`):

- `sortNotes` ordering: pinned → non-done → done → newest `updatedAt`.
- `emptyDraft` returns correct defaults.
- `draftFromNote` maps all fields correctly.

### Manual QA

1. Web create/edit/delete works end-to-end against Convex.
2. Pin and done states persist after refresh.
3. Color selection persists and renders correctly.
4. Responsive layout works at 375px, 768px, 1024px, 1440px.
5. No reminder controls appear in web UI.
6. Existing mobile app still syncs and reads note changes (after mobile sync trigger).

### Acceptance Criteria

- User can complete full note lifecycle (create, read/list, update, delete).
- UI behavior matches mobile intent for core note interactions.
- No notification/reminder functionality is exposed in web.
- `npm run lint` and `npm test` pass.
- **Note:** Verify `apps/web` has ESLint configured (`.eslintrc` or `eslint.config.*`) before treating lint as a passing gate. Add a minimal config if absent.
- **Note:** Root ESLint config already covers `apps/web`; app-local ESLint config is optional unless workspace lint behavior changes.

## Assumptions and Defaults

- Single-user MVP uses fixed `userId = "local-user"`.
- Online-first behavior is acceptable for this phase.
- Plain text title/content only.
- Reminder data fields on notes must not be modified by web CRUD unless explicitly added later.
- Existing reminder web scaffolding remains in repo but is out of scope for this implementation.
- The `notes` table has no secondary index on `userId`; `.filter()` does a full table scan. Acceptable for MVP scale. A `.index('by_userId', ['userId'])` can be added to `convex/schema.ts` later as an optimization.

---

## Tasks

Tasks are ordered by dependency. Complete each phase before starting the next.

### Phase 0 — Setup

- [x] **T01** Validate lint execution for `apps/web` via existing root ESLint config. Add app-local config only if lint does not pick up web files.
- [x] **T02** Ensure `VITE_CONVEX_URL` is present in web env (`apps/web/.env` or `apps/web/.env.local`).

---

### Phase 1 — Web App Foundation

> Must be done before any Convex hook renders.

- [x] **T03** Update `apps/web/src/main.tsx`: create `ConvexReactClient` from `VITE_CONVEX_URL`, wrap root with `ConvexProvider`.
- [x] **T04** Replace scaffold in `apps/web/src/App.tsx` with a single `<NotesPage />` render (import from `./pages/NotesPage`).

---

### Phase 2 — Types & Utilities

- [x] **T05** Create `apps/web/src/services/notesTypes.ts`.
  - Export `NoteEditorDraft` (fields: `id?`, `title`, `content`, `color`, `isPinned`, `done`).
  - Export `NotesViewMode = "grid" | "list"`.
  - Export `WebNote` (mapped from Convex doc shape; omit internal `_id`/`_creationTime`).
- [x] **T06** Create `apps/web/src/services/notesUtils.ts`.
  - `filterActive(notes): WebNote[]` — keep only `active === true`.
  - `sortNotes(notes: WebNote[]): WebNote[]` — pinned first, non-done before done, newest `updatedAt`.
  - `draftFromNote(note: WebNote): NoteEditorDraft` — maps a note to editor state.
  - `emptyDraft(): NoteEditorDraft` — returns a blank draft for new notes.
  - Add color normalization helper to map legacy hex values to preset IDs (`default/red/yellow/green/blue/purple`).
- [x] **T07** Create `apps/web/src/services/notes.ts`.
  - Export `USER_ID = "local-user"`.
  - Export `useNotes()` → `useQuery(api.functions.notes.getNotes, { userId: USER_ID })`, then `filterActive` + `sortNotes` on the result.
  - Export `useSyncNotes()` → `useMutation(api.functions.notes.syncNotes)`.
  - Export helper wrappers `createNote(sync, draft)`, `updateNote(sync, draft)`, `deleteNote(sync, id)` that build the correct `changes` array and pass `deviceId: "web"`, `lastSyncAt: Date.now()`.
  - For `updateNote`, merge unchanged reminder-related fields from the existing note into the outbound change payload so web edits do not clear reminder metadata.

---

### Phase 3 — UI Components

- [ ] **T08** Create `apps/web/src/components/NoteCard.tsx`.
  - Props: `note: WebNote`, `onClick: () => void`.
  - Show title, content preview (max 3 lines), pin badge, done state (muted + strikethrough), color surface.
- [ ] **T09** Create `apps/web/src/components/NotesHeader.tsx`.
  - Props: `viewMode`, `onToggleView`, `onNewNote`, `saveStatus: "idle" | "saving" | "saved" | "error"`.
  - Renders app name, grid/list toggle buttons, "New note" button, inline save status.
- [ ] **T10** Create `apps/web/src/components/NotesList.tsx`.
  - Props: `notes: WebNote[]`, `viewMode`, `onCardClick: (note: WebNote) => void`.
  - CSS grid: 1 col ≤ 600px, 2 cols ≤ 1024px, 3 cols > 1024px. List mode: single column full-width.
- [ ] **T11** Create `apps/web/src/components/NoteEditorModal.tsx`.
  - Props: `draft`, `onChange`, `onSave`, `onDelete`, `onClose`, `isNew: boolean`.
  - Fields: title input, content textarea, color picker (6 presets), pin toggle, done toggle.
  - Delete button visible only when `!isNew`; triggers confirmation before calling `onDelete`.
  - Pressing Escape or clicking backdrop calls `onClose`.

---

### Phase 4 — Page & Styles

- [ ] **T12** Create `apps/web/src/pages/NotesPage.tsx`.
  - Calls `useNotes()` and `useSyncNotes()`.
  - Manages local state: `viewMode`, `editorDraft`, `modalOpen`, `saveStatus`.
  - Optimistic update: apply change to local list immediately; roll back on error.
  - On save with empty title+content → close modal without mutating.
  - Renders `<NotesHeader>`, `<NotesList>`, `<NoteEditorModal>` (conditional).
- [ ] **T13** Update `apps/web/src/styles.css`.
  - Add CSS custom properties for the 6 note color presets matching mobile palette.
  - Add card styles: surface color, border-radius, shadow, hover lift.
  - Add grid/list layout classes used by `NotesList`.
  - Add modal overlay + dialog styles.
  - Add done-note muted/strikethrough style.
  - Ensure responsive breakpoints: 375px, 768px, 1024px, 1440px.

---

### Phase 5 — Tests

- [ ] **T14** Add unit tests for `apps/web/src/services/notesUtils.ts`.
  - `filterActive` excludes `active: false` notes.
  - `sortNotes` ordering: pinned → non-done → done → oldest `updatedAt`.
  - `emptyDraft` returns all fields with correct defaults.
  - `draftFromNote` maps all fields correctly.
