import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const claimedEventIds = new Set<string>();
const visibleNotifications: Array<{ reminderId: string; eventId: string }> = [];

const showNow = jest.fn((reminderId: string, _title: string, _body: string, eventId: string) => {
  // Simulate native atomic claim behavior: only first claim is visible.
  if (claimedEventIds.has(eventId)) {
    return;
  }
  claimedEventIds.add(eventId);
  visibleNotifications.push({ reminderId, eventId });
});

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: {
    ReminderModule: {
      showNow,
    },
  },
}));

jest.mock('expo-notifications', () => ({
  AndroidNotificationPriority: { MAX: 'max' },
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('noop')),
}));

jest.mock('../../src/reminders/logging', () => ({
  logSyncEvent: jest.fn(),
  logScheduleEvent: jest.fn(),
}));

jest.mock('../../src/db/bootstrap', () => ({
  getDb: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../../src/db/notesRepo', () => ({
  upsertNote: jest.fn(() => Promise.resolve(undefined)),
  deleteNote: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock('../../src/sync/fetchReminder', () => ({
  fetchReminder: jest.fn(() => Promise.resolve({ status: 'not_found' })),
}));

jest.mock('../../src/reminders/scheduler', () => ({
  cancelNoteWithLedger: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock('../../src/reminders/notificationLedger', () => ({
  tryRecordNotificationSent: jest.fn(() => Promise.resolve(true)),
  cleanOldRecords: jest.fn(() => Promise.resolve(0)),
}));

import { handleFcmMessage } from '../../src/sync/fcmMessageHandler';

const localAlarmFire = (reminderId: string, eventId: string): void => {
  // Simulate ReminderReceiver atomic local claim path.
  if (claimedEventIds.has(eventId)) {
    return;
  }
  claimedEventIds.add(eventId);
  visibleNotifications.push({ reminderId, eventId });
};

describe('Reminder wake reconcile', () => {
  beforeEach(() => {
    claimedEventIds.clear();
    visibleNotifications.length = 0;
    showNow.mockClear();
  });

  it('shows exactly one visible notification for the same repeat event across local alarm + FCM race', async () => {
    const reminderId = 'note-repeat-daily';
    const eventId = 'note-repeat-daily-1762333200000';

    const triggerMessage = {
      data: {
        type: 'trigger_reminder',
        reminderId,
        eventId,
        title: 'Daily reminder',
        body: 'Drink water',
      },
    };

    // Race: local alarm and FCM arrive nearly simultaneously.
    await Promise.all([
      Promise.resolve().then(() => localAlarmFire(reminderId, eventId)),
      handleFcmMessage(triggerMessage),
    ]);

    // Exactly one visible notification for the same repeat event.
    const matching = visibleNotifications.filter(
      (n) => n.reminderId === reminderId && n.eventId === eventId,
    );

    expect(matching).toHaveLength(1);
    expect(showNow).toHaveBeenCalledTimes(1);
  });
});
