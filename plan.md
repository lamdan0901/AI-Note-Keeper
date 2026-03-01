# Repeat Display Consistency + Canonical Recurrence Migration (Web + Mobile + Convex)

## Summary

Implement a full dual-write migration so repeat metadata is consistent across web, mobile, and backend sync, while fixing both reported issues:

1. Web repeat label misrendering from legacy/mobile-shaped repeat payloads.
2. Mobile repeat label disappearing after first fire/sync because canonical `repeat` is dropped and UI falls back to `none`.

This plan keeps backward compatibility (`repeat` + `repeatRule/repeatConfig`) and includes lazy normalization plus an explicit bulk backfill path.

## Skills Applied

Use `vercel-react-best-practices` and `vercel-react-native-skills` to keep state derivation, render paths, and cross-platform formatting deterministic.

## Implementation Plan

### 1. Introduce Shared Repeat Codec + Label Formatter

Files:

- [packages/shared/utils/repeatCodec.ts](/c:/prj/ai-note-keeper/packages/shared/utils/repeatCodec.ts)
- [packages/shared/utils/repeatLabel.ts](/c:/prj/ai-note-keeper/packages/shared/utils/repeatLabel.ts)
- [packages/shared/types/note.ts](/c:/prj/ai-note-keeper/packages/shared/types/note.ts)
- [packages/shared/types/reminder.ts](/c:/prj/ai-note-keeper/packages/shared/types/reminder.ts)

Changes:

- Add `coerceRepeatRule(input)` with precedence: canonical `repeat` first, then legacy fields.
- Support legacy mobile-shaped config (`repeatRule: 'custom'` + `repeatConfig.kind`) exactly like backend trigger parsing.
- Normalize intervals (`>=1`), weekday arrays (0-6, unique, sorted), and safe fallbacks.
- Add `toLegacyRepeatFields(repeat)` for dual-write output.
- Add `buildCanonicalRecurrenceFields({ reminderAt, repeat, existing })` returning `repeat`, `startAt`, `baseAtLocal`, `nextTriggerAt`.
- Add shared display formatter for readable grammar:
  - `Daily`, `Weekly (Mon, Wed)`, `Monthly`, `Every N days/weeks/months/minutes`
  - Proper singular/plural handling.
- Expand legacy union to include `'monthly'` where applicable for consistency.

### 2. Web: Use Shared Codec for Read/Write + Label Rendering

Files:

- [apps/web/src/services/reminderUtils.ts](/c:/prj/ai-note-keeper/apps/web/src/services/reminderUtils.ts)
- [apps/web/src/services/notes.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notes.ts)
- [apps/web/src/pages/NotesPage.tsx](/c:/prj/ai-note-keeper/apps/web/src/pages/NotesPage.tsx)

Changes:

- Replace local repeat coercion/label logic with shared codec + formatter.
- Update `buildReminderSyncFields` to dual-write canonical + legacy fields.
- Preserve existing anchor (`startAt/baseAtLocal`) when editing unchanged series; reset anchor when recurrence definition changes.
- Ensure optimistic note updates include canonical recurrence fields so UI remains stable immediately after save.
- Fix web display bug by correctly interpreting custom+kind legacy payloads.

### 3. Mobile: Stop Losing Repeat on Sync and Editor Open

Files:

- [apps/mobile/src/sync/fetchNotes.ts](/c:/prj/ai-note-keeper/apps/mobile/src/sync/fetchNotes.ts)
- [apps/mobile/src/sync/syncQueueProcessor.ts](/c:/prj/ai-note-keeper/apps/mobile/src/sync/syncQueueProcessor.ts)
- [apps/mobile/src/hooks/useNoteEditor.ts](/c:/prj/ai-note-keeper/apps/mobile/src/hooks/useNoteEditor.ts)
- [apps/mobile/src/hooks/useNoteActions.ts](/c:/prj/ai-note-keeper/apps/mobile/src/hooks/useNoteActions.ts)
- [apps/mobile/src/components/NoteCard.tsx](/c:/prj/ai-note-keeper/apps/mobile/src/components/NoteCard.tsx)
- [apps/mobile/src/components/NoteEditorModal.tsx](/c:/prj/ai-note-keeper/apps/mobile/src/components/NoteEditorModal.tsx)
- [apps/mobile/src/utils/formatReminder.ts](/c:/prj/ai-note-keeper/apps/mobile/src/utils/formatReminder.ts)

Changes:

- Map canonical fields from server in `fetchNotes` (`repeat`, `startAt`, `baseAtLocal`, `nextTriggerAt`, `lastFiredAt`, `lastAcknowledgedAt`).
- Send canonical fields through outbox sync payload in `syncQueueProcessor`.
- In editor open flow, resolve repeat via shared codec (not `note.repeat` only).
- In note card and editor chip, render repeat via shared formatter and effective repeat resolution.
- In save flow, dual-write canonical + legacy (derive correct `repeatRule` by kind; stop forcing `'custom'` for all repeats).
- Keep “mark done” behavior clearing both legacy and canonical recurrence fields as already intended.

### 4. Convex `syncNotes`: Extend API and Preserve Canonical Fields

Files:

- [convex/functions/notes.ts](/c:/prj/ai-note-keeper/convex/functions/notes.ts)

Changes:

- Extend `changes[]` validator to accept canonical recurrence fields:
  - `repeat`, `startAt`, `baseAtLocal`, `nextTriggerAt`, `lastFiredAt`, `lastAcknowledgedAt`.
- Patch/insert these fields server-side (dual-write remains).
- Use “presence-aware” patch assembly so omitted fields are preserved, while explicit `null`/`undefined` clears are intentional.
- Keep existing last-write-wins rule.

### 5. Backfill Strategy (Lazy + On-Demand)

Files:

- [convex/functions/notesMigration.ts](/c:/prj/ai-note-keeper/convex/functions/notesMigration.ts) (new)

Changes:

- Add mutation(s) to backfill notes missing canonical recurrence fields.
- Derivation rules:
  - `repeat` from legacy via shared-equivalent parser.
  - `startAt` from existing `startAt ?? triggerAt ?? nextTriggerAt`.
  - `baseAtLocal` from existing or computed local ISO at `startAt`.
  - `nextTriggerAt` from `snoozedUntil ?? nextTriggerAt ?? triggerAt` when recurring.
- Add pagination support for safe batch runs.
- Keep legacy fields untouched.

Rollout:

- Backend deploy first (`syncNotes` extended + migration mutation).
- Run on-demand backfill in batches.
- Deploy web and mobile clients after backend is live.
- Continue lazy normalization on new writes.

## Public APIs / Interfaces / Types Changed

- `convex/functions/notes.syncNotes` input `changes[]` now accepts canonical recurrence fields.
- Shared type unions include monthly in legacy repeat rule where needed for consistency.
- New shared utilities exposed:
  - `coerceRepeatRule`
  - `toLegacyRepeatFields`
  - `buildCanonicalRecurrenceFields`
  - `formatRepeatLabel` / shared reminder formatting helper

## Test Cases and Scenarios

### Shared Unit Tests

Files:

- [packages/shared/utils/repeatCodec.test.ts](/c:/prj/ai-note-keeper/packages/shared/utils/repeatCodec.test.ts) (new)
- [packages/shared/utils/repeatLabel.test.ts](/c:/prj/ai-note-keeper/packages/shared/utils/repeatLabel.test.ts) (new)

Scenarios:

- Parse canonical repeat directly.
- Parse legacy `daily/weekly/monthly/custom`.
- Parse legacy custom+kind payload from older mobile clients.
- Interval and weekday normalization.
- Grammar correctness for singular/plural labels.

### Backend Contract Tests

Files:

- [tests/contract/notes.crud.test.ts](/c:/prj/ai-note-keeper/tests/contract/notes.crud.test.ts)

Scenarios:

- `syncNotes` create/update persists canonical recurrence fields.
- Omitted fields are preserved (no accidental clears).
- Explicit clear behavior works for done/non-recurring transitions.

### Mobile/Web Regression Tests

Files:

- [apps/mobile/src/hooks/useNoteEditor.test.ts](/c:/prj/ai-note-keeper/apps/mobile/src/hooks/useNoteEditor.test.ts) (new)
- [apps/mobile/src/utils/formatReminder.test.ts](/c:/prj/ai-note-keeper/apps/mobile/src/utils/formatReminder.test.ts) (new)
- [apps/web/src/services/reminderUtils.test.ts](/c:/prj/ai-note-keeper/apps/web/src/services/reminderUtils.test.ts) (new)

Scenarios:

- Mobile: after sync payload without canonical `repeat` but with legacy repeat fields, card/editor still shows correct repeat.
- Mobile: after first trigger and sync update, repeat display remains.
- Web: displays correct repeat for legacy custom+kind payload.
- Cross-client: weekly/monthly/custom rules display identically.

## Acceptance Criteria

- Web displays correct repeat labels for all existing recurrence data shapes.
- Mobile repeat label does not disappear after first notification fire/sync.
- Editing a recurring note after sync does not silently downgrade repeat to none/default.
- Legacy clients remain compatible through dual-read/dual-write behavior.
- Existing data can be backfilled without downtime.

## Assumptions and Defaults

- Use dual-write/read compatibility as the default migration mode.
- Use lazy normalization on writes plus explicit on-demand bulk backfill mutation.
- Keep legacy fields for compatibility; no hard removal in this phase.
- Use local timezone-derived `baseAtLocal` when reconstructing anchors.
- Ignore unrelated working tree deletions (`design_system.md`, `plan2.md`) per your instruction.
