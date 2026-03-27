import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite/next';

const cancelNative = jest.fn();
const cancelScheduledNotificationAsync = jest.fn(async () => undefined);
const mockedUpsertNote = jest.fn(async () => undefined);
const mockedEnqueueNoteOperation = jest.fn(async () => undefined);

jest.mock('react-native', () => ({
  NativeModules: {
    ReminderModule: {
      cancel: cancelNative,
    },
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync,
}));

jest.mock('../../src/db/notesRepo', () => {
  const actual = jest.requireActual('../../src/db/notesRepo') as Record<string, unknown>;
  return {
    ...actual,
    upsertNote: mockedUpsertNote,
  };
});

jest.mock('../../src/sync/noteOutbox', () => ({
  enqueueNoteOperation: mockedEnqueueNoteOperation,
}));

import { deleteNote, hardDeleteAllInactive, hardDeleteNote, type Note } from '../../src/db/notesRepo';
import { deleteNoteOffline } from '../../src/notes/editor';
import { clearNoteNotificationState } from '../../src/reminders/noteNotificationCleanup';
import { scheduleNoteReminderNotification } from '../../src/reminders/scheduleNoteReminder';

type MockDb = {
  getFirstAsync: jest.Mock;
  getAllAsync: jest.Mock;
  runAsync: jest.Mock;
};

const createDb = (existingState: unknown = null, allRows: unknown[] = []): MockDb => ({
  getFirstAsync: jest.fn(async () => existingState),
  getAllAsync: jest.fn(async () => allRows),
  runAsync: jest.fn(async () => undefined),
});

const baseNote: Note = {
  id: 'note-1',
  userId: 'user-1',
  title: 'Renew passport',
  content: 'Bring photos',
  color: null,
  active: true,
  done: false,
  triggerAt: Date.now() + 60_000,
  repeatRule: 'daily',
  repeatConfig: { interval: 1 },
  scheduleStatus: 'scheduled',
  timezone: 'Asia/Bangkok',
  updatedAt: 100,
  createdAt: 50,
};

const existingScheduleState = {
  noteId: 'note-1',
  notificationIdsJson: '["note-1"]',
  lastScheduledHash: 'hash-1',
  status: 'scheduled',
  lastScheduledAt: 123,
  lastError: null,
};

const asSqliteDb = (db: MockDb): SQLiteDatabase => db as unknown as SQLiteDatabase;

const baseNoteRow = {
  id: 'note-1',
  userId: 'user-1',
  title: 'Renew passport',
  content: 'Bring photos',
  contentType: null,
  color: null,
  active: 1,
  done: 0,
  isPinned: 0,
  triggerAt: Date.now() + 60_000,
  repeatRule: 'daily',
  repeatConfig: JSON.stringify({ interval: 1 }),
  snoozedUntil: null,
  scheduleStatus: 'scheduled',
  timezone: 'Asia/Bangkok',
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
  updatedAt: 100,
  createdAt: 50,
};

describe('note notification cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears visible and scheduled notification state for a deleted note', async () => {
    const db = createDb(existingScheduleState);

    await clearNoteNotificationState(asSqliteDb(db), 'note-1');

    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM note_schedule_meta WHERE noteId = ?', [
      'note-1',
    ]);
    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM notification_ledger WHERE reminderId = ?',
      ['note-1'],
    );
  });

  it('routes soft delete through full notification cleanup', async () => {
    const db = createDb(existingScheduleState);

    await deleteNoteOffline(asSqliteDb(db), baseNote, 'user-1');

    const upsertArgs = (mockedUpsertNote.mock.calls[0] ?? []) as unknown[];
    const outboxArgs = (mockedEnqueueNoteOperation.mock.calls[0] ?? []) as unknown[];

    expect(upsertArgs[0]).toBe(db);
    expect(upsertArgs[1]).toEqual(
      expect.objectContaining({
        id: 'note-1',
        active: false,
        deletedAt: expect.any(Number),
      }),
    );
    expect(outboxArgs[0]).toBe(db);
    expect(outboxArgs[1]).toEqual(
      expect.objectContaining({
        id: 'note-1',
        active: false,
      }),
    );
    expect(outboxArgs[2]).toBe('delete');
    expect(outboxArgs[3]).toBe('user-1');
    expect(outboxArgs[4]).toEqual(expect.any(Number));
    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM notification_ledger WHERE reminderId = ?',
      ['note-1'],
    );
  });

  it('does not schedule reminders for inactive deleted notes with stale trigger data', async () => {
    const db = createDb(existingScheduleState);

    const deletedNote: Note = {
      ...baseNote,
      active: false,
      deletedAt: Date.now(),
    };

    const notificationIds = await scheduleNoteReminderNotification(
      asSqliteDb(db),
      deletedNote,
      'user-1',
    );

    expect(notificationIds).toEqual([]);
    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM note_schedule_meta WHERE noteId = ?', [
      'note-1',
    ]);
    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM notification_ledger WHERE reminderId = ?',
      ['note-1'],
    );
    expect(cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('clears notification state when a server-driven delete marks a note inactive', async () => {
    const db = createDb(baseNoteRow);

    const deleted = await deleteNote(asSqliteDb(db), 'note-1');

    expect(deleted).toEqual(
      expect.objectContaining({
        id: 'note-1',
        active: false,
        deletedAt: expect.any(Number),
      }),
    );
    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM notification_ledger WHERE reminderId = ?',
      ['note-1'],
    );
  });

  it('clears notification state before permanently deleting one trashed note', async () => {
    const db = createDb(existingScheduleState);

    await hardDeleteNote(asSqliteDb(db), 'note-1');

    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM note_schedule_meta WHERE noteId = ?', [
      'note-1',
    ]);
    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM notification_ledger WHERE reminderId = ?',
      ['note-1'],
    );
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM notes WHERE id = ?', ['note-1']);
  });

  it('clears notification state for every trashed note when emptying trash', async () => {
    const db = createDb(null, [{ id: 'note-1' }, { id: 'note-2' }]);

    await hardDeleteAllInactive(asSqliteDb(db), 'user-1');

    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(cancelNative).toHaveBeenCalledWith('note-2');
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM note_schedule_meta WHERE noteId = ?', [
      'note-1',
    ]);
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM note_schedule_meta WHERE noteId = ?', [
      'note-2',
    ]);
    expect(db.runAsync).toHaveBeenCalledWith(
      'DELETE FROM notes WHERE active = 0 AND userId = ?',
      ['user-1'],
    );
  });
});
