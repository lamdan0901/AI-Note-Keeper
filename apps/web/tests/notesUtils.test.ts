import { describe, it, expect } from 'vitest';
import {
  filterActive,
  sortNotes,
  emptyDraft,
  draftFromNote,
  toPresetId,
} from '../src/services/notesUtils';
import type { WebNote } from '../src/services/notesTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNote(overrides: Partial<WebNote> = {}): WebNote {
  return {
    id: 'note-1',
    userId: 'local-user',
    title: 'Test note',
    content: 'Body',
    color: 'default',
    active: true,
    done: false,
    isPinned: false,
    updatedAt: 1000,
    createdAt: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterActive
// ---------------------------------------------------------------------------

describe('filterActive', () => {
  it('keeps notes with active === true', () => {
    const notes = [makeNote({ id: 'a', active: true })];
    expect(filterActive(notes)).toHaveLength(1);
  });

  it('excludes notes with active === false', () => {
    const notes = [makeNote({ id: 'a', active: false })];
    expect(filterActive(notes)).toHaveLength(0);
  });

  it('filters mixed active/inactive notes correctly', () => {
    const notes = [
      makeNote({ id: 'a', active: true }),
      makeNote({ id: 'b', active: false }),
      makeNote({ id: 'c', active: true }),
    ];
    const result = filterActive(notes);
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('returns empty array when all notes are inactive', () => {
    const notes = [makeNote({ active: false }), makeNote({ active: false })];
    expect(filterActive(notes)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterActive([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sortNotes
// ---------------------------------------------------------------------------

describe('sortNotes', () => {
  it('puts pinned notes before unpinned notes', () => {
    const notes = [
      makeNote({ id: 'unpinned', isPinned: false }),
      makeNote({ id: 'pinned', isPinned: true }),
    ];
    const result = sortNotes(notes);
    expect(result[0].id).toBe('pinned');
    expect(result[1].id).toBe('unpinned');
  });

  it('puts non-done notes before done notes within same pin group', () => {
    const notes = [makeNote({ id: 'done', done: true }), makeNote({ id: 'active', done: false })];
    const result = sortNotes(notes);
    expect(result[0].id).toBe('active');
    expect(result[1].id).toBe('done');
  });

  it('sorts by newest updatedAt first within same done group', () => {
    const notes = [
      makeNote({ id: 'old', updatedAt: 1000 }),
      makeNote({ id: 'new', updatedAt: 2000 }),
    ];
    const result = sortNotes(notes);
    expect(result[0].id).toBe('new');
    expect(result[1].id).toBe('old');
  });

  it('respects full ordering: pinned > non-done > done > newest first', () => {
    const pinnedActive = makeNote({
      id: 'pinned-active',
      isPinned: true,
      done: false,
      updatedAt: 100,
    });
    const pinnedDone = makeNote({ id: 'pinned-done', isPinned: true, done: true, updatedAt: 200 });
    const unpinnedActive = makeNote({
      id: 'unpinned-active',
      isPinned: false,
      done: false,
      updatedAt: 300,
    });
    const unpinnedDone = makeNote({
      id: 'unpinned-done',
      isPinned: false,
      done: true,
      updatedAt: 400,
    });

    const result = sortNotes([unpinnedDone, unpinnedActive, pinnedDone, pinnedActive]);
    expect(result.map((n) => n.id)).toEqual([
      'pinned-active',
      'pinned-done',
      'unpinned-active',
      'unpinned-done',
    ]);
  });

  it('does not mutate the input array', () => {
    const notes = [makeNote({ id: 'b', updatedAt: 1 }), makeNote({ id: 'a', updatedAt: 2 })];
    const original = [...notes];
    sortNotes(notes);
    expect(notes.map((n) => n.id)).toEqual(original.map((n) => n.id));
  });

  it('returns empty array for empty input', () => {
    expect(sortNotes([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// emptyDraft
// ---------------------------------------------------------------------------

describe('emptyDraft', () => {
  it('returns a draft with all required fields present', () => {
    const draft = emptyDraft();
    expect(draft).toHaveProperty('id');
    expect(draft).toHaveProperty('title');
    expect(draft).toHaveProperty('content');
    expect(draft).toHaveProperty('color');
    expect(draft).toHaveProperty('isPinned');
    expect(draft).toHaveProperty('done');
    expect(draft).toHaveProperty('reminder');
    expect(draft).toHaveProperty('repeat');
  });

  it('id is undefined for a new draft', () => {
    expect(emptyDraft().id).toBeUndefined();
  });

  it('title and content default to empty string', () => {
    const draft = emptyDraft();
    expect(draft.title).toBe('');
    expect(draft.content).toBe('');
  });

  it('color defaults to "default"', () => {
    expect(emptyDraft().color).toBe('default');
  });

  it('isPinned defaults to false', () => {
    expect(emptyDraft().isPinned).toBe(false);
  });

  it('done defaults to false', () => {
    expect(emptyDraft().done).toBe(false);
  });

  it('reminder and repeat default to null', () => {
    const draft = emptyDraft();
    expect(draft.reminder).toBeNull();
    expect(draft.repeat).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// draftFromNote
// ---------------------------------------------------------------------------

describe('draftFromNote', () => {
  it('maps id correctly', () => {
    const note = makeNote({ id: 'abc-123' });
    expect(draftFromNote(note).id).toBe('abc-123');
  });

  it('maps title, content, isPinned, done', () => {
    const note = makeNote({ title: 'Hello', content: 'World', isPinned: true, done: true });
    const draft = draftFromNote(note);
    expect(draft.title).toBe('Hello');
    expect(draft.content).toBe('World');
    expect(draft.isPinned).toBe(true);
    expect(draft.done).toBe(true);
  });

  it('converts null title to empty string', () => {
    const note = makeNote({ title: null });
    expect(draftFromNote(note).title).toBe('');
  });

  it('converts null content to empty string', () => {
    const note = makeNote({ content: null });
    expect(draftFromNote(note).content).toBe('');
  });

  it('normalises color preset ID', () => {
    const note = makeNote({ color: 'blue' });
    expect(draftFromNote(note).color).toBe('blue');
  });

  it('normalises legacy hex color to preset ID', () => {
    const note = makeNote({ color: '#ff9292' });
    expect(draftFromNote(note).color).toBe('red');
  });

  it('falls back to "default" for unknown color', () => {
    const note = makeNote({ color: '#000000' });
    expect(draftFromNote(note).color).toBe('default');
  });

  it('falls back to "default" for null color', () => {
    const note = makeNote({ color: null });
    expect(draftFromNote(note).color).toBe('default');
  });

  it('derives reminder from effective trigger precedence', () => {
    const note = makeNote({ triggerAt: 1_000, nextTriggerAt: 2_000, snoozedUntil: 3_000 });
    expect(draftFromNote(note).reminder?.getTime()).toBe(3_000);
  });

  it('derives repeat from repeat rule and config', () => {
    const note = makeNote({
      triggerAt: new Date('2026-02-10T09:00:00.000Z').getTime(),
      repeatRule: 'weekly',
      repeatConfig: { interval: 2, weekdays: [1, 4] },
    });
    expect(draftFromNote(note).repeat).toEqual({
      kind: 'weekly',
      interval: 2,
      weekdays: [1, 4],
    });
  });
});

// ---------------------------------------------------------------------------
// toPresetId (colour normalisation)
// ---------------------------------------------------------------------------

describe('toPresetId', () => {
  it('returns "default" for null', () => {
    expect(toPresetId(null)).toBe('default');
  });

  it('returns "default" for undefined', () => {
    expect(toPresetId(undefined)).toBe('default');
  });

  it('returns "default" for empty string', () => {
    expect(toPresetId('')).toBe('default');
  });

  it('passes through valid preset IDs unchanged', () => {
    const presets = ['default', 'red', 'yellow', 'green', 'blue', 'purple'] as const;
    for (const p of presets) {
      expect(toPresetId(p)).toBe(p);
    }
  });

  it('maps known legacy hex strings to preset IDs', () => {
    expect(toPresetId('#ff9292')).toBe('red');
    expect(toPresetId('#ffdd77')).toBe('yellow');
    expect(toPresetId('#76faa7')).toBe('green');
    expect(toPresetId('#82b2ff')).toBe('blue');
    expect(toPresetId('#cb93ff')).toBe('purple');
  });

  it('returns "default" for unknown values', () => {
    expect(toPresetId('#cccccc')).toBe('default');
    expect(toPresetId('hotpink')).toBe('default');
  });
});
