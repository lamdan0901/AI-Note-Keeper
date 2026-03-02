import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, getResolvedTimezone, updateNote, USER_ID } from '../src/services/notes';
import type { NoteEditorDraft, WebNote } from '../src/services/notesTypes';

function makeDraft(overrides: Partial<NoteEditorDraft> = {}): NoteEditorDraft {
  return {
    id: 'draft-1',
    title: 'Title',
    content: 'Content',
    color: 'default',
    isPinned: false,
    done: false,
    reminder: null,
    repeat: null,
    ...overrides,
  };
}

function makeNote(overrides: Partial<WebNote> = {}): WebNote {
  return {
    id: 'note-1',
    userId: USER_ID,
    title: 'Old title',
    content: 'Old content',
    color: 'default',
    active: true,
    done: false,
    isPinned: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    version: 3,
    ...overrides,
  };
}

describe('notes service payload shaping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('createNote sets reminder fields for a future reminder', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-10T10:00:00.000Z').getTime());
    const sync = vi.fn().mockResolvedValue(undefined);
    const draft = makeDraft({
      reminder: new Date('2026-02-10T10:30:40.500Z'),
      repeat: { kind: 'daily', interval: 2 },
    });

    await createNote(sync, draft);

    const arg = sync.mock.calls[0]?.[0];
    expect(arg.userId).toBe(USER_ID);
    expect(arg.lastSyncAt).toBe(new Date('2026-02-10T10:00:00.000Z').getTime());
    expect(arg.changes).toHaveLength(1);
    expect(arg.changes[0]).toMatchObject({
      id: 'draft-1',
      operation: 'create',
      triggerAt: new Date('2026-02-10T10:30:00.000Z').getTime(),
      repeatRule: 'daily',
      repeatConfig: { interval: 2 },
      scheduleStatus: 'unscheduled',
      timezone: getResolvedTimezone(),
      done: false,
    });
    expect(arg.changes[0]).not.toHaveProperty('repeat');
    expect(arg.changes[0]).not.toHaveProperty('startAt');
    expect(arg.changes[0]).not.toHaveProperty('baseAtLocal');
    expect(arg.changes[0]).not.toHaveProperty('nextTriggerAt');
  });

  it('updateNote clears reminder fields when draft has no reminder', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-10T10:00:00.000Z').getTime());
    const sync = vi.fn().mockResolvedValue(undefined);
    const draft = makeDraft({ id: 'note-1', reminder: null, repeat: null });
    const existing = makeNote();

    await updateNote(sync, draft, existing);

    const change = sync.mock.calls[0]?.[0]?.changes?.[0];
    expect(change).toMatchObject({
      id: 'note-1',
      operation: 'update',
      triggerAt: undefined,
      repeatRule: 'none',
      repeatConfig: null,
      scheduleStatus: undefined,
      done: false,
      version: 3,
      createdAt: 1_000,
    });
  });

  it('createNote clears reminder fields when draft is done even if reminder is provided', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-10T10:00:00.000Z').getTime());
    const sync = vi.fn().mockResolvedValue(undefined);
    const draft = makeDraft({
      done: true,
      reminder: new Date('2026-02-10T10:30:00.000Z'),
      repeat: { kind: 'daily', interval: 1 },
    });

    await createNote(sync, draft);

    const change = sync.mock.calls[0]?.[0]?.changes?.[0];
    expect(change).toMatchObject({
      done: true,
      triggerAt: undefined,
      repeatRule: 'none',
      repeatConfig: null,
      scheduleStatus: undefined,
    });
  });

  it('updateNote clears reminder fields when draft is marked done', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-02-10T10:00:00.000Z').getTime());
    const sync = vi.fn().mockResolvedValue(undefined);
    const draft = makeDraft({
      id: 'note-1',
      done: true,
      reminder: new Date('2026-02-10T10:30:00.000Z'),
      repeat: { kind: 'weekly', interval: 1, weekdays: [2] },
    });
    const existing = makeNote();

    await updateNote(sync, draft, existing);

    const change = sync.mock.calls[0]?.[0]?.changes?.[0];
    expect(change).toMatchObject({
      done: true,
      triggerAt: undefined,
      repeatRule: 'none',
      repeatConfig: null,
      scheduleStatus: undefined,
      operation: 'update',
    });
  });
});
