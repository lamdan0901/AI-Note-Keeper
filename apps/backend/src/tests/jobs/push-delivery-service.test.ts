import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PUSH_RETRY_POLICY,
  createPushRetryRunAt,
  createPushTokenIdentity,
  resolvePushRetryDelayMs,
  toPushRetryJobPayload,
  type PushDeliveryRequest,
} from '../../jobs/push/contracts.js';
import { createPushDeliveryService } from '../../jobs/push/push-delivery-service.js';

const createRequest = (): PushDeliveryRequest => {
  return {
    userId: 'user-1',
    reminderId: 'reminder-1',
    changeEventId: 'event-1',
    attempt: 0,
    token: {
      deviceId: 'device-1',
      fcmToken: 'fcm-token-1',
    },
  };
};

test('delivery classification distinguishes transient failures from UNREGISTERED terminal cleanup responses', async () => {
  const transientService = createPushDeliveryService({
    provider: {
      sendToToken: async () => ({
        ok: false,
        statusCode: 503,
        errorCode: 'UNAVAILABLE',
      }),
    },
  });

  const unregisteredService = createPushDeliveryService({
    provider: {
      sendToToken: async () => ({
        ok: false,
        statusCode: 404,
        errorCode: 'UNREGISTERED',
      }),
    },
  });

  const transient = await transientService.deliverToToken(createRequest());
  const unregistered = await unregisteredService.deliverToToken(createRequest());

  assert.equal(transient.classification, 'transient_failure');
  assert.equal(unregistered.classification, 'unregistered');
});

test('contracts model retry attempt and per-token payload identity deterministically', () => {
  const request = createRequest();
  const retryPayload = toPushRetryJobPayload(request);
  const tokenIdentity = createPushTokenIdentity({
    reminderId: request.reminderId,
    changeEventId: request.changeEventId,
    deviceId: request.token.deviceId,
  });

  assert.equal(retryPayload.attempt, 0);
  assert.equal(retryPayload.token.deviceId, 'device-1');
  assert.equal(tokenIdentity, 'reminder-1-event-1-device-1');
});

test('retry policy exposes exactly two retries with parity delays at 30s then 60s', () => {
  assert.equal(DEFAULT_PUSH_RETRY_POLICY.maxRetries, 2);
  assert.deepEqual(DEFAULT_PUSH_RETRY_POLICY.retryDelaysMs, [30_000, 60_000]);

  assert.equal(resolvePushRetryDelayMs(0), 30_000);
  assert.equal(resolvePushRetryDelayMs(1), 60_000);
  assert.equal(resolvePushRetryDelayMs(2), null);

  const now = new Date('2026-04-19T10:00:00.000Z');
  assert.equal(createPushRetryRunAt(now, 0)?.toISOString(), '2026-04-19T10:00:30.000Z');
  assert.equal(createPushRetryRunAt(now, 1)?.toISOString(), '2026-04-19T10:01:00.000Z');
  assert.equal(createPushRetryRunAt(now, 2), null);
});
