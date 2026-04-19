import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushJobHandler } from '../../jobs/push/push-job-handler.js';
import type {
  PushDeliveryRequest,
  PushDeliveryResult,
  PushDeliveryService,
  PushJobPayload,
  PushRetryJobPayload,
  PushRetryScheduler,
  PushTerminalFailureRecord,
  PushTerminalFailureRecorder,
} from '../../jobs/push/contracts.js';

type ScheduledRetry = Readonly<{
  delayMs: number;
  jobKey: string;
  job: PushRetryJobPayload;
}>;

type Harness = Readonly<{
  handler: ReturnType<typeof createPushJobHandler>;
  scheduledRetries: ScheduledRetry[];
  deletedTokens: ReadonlyArray<Readonly<{ userId: string; deviceId: string }>>;
  terminalFailures: ReadonlyArray<PushTerminalFailureRecord>;
}>;

const createHarness = (
  deliverToToken: (request: PushDeliveryRequest) => Promise<PushDeliveryResult>,
): Harness => {
  const scheduledRetries: ScheduledRetry[] = [];
  const deletedTokens: Array<Readonly<{ userId: string; deviceId: string }>> = [];
  const terminalFailures: PushTerminalFailureRecord[] = [];

  const deliveryService: PushDeliveryService = {
    deliverToToken,
  };

  const retryScheduler: PushRetryScheduler = {
    scheduleRetry: async (input) => {
      scheduledRetries.push(input);
    },
  };

  const terminalFailureRecorder: PushTerminalFailureRecorder = {
    record: async (failure) => {
      terminalFailures.push(failure);
    },
  };

  const handler = createPushJobHandler({
    deliveryService,
    deviceTokensRepository: {
      deleteByDeviceIdForUser: async (input) => {
        deletedTokens.push(input);
        return true;
      },
    },
    retryScheduler,
    terminalFailureRecorder,
  });

  return {
    handler,
    scheduledRetries,
    deletedTokens,
    terminalFailures,
  };
};

const createBaseJob = (input: Readonly<{ attempt: number; deviceIds: ReadonlyArray<string> }>): PushJobPayload => {
  return {
    userId: 'user-1',
    reminderId: 'reminder-1',
    changeEventId: 'event-1',
    attempt: input.attempt,
    tokens: input.deviceIds.map((deviceId) => ({
      deviceId,
      fcmToken: `${deviceId}-token`,
    })),
  };
};

test('429 and 5xx transient push failures schedule per-token retries at 30s then 60s', async () => {
  const harness = createHarness(async (request) => {
    if (request.token.deviceId === 'device-429' && request.attempt === 0) {
      return {
        classification: 'transient_failure',
        statusCode: 429,
      };
    }

    if (request.token.deviceId === 'device-500' && request.attempt === 0) {
      return {
        classification: 'transient_failure',
        statusCode: 503,
      };
    }

    if (request.token.deviceId === 'device-429' && request.attempt === 1) {
      return {
        classification: 'transient_failure',
        statusCode: 500,
      };
    }

    return {
      classification: 'delivered',
    };
  });

  const firstResult = await harness.handler.handle(
    createBaseJob({
      attempt: 0,
      deviceIds: ['device-429', 'device-500'],
    }),
  );

  assert.equal(firstResult.retriesScheduled, 2);
  assert.equal(harness.scheduledRetries.length, 2);
  assert.deepEqual(
    harness.scheduledRetries.map((call) => call.delayMs),
    [30_000, 30_000],
  );
  assert.equal(harness.scheduledRetries[0].job.attempt, 1);
  assert.equal(harness.scheduledRetries[1].job.attempt, 1);

  const secondResult = await harness.handler.handle({
    userId: harness.scheduledRetries[0].job.userId,
    reminderId: harness.scheduledRetries[0].job.reminderId,
    changeEventId: harness.scheduledRetries[0].job.changeEventId,
    isTrigger: harness.scheduledRetries[0].job.isTrigger,
    attempt: harness.scheduledRetries[0].job.attempt,
    tokens: [harness.scheduledRetries[0].job.token],
  });

  assert.equal(secondResult.retriesScheduled, 1);
  assert.equal(harness.scheduledRetries.length, 3);
  assert.equal(harness.scheduledRetries[2].delayMs, 60_000);
  assert.equal(harness.scheduledRetries[2].job.attempt, 2);
});

test('UNREGISTERED responses delete token immediately and do not schedule retries', async () => {
  const harness = createHarness(async () => {
    return {
      classification: 'unregistered',
      statusCode: 404,
      errorCode: 'UNREGISTERED',
    };
  });

  const result = await harness.handler.handle(
    createBaseJob({
      attempt: 0,
      deviceIds: ['stale-device'],
    }),
  );

  assert.equal(result.unregisteredRemoved, 1);
  assert.equal(result.retriesScheduled, 0);
  assert.equal(harness.scheduledRetries.length, 0);
  assert.deepEqual(harness.deletedTokens, [
    {
      userId: 'user-1',
      deviceId: 'stale-device',
    },
  ]);
});

test('retry exhaustion records terminal failure and continues processing sibling token deliveries', async () => {
  const harness = createHarness(async (request) => {
    if (request.token.deviceId === 'device-fails') {
      return {
        classification: 'transient_failure',
        statusCode: 503,
      };
    }

    return {
      classification: 'delivered',
    };
  });

  const result = await harness.handler.handle(
    createBaseJob({
      attempt: 2,
      deviceIds: ['device-fails', 'device-ok'],
    }),
  );

  assert.equal(result.processed, 2);
  assert.equal(result.delivered, 1);
  assert.equal(result.retriesScheduled, 0);
  assert.equal(result.terminalFailures, 1);
  assert.equal(harness.terminalFailures.length, 1);
  assert.equal(harness.terminalFailures[0].tokenIdentity, 'reminder-1-event-1-device-fails');
});

test('successful token deliveries are not retried when a sibling token fails transiently', async () => {
  const harness = createHarness(async (request) => {
    if (request.token.deviceId === 'device-fails') {
      return {
        classification: 'transient_failure',
        statusCode: 429,
      };
    }

    return {
      classification: 'delivered',
    };
  });

  const result = await harness.handler.handle(
    createBaseJob({
      attempt: 0,
      deviceIds: ['device-ok', 'device-fails'],
    }),
  );

  assert.equal(result.delivered, 1);
  assert.equal(result.retriesScheduled, 1);
  assert.equal(harness.scheduledRetries.length, 1);
  assert.equal(harness.scheduledRetries[0].job.token.deviceId, 'device-fails');
});
