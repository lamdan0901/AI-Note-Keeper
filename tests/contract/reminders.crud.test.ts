import { describe, test, expect } from '@jest/globals';

import {
  assertReminderContract,
  createReminder,
  createServiceDouble,
  toPublicReminderPayload,
} from './reminder-api-harness';

describe('reminders CRUD contract', () => {
  test('create reminder returns the public reminder contract', async () => {
    const service = createServiceDouble();
    const reminder = await service.createReminder({
      id: 'reminder-new',
      userId: 'user-1',
      title: 'Reminder',
      triggerAt: 1_700_000_000_000,
      active: true,
      timezone: 'UTC',
      scheduleStatus: 'scheduled',
      updatedAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    });

    assertReminderContract(toPublicReminderPayload(reminder));
  });

  test('delete reminder keeps the existing boolean contract', async () => {
    const service = createServiceDouble();
    service.byKey.set(
      'user-1:reminder-delete',
      createReminder({
        id: 'reminder-delete',
        userId: 'user-1',
        updatedAt: 1_700_000_000_000,
        title: 'Delete me',
        scheduleProvider: 'fake',
        scheduleTargetId: 'target-1',
        scheduleTargetVersion: 2,
        scheduleTargetFireAt: new Date('2026-06-13T10:05:00.000Z'),
      }),
    );

    await expect(
      service.deleteReminder({ userId: 'user-1', reminderId: 'reminder-delete' }),
    ).resolves.toBe(true);
  });
});
