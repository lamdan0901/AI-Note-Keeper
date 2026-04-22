import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite/next';
import type { Note } from '../../src/db/notesRepo';

const cancelNative = jest.fn();
const scheduleNative = jest.fn();
const hasExactAlarmPermission = jest.fn(async () => true);
const netInfoFetch = jest.fn<
  () => Promise<{ isConnected: boolean; isInternetReachable: boolean }>
>();
const listNotes = jest.fn<(db: unknown, limit: number) => Promise<Note[]>>();

jest.mock('react-native', () => ({
  NativeModules: {
    ReminderModule: {
      cancel: cancelNative,
      schedule: scheduleNative,
      hasExactAlarmPermission,
    },
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: netInfoFetch,
  },
}));

jest.mock('../../src/db/notesRepo', () => ({
  listNotes,
}));

import {
  syncReminderDeliveryOwnership,
  setReminderDeliveryOwnerForTests,
} from '../../src/reminders/scheduler';
import { scheduleNoteReminderNotification } from '../../src/reminders/scheduleNoteReminder';

type MockDb = {
  getFirstAsync: jest.Mock;
  runAsync: jest.Mock;
};

const createDb = (firstResults: unknown[] = []): MockDb => {
  const queue = [...firstResults];
  return {
    getFirstAsync: jest.fn(async () => queue.shift() ?? null),
    runAsync: jest.fn(async () => undefined),
  };
};

const asSqliteDb = (db: MockDb): SQLiteDatabase => db as unknown as SQLiteDatabase;

const baseNote: Note = {
  id: 'note-1',
  userId: 'user-1',
  title: 'Renew passport',
  content: 'Bring photos',
  contentType: undefined,
  color: null,
  active: true,
  done: false,
  triggerAt: Date.now() + 60_000,
  repeatRule: 'daily',
  repeatConfig: { interval: 1 },
  repeat: undefined,
  scheduleStatus: 'scheduled',
  timezone: 'Asia/Bangkok',
  snoozedUntil: undefined,
  baseAtLocal: undefined,
  startAt: undefined,
  nextTriggerAt: undefined,
  lastFiredAt: undefined,
  lastAcknowledgedAt: undefined,
  version: 0,
  deletedAt: undefined,
  isPinned: false,
  syncStatus: 'synced',
  serverVersion: 0,
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

describe('mobile reminder ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setReminderDeliveryOwnerForTests(null);
    netInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
    listNotes.mockResolvedValue([baseNote]);
  });

  it('uses FCM ownership during bootstrap when the device is online and cancels armed local alarms', async () => {
    const db = createDb([existingScheduleState]);

    const result = await syncReminderDeliveryOwnership(asSqliteDb(db), true, 'app_bootstrap');

    expect(result).toEqual({
      owner: 'fcm',
      previousOwner: null,
      changed: true,
      count: 1,
      source: 'app_bootstrap',
    });
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(scheduleNative).not.toHaveBeenCalled();
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO note_schedule_meta'), [
      'note-1',
      '[]',
      'hash-1',
      'canceled',
      expect.any(Number),
      null,
    ]);
  });

  it('uses local ownership during bootstrap when the device is offline and schedules the reminder locally', async () => {
    const db = createDb([null]);

    const result = await syncReminderDeliveryOwnership(asSqliteDb(db), false, 'app_bootstrap');

    expect(result).toEqual({
      owner: 'local',
      previousOwner: null,
      changed: true,
      count: 1,
      source: 'app_bootstrap',
    });
    expect(scheduleNative).toHaveBeenCalledTimes(1);
    expect(scheduleNative).toHaveBeenCalledWith(
      'note-1',
      baseNote.triggerAt,
      'Renew passport',
      'Bring photos',
      `note-1-${baseNote.triggerAt}`,
    );
    expect(cancelNative).not.toHaveBeenCalled();
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO note_schedule_meta'), [
      'note-1',
      '["note-1"]',
      expect.any(String),
      'scheduled',
      expect.any(Number),
      null,
    ]);
  });

  it('cancels armed local alarms once when ownership transitions from offline local delivery to online FCM delivery', async () => {
    const db = createDb([null, existingScheduleState]);

    const initial = await syncReminderDeliveryOwnership(asSqliteDb(db), false, 'app_bootstrap');
    const transition = await syncReminderDeliveryOwnership(asSqliteDb(db), true, 'network_change');
    const repeated = await syncReminderDeliveryOwnership(asSqliteDb(db), true, 'network_change');

    expect(initial.changed).toBe(true);
    expect(transition).toEqual({
      owner: 'fcm',
      previousOwner: 'local',
      changed: true,
      count: 1,
      source: 'network_change',
    });
    expect(repeated).toEqual({
      owner: 'fcm',
      previousOwner: 'fcm',
      changed: false,
      count: 0,
      source: 'network_change',
    });
    expect(scheduleNative).toHaveBeenCalledTimes(1);
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(cancelNative).toHaveBeenCalledWith('note-1');
  });

  it('does not re-arm a local alarm while online when a note with a reminder is saved', async () => {
    const db = createDb([existingScheduleState]);

    setReminderDeliveryOwnerForTests('fcm');

    const notificationIds = await scheduleNoteReminderNotification(asSqliteDb(db), baseNote, 'user-1');

    expect(notificationIds).toEqual([]);
    expect(cancelNative).toHaveBeenCalledTimes(1);
    expect(cancelNative).toHaveBeenCalledWith('note-1');
    expect(scheduleNative).not.toHaveBeenCalled();
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO note_schedule_meta'), [
      'note-1',
      '[]',
      expect.any(String),
      'canceled',
      expect.any(Number),
      null,
    ]);
  });
});
