import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite/next';

const showNow = jest.fn();
const scheduleNotificationAsync = jest.fn(async () => 'expo-id');
const getDb = jest.fn<() => Promise<SQLiteDatabase>>();
const hasNotificationSentWithin = jest.fn(async () => false);
const recordNotificationSent = jest.fn(
  async (_db: SQLiteDatabase, _reminderId: string, _eventId: string, _source: string) => undefined,
);
const cleanOldRecords = jest.fn(async () => 0);
const netInfoFetch = jest.fn(async () => ({
  isConnected: true,
  isInternetReachable: true,
}));

jest.mock('react-native', () => ({
  NativeModules: {
    ReminderModule: {
      showNow,
    },
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('expo-notifications', () => ({
  AndroidNotificationPriority: {
    MAX: 'max',
  },
  scheduleNotificationAsync,
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: netInfoFetch,
  },
}));

jest.mock('../../src/db/bootstrap', () => ({
  getDb,
}));

jest.mock('../../src/db/notesRepo', () => ({
  getNoteById: jest.fn(async () => null),
  upsertNote: jest.fn(async () => undefined),
  deleteNote: jest.fn(async () => undefined),
}));

jest.mock('../../src/sync/fetchReminder', () => ({
  fetchReminder: jest.fn(async () => ({ status: 'not_found' })),
}));

jest.mock('../../src/reminders/notificationLedger', () => ({
  hasNotificationSentWithin,
  recordNotificationSent,
  cleanOldRecords,
}));

import { handleFcmMessage } from '../../src/sync/fcmMessageHandler';

const mockDb = {
  getFirstAsync: jest.fn(async () => ({ count: 0 })),
  runAsync: jest.fn(async () => undefined),
} as unknown as SQLiteDatabase;

describe('FCM reminder trigger delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDb.mockResolvedValue(mockDb);
    hasNotificationSentWithin.mockResolvedValue(false);
  });

  it('shows only the native immediate FCM notification for a trigger reminder', async () => {
    await handleFcmMessage({
      messageId: 'message-1',
      data: {
        type: 'trigger_reminder',
        reminderId: 'note-1',
        eventId: 'note-1-123',
        title: 'Renew passport',
        body: 'Bring photos',
      },
    });

    expect(showNow).toHaveBeenCalledTimes(1);
    expect(showNow).toHaveBeenCalledWith(
      'note-1',
      'Renew passport',
      'Bring photos',
      'note-1-123',
    );
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(recordNotificationSent).toHaveBeenCalledWith(mockDb, 'note-1', 'note-1-123', 'fcm');
  });
});
