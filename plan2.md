# Implement Web Note Reminder Modal + Card Reminder Row (Mobile-Parity)

## Summary

Implement web reminder editing to match mobile behavior and UI patterns, then show reminder time at the bottom of each note card.  
Chosen defaults (from your answers): full mobile parity for modal UX, mobile-compatible persistence fields, and clearing reminder fields when marking a note as done.

## Implementation Plan

1. Add reminder helper layer for web so UI and data mapping are deterministic.  
   Files: [reminderUtils.ts](/c:/prj/ai-note-keeper/apps/web/src/services/reminderUtils.ts), [notesTypes.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notesTypes.ts).  
   Functions to add: `getEffectiveTriggerAt(note)`, `coerceRepeatRule(note)`, `formatReminder(date, repeat)`, `getInitialReminderDate(initialDate, now)`, `buildReminderSyncFields(draft, now, timezone)`.  
   Behavior: effective trigger precedence is `snoozedUntil ?? nextTriggerAt ?? triggerAt`; initial past date auto-shifts to next hour, except after 22:00 shifts to tomorrow 07:00; save normalization zeroes seconds/ms and enforces future-only.

2. Extend web editor draft/state to carry reminder data explicitly.  
   Files: [notesTypes.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notesTypes.ts), [notesUtils.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notesUtils.ts).  
   `NoteEditorDraft` will add `reminder: Date | null` and `repeat: RepeatRule | null`; `emptyDraft()` initializes both to `null`; `draftFromNote()` derives both from existing note using effective trigger + repeat coercion.

3. Build web reminder modal components with mobile-equivalent sections and validation.  
   Files: [ReminderSetupModal.tsx](/c:/prj/ai-note-keeper/apps/web/src/components/reminders/ReminderSetupModal.tsx), [ReminderPresetDropdown.tsx](/c:/prj/ai-note-keeper/apps/web/src/components/reminders/ReminderPresetDropdown.tsx), [RecurrencePicker.tsx](/c:/prj/ai-note-keeper/apps/web/src/components/reminders/RecurrencePicker.tsx).  
   Sections: preset dropdown (Today/Tomorrow, Morning/Afternoon/Evening/Night), month calendar with min date today, manual time selector + quick time chips (`6:30, 9:00, 11:30, 3:00, 5:30, 7:00, 9:30`), repeat section (`none/daily/weekly/monthly/custom`).  
   Validation: reject past selections, disable invalid preset/chip options for today, prevent weekly empty weekday selection, custom minimum interval 2 days.

4. Integrate reminder UX into note editor modal.  
   File: [NoteEditorModal.tsx](/c:/prj/ai-note-keeper/apps/web/src/components/NoteEditorModal.tsx).  
   Add alarm button when no reminder; add reminder chip when reminder exists; chip opens reminder modal; chip close clears reminder + repeat; saving reminder auto-sets `done = false`; toggling `done = true` clears reminder + repeat immediately.

5. Update note create/update persistence mapping to include reminder fields using mobile-compatible model.  
   Files: [notes.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notes.ts), [NotesPage.tsx](/c:/prj/ai-note-keeper/apps/web/src/pages/NotesPage.tsx).  
   Create/update payloads will write: `triggerAt`, `repeatRule` (`custom` when repeat exists), `repeatConfig` (from repeat), `snoozedUntil` (cleared), `scheduleStatus` (`unscheduled` when reminder present), `timezone` (resolved from `Intl`).  
   Advanced fields (`repeat`, `baseAtLocal`, `startAt`, `nextTriggerAt`, `lastFiredAt`, `lastAcknowledgedAt`) remain preserved by omission, matching chosen persistence scope.  
   Done toggles from card/editor will clear reminder fields before syncing.

6. Add reminder rendering at bottom of note cards (mobile-like placement).  
   File: [NoteCard.tsx](/c:/prj/ai-note-keeper/apps/web/src/components/NoteCard.tsx).  
   Render bottom row only when effective reminder exists: alarm icon + formatted text from `formatReminder`.  
   Placement uses footer/meta row anchored to card bottom flow so it stays at the bottom-most section.

7. Update styling for new modal controls and card reminder footer.  
   File: [styles.css](/c:/prj/ai-note-keeper/apps/web/src/styles.css).  
   Add classes for reminder trigger chip/button, nested reminder modal, preset dropdown, calendar grid/day states, recurrence tabs/details, time chips, and card reminder footer.  
   Keep existing theme tokens and dark-mode behavior consistent with current system.

8. Add/adjust tests for reminder logic and payload shaping.  
   Files: [reminderUtils.test.ts](/c:/prj/ai-note-keeper/apps/web/src/services/reminderUtils.test.ts), [notes.test.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notes.test.ts).  
   Test helper logic (effective trigger precedence, repeat coercion, initial date fallback, formatting output) and create/update payload mapping (set reminder, clear reminder, done-clears-reminder).

## Public APIs / Types Changes

- `NoteEditorDraft` in [notesTypes.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notesTypes.ts): add `reminder: Date | null`, `repeat: RepeatRule | null`.
- `WebNote` typing in [notesTypes.ts](/c:/prj/ai-note-keeper/apps/web/src/services/notesTypes.ts): tighten reminder-related fields for safer parsing (`repeatRule`, `repeatConfig`, `repeat`).
- New reusable reminder utility exports in [reminderUtils.ts](/c:/prj/ai-note-keeper/apps/web/src/services/reminderUtils.ts) consumed by editor modal and note card.

## Test Cases and Scenarios

1. Create note with future one-time reminder; card shows reminder at bottom; sync payload includes trigger/timezone/scheduleStatus.
2. Create note with repeat rule; chip shows repeat label; payload includes `repeatConfig` + `repeatRule`.
3. Edit note with existing reminder and save unchanged; reminder remains intact.
4. Clear reminder from chip and save; reminder fields are removed in outgoing update.
5. Mark note done from card quick action; reminder fields are cleared and no reminder shown on card.
6. Mark note done inside editor; reminder clears immediately and persists cleared state.
7. Reminder modal past-time selection blocked; after-22:00 default goes to tomorrow 07:00.
8. Calendar prevents selecting past dates; preset/chip options that are past for today are disabled.
9. Weekly recurrence cannot have zero weekdays selected.
10. Dark/light themes render reminder UI and card footer legibly.

## Assumptions and Defaults

- Web mirrors mobile reminder UX/logic as currently implemented, not a redesign.
- Persistence follows mobile-compatible fields only; no Convex `syncNotes` API/schema expansion in this change.
- Reminder display text follows mobile format pattern (weekday/month/day/time + repeat label when present).
- Timezone source is `Intl.DateTimeFormat().resolvedOptions().timeZone`, fallback `UTC`.
- No push/notification scheduling changes are included for web in this scope.
