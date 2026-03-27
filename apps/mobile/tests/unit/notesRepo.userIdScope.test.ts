import { describe, expect, it, jest } from '@jest/globals';
import { hardDeleteAllInactive, listDeletedNotes, listNotes } from '../../src/db/notesRepo';

type MockDb = {
  getAllAsync: jest.Mock;
  runAsync: jest.Mock;
};

const baseRow = {
  id: 'n1',
  userId: 'u1',
  title: 'T',
  content: 'C',
  contentType: null,
  color: null,
  active: 1,
  done: 0,
  isPinned: 0,
  triggerAt: null,
  repeatRule: null,
  repeatConfig: null,
  snoozedUntil: null,
  scheduleStatus: null,
  timezone: null,
  repeat: null,
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: null,
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  version: 0,
  deletedAt: null,
  syncStatus: 'synced',
  serverVersion: 0,
  updatedAt: 1,
  createdAt: 1,
};

const createDb = (): MockDb => ({
  getAllAsync: jest.fn(async () => [baseRow]),
  runAsync: jest.fn(async () => undefined),
});

describe('notes repo userId scoping', () => {
  it('listNotes applies user filter when userId is provided', async () => {
    const db = createDb();

    await listNotes(db as any, 25, 'user-a');

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM notes WHERE active = 1 AND userId = ? ORDER BY isPinned DESC, done ASC, updatedAt DESC LIMIT ?',
      ['user-a', 25],
    );
  });

  it('listNotes keeps legacy behavior when userId is absent', async () => {
    const db = createDb();

    await listNotes(db as any, 10);

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM notes WHERE active = 1 ORDER BY isPinned DESC, done ASC, updatedAt DESC LIMIT ?',
      [10],
    );
  });

  it('listDeletedNotes applies user filter when userId is provided', async () => {
    const db = createDb();

    await listDeletedNotes(db as any, 'user-b');

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM notes WHERE active = 0 AND userId = ? ORDER BY deletedAt DESC, updatedAt DESC',
      ['user-b'],
    );
  });

  it('hardDeleteAllInactive applies scoped delete when userId is provided', async () => {
    const db = createDb();

    await hardDeleteAllInactive(db as any, 'user-c');

    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM notes WHERE active = 0 AND userId = ?', [
      'user-c',
    ]);
  });

  it('hardDeleteAllInactive deletes all inactive notes when no userId is provided', async () => {
    const db = createDb();

    await hardDeleteAllInactive(db as any);

    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM notes WHERE active = 0');
  });
});
