# Inline note reminder panel (web)

**Date:** 2026-07-24  
**Scope:** `apps/web` only (mobile keeps separate reminder modal)

## Problem

Add/edit note uses a nested second modal (`ReminderSetupModal`) for reminder setup. User wants reminder controls inside the note editor modal, always visible, with layout adjusted accordingly.

## Goals

- Single modal for note create/edit.
- Reminder UI always visible below note content, above footer.
- Reminder edits apply live to the note draft; one Save persists the note.
- Reminder remains optional (default none + Clear).
- Past reminder times cannot be saved with the note.

## Non-goals

- Mobile UI changes.
- API / reminder scheduling backend changes.
- New reminder features (presets, recurrence rules, etc.).

## UX

Stack inside the existing note dialog:

1. Header (pin / close)
2. Title
3. Content (text | checklist)
4. **Reminder section** (always visible)
5. Footer (color picker + content type / done / delete / save)

### Reminder section behavior

| State | Behavior |
|--------|----------|
| None | Controls visible; no reminder on draft until user picks preset / day / time. Clear is idle or no-op. |
| Set | Preset dropdown, calendar, time input, quick times, recurrence — same controls as today’s modal body. Every change updates `draft.reminder` / `draft.repeat` immediately. |
| Clear | Sets `reminder: null`, `repeat: null`. |

Removed:

- Nested overlay / second dialog
- “Set reminder” header + close on a child modal
- Separate Cancel / “Save reminder”
- Footer “Reminder” chip that only opened the child modal

Optional: small status label showing formatted reminder when set (not required for first ship if Clear alone is clear enough).

### Validation & keyboard

- If a reminder is set and its datetime is ≤ now, show existing error copy (“Reminder time must be in the future.”) and **disable note Save**.
- Esc closes the note modal only (no nested stack).
- Ctrl+Enter saves the note when not empty and reminder is valid (or unset).
- Marking note Done still clears reminder (`toggleDoneInDraft` unchanged).

## Architecture

### Components

| Piece | Role |
|--------|------|
| `ReminderSetupPanel` (new) | Presentational/controlled body: presets, calendar, time, recurrence, error, clear. No overlay, no modal chrome, no separate save. |
| `NoteEditorModal` | Always mounts panel under content. Wires panel → draft via `onChange`. Single Save path. |
| `ReminderSetupModal` | Remove after extract if no callers remain (expected: only `NoteEditorModal`). |

### Panel API (sketch)

```ts
type ReminderSetupPanelProps = {
  reminder: Date | null;
  repeat: RepeatRule | null;
  now?: Date;
  onChange: (payload: { reminder: Date | null; repeat: RepeatRule | null }) => void;
};
```

- When `reminder` is null, UI may still show a provisional selected date for interaction (same as today’s `getInitialReminderDate`), but **must not** call `onChange` with a non-null reminder until the user takes a set action (preset / day / time / recurrence that implies a set reminder).
- Practical rule: first user interaction that chooses a concrete future time commits `reminder` to the draft; navigation-only (month prev/next without selecting a day) does not.

### Data flow

```
User edits panel → onChange({ reminder, repeat })
  → applyReminderInDraft / clearReminderInDraft / direct draft patch
  → parent note editor state
  → Save note (existing mutation path)
```

No intermediate “apply reminder” step.

### Styles

- Reuse existing reminder CSS (calendar, chips, recurrence).
- Drop second-dialog sizing/overlay assumptions; nest under `.modal-dialog` as a section (e.g. `.reminder-setup-panel`).
- Note dialog may grow taller; allow content/reminder area to scroll if needed so footer actions stay reachable.

## Testing

- Update or replace any tests that assume nested modal / “Save reminder”.
- Prefer small unit coverage:
  - Clear → draft reminder/repeat null
  - Past time → note Save disabled / invalid
  - Selecting a day/time updates draft without a separate save action

## Implementation notes (ponytail)

- Extract, don’t rewrite calendar/time helpers.
- Fewest files: panel extract + `NoteEditorModal` wire + CSS tweak + delete unused modal.
- No shared-package moves unless a second consumer appears.
