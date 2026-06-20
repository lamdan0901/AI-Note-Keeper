import { describe, test, expect } from '@jest/globals';

import {
  assertReminderContract,
  createReminder,
  createServiceDouble,
  toPublicReminderPayload,
} from './reminder-api-harness';

describe('reminders update contract', () => {
  test('update reminder returns the public reminder contract', async () => {
    const service = createServiceDouble();
    service.byKey.set(
      'user-1:reminder-123',
      createReminder({
        id: 'reminder-123',
        userId: 'user-1',
        updatedAt: 1_700_000_000_000,
        title: 'Original title',
        nextTriggerAt: 1_700_000_000_000,
        version: 2,
        scheduleProvider: 'fake',
        scheduleTargetId: 'target-1',
        scheduleTargetVersion: 2,
        scheduleTargetFireAt: new Date('2026-06-13T10:05:00.000Z'),
      }),
    );
    const reminder = await service.updateReminder({
      userId: 'user-1',
      reminderId: 'reminder-123',
      patch: {
        title: 'Updated title',
        updatedAt: 1_700_000_001_000,
      },
    });

    expect(reminder).not.toBeNull();
    if (reminder === null) {
      throw new Error('Expected reminder payload');
    }

    assertReminderContract(toPublicReminderPayload(reminder));
    expect(reminder.title).toBe('Updated title');
  });
});
