import { describe, expect, it } from 'vitest';
import type { NoteEditorDraft } from '../src/services/notesTypes';
import {
  applyReminderInDraft,
  clearReminderInDraft,
  toggleDoneInDraft,
} from '../src/components/NoteEditorModal';

function makeDraft(overrides: Partial<NoteEditorDraft> = {}): NoteEditorDraft {
  return {
    id: 'draft-1',
    title: 'Title',
    content: 'Body',
    color: 'default',
    isPinned: false,
    done: false,
    reminder: new Date('2026-02-12T09:00:00.000Z'),
    repeat: { kind: 'daily', interval: 1 },
    ...overrides,
  };
}

describe('NoteEditorModal draft transitions', () => {
  it('clears reminder and repeat when reminder chip clear is used', () => {
    const next = clearReminderInDraft(makeDraft());
    expect(next.reminder).toBeNull();
    expect(next.repeat).toBeNull();
  });

  it('clears reminder and repeat when toggled to done', () => {
    const next = toggleDoneInDraft(makeDraft({ done: false }));
    expect(next.done).toBe(true);
    expect(next.reminder).toBeNull();
    expect(next.repeat).toBeNull();
  });

  it('keeps reminder cleared and toggles back to not-done', () => {
    const next = toggleDoneInDraft(makeDraft({ done: true, reminder: null, repeat: null }));
    expect(next.done).toBe(false);
    expect(next.reminder).toBeNull();
    expect(next.repeat).toBeNull();
  });

  it('saving a reminder forces done=false', () => {
    const reminder = new Date('2026-02-13T10:30:00.000Z');
    const repeat = { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] } as const;
    const next = applyReminderInDraft(makeDraft({ done: true, reminder: null, repeat: null }), reminder, repeat);
    expect(next.done).toBe(false);
    expect(next.reminder).toEqual(reminder);
    expect(next.repeat).toEqual(repeat);
  });
});
