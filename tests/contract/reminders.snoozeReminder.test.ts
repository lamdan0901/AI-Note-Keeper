import { describe, test, expect } from '@jest/globals';

import {
  assertReminderContract,
  createReminder,
  createServiceDouble,
  normalizeReminderPayload,
  toPublicReminderPayload,
} from './reminder-api-harness';

describe('reminders snooze contract', () => {
  test('snooze reminder returns the public reminder contract', async () => {
    const service = createServiceDouble();
    service.byKey.set(
      'user-1:reminder-123',
      createReminder({
        id: 'reminder-123',
        userId: 'user-1',
        updatedAt: 1_700_000_000_000,
        title: 'Reminder to snooze',
        nextTriggerAt: 1_700_000_000_000,
        version: 4,
        scheduleProvider: 'fake',
        scheduleTargetId: 'target-1',
        scheduleTargetVersion: 4,
        scheduleTargetFireAt: new Date('2026-06-13T10:05:00.000Z'),
      }),
    );
    const snoozedUntil = 1_700_010_000_000;

    const reminder = await service.snoozeReminder({
      userId: 'user-1',
      reminderId: 'reminder-123',
      snoozedUntil,
    });

    expect(reminder).not.toBeNull();
    if (reminder === null) {
      throw new Error('Expected reminder payload');
    }

    const publicReminder = toPublicReminderPayload(reminder);
    assertReminderContract(publicReminder);
    const normalized = normalizeReminderPayload(publicReminder);
    expect(normalized?.snoozedUntil).toBe(snoozedUntil);
    expect(normalized?.nextTriggerAt).toBe(snoozedUntil);
  });
});
