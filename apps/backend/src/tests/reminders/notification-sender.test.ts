import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeviceTokensRepository } from '../../device-tokens/repositories/device-tokens-repository.js';
import type {
  PushDeliveryRequest,
  PushDeliveryResult,
  PushDeliveryService,
} from '../../jobs/push/contracts.js';
import { createReminderNotificationSender } from '../../reminders/notification-sender.js';
import type { ReminderRecord } from '../../reminders/contracts.js';

const reminder: ReminderRecord = {
  id: 'reminder-1',
  userId: 'user-1',
  title: 'Doctor',
  triggerAt: new Date('2026-06-13T10:00:00.000Z'),
  done: null,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: 'scheduled',
  timezone: 'UTC',
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: new Date('2026-06-13T10:00:00.000Z'),
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  version: 1,
  scheduleProvider: null,
  scheduleTargetId: null,
  scheduleTargetVersion: null,
  scheduleTargetFireAt: null,
  createdAt: new Date('2026-06-13T09:00:00.000Z'),
  updatedAt: new Date('2026-06-13T09:00:00.000Z'),
};

test('notification sender sends backend push to each registered token', async () => {
  const requests: PushDeliveryRequest[] = [];
  const sender = createReminderNotificationSender({
    deviceTokensRepository: {
      listByUserId: async () => [
        {
          id: 't1',
          userId: 'user-1',
          deviceId: 'device-1',
          fcmToken: 'fcm-1',
          platform: 'android',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 't2',
          userId: 'user-1',
          deviceId: 'device-2',
          fcmToken: 'fcm-2',
          platform: 'android',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    } as Pick<DeviceTokensRepository, 'listByUserId'>,
    pushDeliveryService: {
      deliverToToken: async (request) => {
        requests.push(request);
        return { classification: 'delivered' } satisfies PushDeliveryResult;
      },
    } satisfies PushDeliveryService,
  });

  const result = await sender.sendReminderNotification({
    reminder,
    deliveryKey: 'delivery-key',
    attempt: 0,
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.delivered, 2);
  assert.deepEqual(
    requests.map((request) => request.token.deviceId),
    ['device-1', 'device-2'],
  );
  assert.equal(requests[0]?.title, 'Doctor');
});

test('notification sender returns failed when there are no device tokens', async () => {
  const sender = createReminderNotificationSender({
    deviceTokensRepository: {
      listByUserId: async () => [],
    } as Pick<DeviceTokensRepository, 'listByUserId'>,
    pushDeliveryService: {
      deliverToToken: async () => ({ classification: 'delivered' } satisfies PushDeliveryResult),
    } satisfies PushDeliveryService,
  });

  const result = await sender.sendReminderNotification({
    reminder,
    deliveryKey: 'delivery-key',
    attempt: 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'no_device_tokens');
});
