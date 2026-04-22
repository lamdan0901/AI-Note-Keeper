import { describe, expect, it } from 'vitest';
import { sortNotes } from '../src/services/notesUtils';
import type { WebNote } from '../src/services/notesTypes';
import { mergeOptimisticNotes, reconcileOptimisticNotes } from '../src/pages/notesOptimistic';

function makeNote(overrides: Partial<WebNote> = {}): WebNote {
  return {
    id: 'note-1',
    userId: 'user-1',
    title: 'Note',
    content: 'Body',
    color: 'default',
    active: true,
    done: false,
    isPinned: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('notes optimistic overlay helpers', () => {
  it('keeps a pinned optimistic update applied while server data is still stale', () => {
    const staleServerNotes = [makeNote({ id: 'note-a', isPinned: false, updatedAt: 100 })];
    const optimisticUpsertsById = {
      'note-a': makeNote({ id: 'note-a', isPinned: true, updatedAt: 200 }),
    };

    const reconciled = reconcileOptimisticNotes(staleServerNotes, optimisticUpsertsById, new Set());
    const merged = sortNotes(
      mergeOptimisticNotes(
        staleServerNotes,
        reconciled.optimisticUpsertsById,
        reconciled.optimisticDeletedIds,
      ).filter((note) => note.active),
    );

    expect(reconciled.optimisticUpsertsById['note-a']?.isPinned).toBe(true);
    expect(merged[0]?.id).toBe('note-a');
    expect(merged[0]?.isPinned).toBe(true);
  });

  it('keeps a done-toggle optimistic update applied while server sorting data is stale', () => {
    const staleServerNotes = [
      makeNote({ id: 'note-a', done: false, updatedAt: 150 }),
      makeNote({ id: 'note-b', done: false, updatedAt: 100 }),
    ];
    const optimisticUpsertsById = {
      'note-a': makeNote({ id: 'note-a', done: true, updatedAt: 300 }),
    };

    const reconciled = reconcileOptimisticNotes(staleServerNotes, optimisticUpsertsById, new Set());
    const merged = sortNotes(
      mergeOptimisticNotes(
        staleServerNotes,
        reconciled.optimisticUpsertsById,
        reconciled.optimisticDeletedIds,
      ).filter((note) => note.active),
    );

    expect(merged.map((note) => note.id)).toEqual(['note-b', 'note-a']);
    expect(merged[1]?.done).toBe(true);
  });

  it('keeps a soft-deleted note out of the active list until the server catches up', () => {
    const staleServerNotes = [makeNote({ id: 'note-a', active: true, updatedAt: 100 })];
    const optimisticUpsertsById = {
      'note-a': makeNote({ id: 'note-a', active: false, deletedAt: 200, updatedAt: 200 }),
    };

    const reconciled = reconcileOptimisticNotes(staleServerNotes, optimisticUpsertsById, new Set());
    const merged = mergeOptimisticNotes(
      staleServerNotes,
      reconciled.optimisticUpsertsById,
      reconciled.optimisticDeletedIds,
    );

    expect(merged.filter((note) => note.active)).toEqual([]);
    expect(merged.filter((note) => note.active === false).map((note) => note.id)).toEqual(['note-a']);
  });

  it('keeps an optimistic create visible until the server returns the created note', () => {
    const optimisticCreated = makeNote({
      id: 'new-note',
      title: 'Created',
      updatedAt: 500,
      createdAt: 500,
    });
    const optimisticUpsertsById = {
      'new-note': optimisticCreated,
    };

    const reconciled = reconcileOptimisticNotes([], optimisticUpsertsById, new Set());
    const merged = mergeOptimisticNotes(
      [],
      reconciled.optimisticUpsertsById,
      reconciled.optimisticDeletedIds,
    );

    expect(merged).toEqual([optimisticCreated]);
  });
});
