import { describe, expect, it } from '@jest/globals';
import { resolveNoteConflict } from '../../src/sync/conflictResolution';
import type { Note } from '../../src/db/notesRepo';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'old title',
  content: 'old content',
  color: null,
  active: true,
  done: false,
  isPinned: false,
  updatedAt: 1000,
  createdAt: 1000,
  syncStatus: 'synced',
  serverVersion: 1,
  ...overrides,
});

describe('resolveNoteConflict', () => {
  it('keeps local text edits and updates serverVersion when server also changed', () => {
    const local = makeNote({
      title: 'local title',
      content: 'local content',
      updatedAt: 3000,
      syncStatus: 'pending',
      serverVersion: 1,
    });

    const server = makeNote({
      title: 'server title',
      content: 'server content',
      updatedAt: 2000,
      version: 4,
    } as unknown as Partial<Note>);

    const result = resolveNoteConflict(local, server as Note);

    expect(result.type).toBe('none');
    if (result.type !== 'none') {
      throw new Error('unexpected conflict result');
    }

    expect(result.mergedNote.title).toBe('local title');
    expect(result.mergedNote.content).toBe('local content');
    expect(result.mergedNote.serverVersion).toBe(4);
    expect(result.mergedNote.syncStatus).toBe('pending');
  });

  it('returns local as-is when server version matches', () => {
    const local = makeNote({
      title: 'local title',
      serverVersion: 7,
    });
    const server = makeNote({ version: 7 } as unknown as Partial<Note>);

    const result = resolveNoteConflict(local, server as Note);

    expect(result.type).toBe('none');
    if (result.type !== 'none') {
      throw new Error('unexpected conflict result');
    }
    expect(result.mergedNote.title).toBe('local title');
  });
});
