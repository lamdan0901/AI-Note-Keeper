# Inline Note Reminder Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed reminder setup controls inside the web note editor modal (always visible below content), remove the nested reminder modal, and keep a single Save path with live draft updates.

**Architecture:** Extract the body of `ReminderSetupModal` into a controlled `ReminderSetupPanel` that calls `onChange` on every user set/clear action. `NoteEditorModal` always renders the panel under content, wires draft via existing `applyReminderInDraft` / `clearReminderInDraft`, and disables note Save when a set reminder is in the past. Delete the unused nested modal wrapper.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (`apps/web`), existing Lucide icons + CSS in `apps/web/src/styles.css`.

**Spec:** `docs/superpowers/designs/2026-07-24-inline-note-reminder-panel-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| Create `apps/web/src/components/reminders/ReminderSetupPanel.tsx` | Always-visible reminder UI: presets, calendar, time, recurrence, clear, past-time error. Controlled props. |
| Modify `apps/web/src/components/NoteEditorModal.tsx` | Mount panel; remove nested modal state; disable Save when reminder past; simplify Escape/Ctrl+Enter. |
| Delete `apps/web/src/components/reminders/ReminderSetupModal.tsx` | No remaining callers after wire-up. |
| Modify `apps/web/src/styles.css` | Panel section styles; slightly wider note dialog; drop dead footer-chip / nested-modal-only rules as needed. |
| Modify `apps/web/tests/noteEditorModal.test.ts` | Keep draft helpers; add `isReminderBlockingSave` coverage. |

---

### Task 1: Save-guard helper (TDD)

**Files:**
- Modify: `apps/web/src/components/NoteEditorModal.tsx`
- Modify: `apps/web/tests/noteEditorModal.test.ts`

- [ ] **Step 1: Write failing tests for past-reminder save block**

Append to `apps/web/tests/noteEditorModal.test.ts`:

```ts
import {
  applyReminderInDraft,
  clearReminderInDraft,
  isReminderBlockingSave,
  toggleDoneInDraft,
} from '../src/components/NoteEditorModal';

// ... existing tests ...

describe('isReminderBlockingSave', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('does not block when reminder is null', () => {
    expect(isReminderBlockingSave(null, now)).toBe(false);
  });

  it('does not block when reminder is in the future', () => {
    expect(isReminderBlockingSave(new Date('2026-07-24T13:00:00.000Z'), now)).toBe(false);
  });

  it('blocks when reminder is equal to now', () => {
    expect(isReminderBlockingSave(new Date('2026-07-24T12:00:00.000Z'), now)).toBe(true);
  });

  it('blocks when reminder is in the past', () => {
    expect(isReminderBlockingSave(new Date('2026-07-24T11:59:00.000Z'), now)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run:

```bash
npm test --prefix apps/web -- noteEditorModal.test.ts
```

Expected: FAIL — `isReminderBlockingSave` is not exported / not defined.

- [ ] **Step 3: Minimal implementation**

In `apps/web/src/components/NoteEditorModal.tsx`, add export near the other draft helpers:

```ts
export function isReminderBlockingSave(reminder: Date | null, now: Date): boolean {
  return reminder !== null && reminder.getTime() <= now.getTime();
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:

```bash
npm test --prefix apps/web -- noteEditorModal.test.ts
```

Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NoteEditorModal.tsx apps/web/tests/noteEditorModal.test.ts
git commit -m "feat(web): add isReminderBlockingSave helper for note save"
```

---

### Task 2: Extract `ReminderSetupPanel`

**Files:**
- Create: `apps/web/src/components/reminders/ReminderSetupPanel.tsx`
- (Do not delete `ReminderSetupModal.tsx` yet — next tasks still import it until Task 3.)

- [ ] **Step 1: Create panel with controlled live API**

Create `apps/web/src/components/reminders/ReminderSetupPanel.tsx` by moving the **body** (helpers + calendar/time/recurrence UI) out of `ReminderSetupModal.tsx`.

**Public API:**

```ts
import type { RepeatRule } from '../../services/notesTypes';

export type ReminderSetupPanelProps = {
  reminder: Date | null;
  repeat: RepeatRule | null;
  now?: Date;
  onChange: (payload: { reminder: Date | null; repeat: RepeatRule | null }) => void;
};
```

**Behavior rules (must match spec):**

1. **Local UI state** for `selectedDate` / `viewMonth` / local `repeat`, seeded from props:
   - `selectedDate = getInitialReminderDate(reminder, now)`
   - local `repeat = repeat` prop
2. **Sync when props change** (edit existing note opens with reminder): when `reminder` / `repeat` props change, reset local selected date + repeat from props (use a small effect or key from parent if simpler — prefer effect on `reminder?.getTime()` + serialized repeat).
3. **Do not call `onChange` for month prev/next only.**
4. **Commit on user set actions** (preset select, day select, time input, quick time, recurrence change):

```ts
const commit = (nextDate: Date, nextRepeat: RepeatRule | null) => {
  setSelectedDate(nextDate);
  setRepeat(nextRepeat);
  onChange({ reminder: nextDate, repeat: nextRepeat });
};
```

5. **Clear:**

```ts
const handleClear = () => {
  const nextSelected = getInitialReminderDate(null, providedNow ?? new Date());
  setSelectedDate(nextSelected);
  setViewMonth(startOfMonth(nextSelected));
  setRepeat(null);
  onChange({ reminder: null, repeat: null });
};
```

6. **Past error:** if `reminder !== null` (prop — committed draft) and `selectedDate/reminder <= liveNow`, show:

```tsx
{error && <p className="reminder-setup-modal__error">{error}</p>}
```

Use committed draft for blocking truth: error when `reminder != null && reminder.getTime() <= liveNow.getTime()` OR when local selection has been committed (same as prop). Simplest: parent owns truth; panel shows error when `reminder !== null && reminder.getTime() <= liveNow.getTime()`. While user is mid-edit, keep local `selectedDate` in sync and commit on each change so prop stays current.

7. **UI structure** (no overlay, no modal header, no Cancel/Save reminder):

```tsx
export function ReminderSetupPanel({ reminder, repeat, now, onChange }: ReminderSetupPanelProps) {
  // ... state + effects from modal, adapted ...

  return (
    <section className="reminder-setup-panel" aria-label="Reminder">
      <div className="reminder-setup-panel__header">
        <h3 className="reminder-setup-panel__title">Reminder</h3>
        {reminder ? (
          <button
            type="button"
            className="modal-dialog__reminder-clear"
            onClick={handleClear}
            aria-label="Clear reminder"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {/* optional status when set */}
      {reminderLabel ? (
        <p className="reminder-setup-panel__status">{reminderLabel}</p>
      ) : (
        <p className="reminder-setup-panel__status reminder-setup-panel__status--empty">
          No reminder
        </p>
      )}

      <ReminderPresetDropdown now={liveNow} onSelect={(date) => commit(date, repeatState)} />

      {/* calendar section — same markup as ReminderSetupModal */}
      {/* time group — same markup */}
      <RecurrencePicker
        value={repeatState}
        onChange={(nextRepeat) => commit(selectedDate, nextRepeat)}
        selectedDate={selectedDate}
      />

      {error && <p className="reminder-setup-modal__error">{error}</p>}
    </section>
  );
}
```

Copy helpers unchanged from modal: `QUICK_TIMES`, `WEEKDAY_LABELS`, `toTimeInputValue`, `startOfDay`, `startOfMonth`, `addMonths`, `isSameDate`, `buildCalendarDays`, `withTime`, `withQuickTime`, calendar wheel effect.

**Import `formatReminder`** for status label:

```ts
import { formatReminder, getInitialReminderDate } from '../../services/reminderUtils';
```

```ts
const reminderLabel = reminder ? formatReminder(reminder, repeat) : null;
```

- [ ] **Step 2: Typecheck / lint panel only path**

Run:

```bash
npm run lint --prefix apps/web
```

Expected: no new errors in `ReminderSetupPanel.tsx`. Fix any unused imports (no `onSave` / `onClose`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/reminders/ReminderSetupPanel.tsx
git commit -m "feat(web): extract ReminderSetupPanel for inline note editor"
```

---

### Task 3: Wire panel into `NoteEditorModal`

**Files:**
- Modify: `apps/web/src/components/NoteEditorModal.tsx`

- [ ] **Step 1: Replace nested modal with always-visible panel**

Changes in `NoteEditorModal.tsx`:

1. Replace import:

```ts
import { ReminderSetupPanel } from './reminders/ReminderSetupPanel';
// remove: ReminderSetupModal
```

2. Remove `const [reminderOpen, setReminderOpen] = useState(false);`

3. Simplify keyboard handler (no nested close):

```ts
const handleKeyDown = useCallback(
  (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      if (!isBothEmpty && !isReminderBlockingSave(draft.reminder, new Date())) {
        e.preventDefault();
        onSave();
      }
    }
  },
  [onClose, onSave, isBothEmpty, draft.reminder],
);
```

4. After content area, before footer, insert:

```tsx
<ReminderSetupPanel
  reminder={draft.reminder}
  repeat={draft.repeat}
  onChange={({ reminder, repeat }) => {
    if (reminder === null) {
      onChange(clearReminderInDraft(draft));
      return;
    }
    onChange(applyReminderInDraft(draft, reminder, repeat));
  }}
/>
```

5. **Footer:** remove the entire reminder chip / trigger block from `modal-dialog__footer-top`. Keep color picker only:

```tsx
<div className="modal-dialog__footer-top">
  <div className="modal-dialog__color-picker" role="group" aria-label="Note colour">
    {/* existing swatches */}
  </div>
</div>
```

6. Remove unused `Bell` import if no longer used; remove `formatReminder` / `reminderLabel` if only used by chip.

7. **Save button:**

```tsx
const reminderBlocksSave = isReminderBlockingSave(draft.reminder, new Date());
// ...
<button
  className="modal-dialog__save-btn"
  onClick={() => onSave()}
  disabled={isBothEmpty || reminderBlocksSave}
  aria-label="Save note"
  type="button"
>
  Save
</button>
```

8. Delete trailing:

```tsx
{reminderOpen && (
  <ReminderSetupModal ... />
)}
```

- [ ] **Step 2: Run unit tests**

Run:

```bash
npm test --prefix apps/web -- noteEditorModal.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/NoteEditorModal.tsx
git commit -m "feat(web): embed reminder panel in note editor modal"
```

---

### Task 4: CSS layout for inline panel

**Files:**
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add panel section + widen note dialog slightly**

Near existing `.modal-dialog` / reminder rules:

1. Widen note dialog enough for calendar (was 520px; nested reminder was 616px):

```css
.modal-dialog {
  /* existing props ... */
  max-width: 560px; /* was 520px */
  max-height: 90vh;
  overflow-y: auto;
}
```

2. Add panel layout (keep reusing `.reminder-setup-modal__*` chip/time/error classes for less churn):

```css
.reminder-setup-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--modal-border-soft);
}

.reminder-setup-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reminder-setup-panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--modal-fg-primary);
}

.reminder-setup-panel__status {
  margin: 0;
  font-size: 13px;
  color: var(--modal-fg-secondary);
}

.reminder-setup-panel__status--empty {
  color: var(--modal-fg-placeholder);
  font-style: italic;
}
```

3. Optional cleanup (only if unused after Task 3): remove or leave dead `.modal-dialog__reminder-trigger` / chip rules — **prefer leave** for now (Clear still uses `.modal-dialog__reminder-clear`). Remove `.reminder-setup-modal` max-width shell and `__actions` if nothing uses them after modal delete; can wait until Task 5.

- [ ] **Step 2: Manual visual sanity (optional if no browser)**

If `npm run dev:web` available: open New note → confirm stack title → content → reminder → footer; set preset → label updates; Clear → “No reminder”; set past time if possible → Save disabled.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "style(web): layout for inline reminder panel in note modal"
```

---

### Task 5: Delete nested `ReminderSetupModal`

**Files:**
- Delete: `apps/web/src/components/reminders/ReminderSetupModal.tsx`

- [ ] **Step 1: Confirm no remaining imports**

Run:

```bash
rg "ReminderSetupModal" apps/web
```

Expected: no matches (or only history/docs outside `apps/web`). If any remain, fix them first.

- [ ] **Step 2: Delete file**

Delete `apps/web/src/components/reminders/ReminderSetupModal.tsx`.

- [ ] **Step 3: Clean CSS shells only used by deleted modal**

In `apps/web/src/styles.css`, remove if unused:

- `.reminder-setup-modal { max-width: 616px; ... }`
- `.reminder-setup-modal__title`
- `.reminder-setup-modal__actions`

Keep: calendar, chips, time group, error, preset, recurrence styles.

- [ ] **Step 4: Run web tests + lint**

```bash
npm test --prefix apps/web
npm run lint --prefix apps/web
```

Expected: tests pass; lint clean for touched files.

- [ ] **Step 5: Commit**

```bash
git add -u apps/web/src/components/reminders/ReminderSetupModal.tsx apps/web/src/styles.css
git commit -m "refactor(web): remove nested ReminderSetupModal"
```

---

### Task 6: Final verification

**Files:** none new

- [ ] **Step 1: Run full web unit suite once**

```bash
npm test --prefix apps/web
```

Expected: all pass.

- [ ] **Step 2: Lint web**

```bash
npm run lint --prefix apps/web
```

Expected: no errors from this change.

- [ ] **Step 3: Smoke checklist (human or agent with browser)**

- [ ] New note: panel visible under content; status “No reminder”
- [ ] Pick preset → status shows formatted time; draft would save with reminder
- [ ] Clear → null reminder
- [ ] Edit note with existing reminder → panel shows that date
- [ ] Past time selected → error text + Save disabled
- [ ] Esc closes note modal; no second overlay
- [ ] Ctrl+Enter saves when valid; blocked when past reminder
- [ ] Mark Done still clears reminder (existing helper)

No extra commit unless fixes needed.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Always-visible section below content, above footer | 3, 4 |
| Live draft onChange; single note Save | 2, 3 |
| Default none + Clear | 2, 3 |
| Past time blocks Save + error text | 1, 2, 3 |
| No nested modal / Cancel / Save reminder | 3, 5 |
| Esc / Ctrl+Enter behavior | 3 |
| Done still clears reminder | unchanged helpers; Task 6 smoke |
| Web only | all tasks under `apps/web` |
| Extract panel, delete modal | 2, 5 |

## Self-review notes

- No TBD placeholders.
- `isReminderBlockingSave` / `applyReminderInDraft` / `clearReminderInDraft` names consistent across tasks.
- Panel commits on set actions only; month nav does not write draft.
- `ReminderSetupModal` deleted only after `NoteEditorModal` no longer imports it.
