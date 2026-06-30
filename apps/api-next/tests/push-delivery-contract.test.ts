import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_PUSH_RETRY_POLICY,
  createPushRetryRunAt,
  createPushTokenIdentity,
  resolvePushRetryDelayMs,
  toPushRetryJobPayload,
  type PushDeliveryRequest,
  type PushRetryJobPayload,
} from "@backend/jobs/push/contracts";
import { createPushDeliveryService } from "@backend/jobs/push/push-delivery-service";
import { createPushJobHandler } from "@backend/jobs/push/push-job-handler";

import {
  createQstashPushRetryScheduler,
  type QstashPushPublishClient,
} from "../src/server/qstash-push-retry-scheduler";

const createRequest = (): PushDeliveryRequest => ({
  userId: "user-1",
  reminderId: "reminder-1",
  changeEventId: "event-1",
  attempt: 0,
  token: {
    deviceId: "device-1",
    fcmToken: "fcm-token-1",
  },
});

test("delivery classification distinguishes transient failures from UNREGISTERED terminal cleanup responses", async () => {
  const transientService = createPushDeliveryService({
    provider: {
      sendToToken: async () => ({
        ok: false,
        statusCode: 503,
        errorCode: "UNAVAILABLE",
      }),
    },
  });

  const unregisteredService = createPushDeliveryService({
    provider: {
      sendToToken: async () => ({
        ok: false,
        statusCode: 404,
        errorCode: "UNREGISTERED",
      }),
    },
  });

  const transient = await transientService.deliverToToken(createRequest());
  const unregistered = await unregisteredService.deliverToToken(createRequest());

  assert.equal(transient.classification, "transient_failure");
  assert.equal(unregistered.classification, "unregistered");
});

test("contracts model retry attempt and per-token payload identity deterministically", () => {
  const request = createRequest();
  const retryPayload = toPushRetryJobPayload(request);
  const tokenIdentity = createPushTokenIdentity({
    reminderId: request.reminderId,
    changeEventId: request.changeEventId,
    deviceId: request.token.deviceId,
  });

  assert.equal(retryPayload.attempt, 0);
  assert.equal(retryPayload.token.deviceId, "device-1");
  assert.equal(tokenIdentity, "reminder-1-event-1-device-1");
});

test("retry policy exposes exactly two retries with parity delays at 30s then 60s", () => {
  assert.equal(DEFAULT_PUSH_RETRY_POLICY.maxRetries, 2);
  assert.deepEqual(DEFAULT_PUSH_RETRY_POLICY.retryDelaysMs, [30_000, 60_000]);

  assert.equal(resolvePushRetryDelayMs(0), 30_000);
  assert.equal(resolvePushRetryDelayMs(1), 60_000);
  assert.equal(resolvePushRetryDelayMs(2), null);

  const now = new Date("2026-04-19T10:00:00.000Z");
  assert.equal(createPushRetryRunAt(now, 0)?.toISOString(), "2026-04-19T10:00:30.000Z");
  assert.equal(createPushRetryRunAt(now, 1)?.toISOString(), "2026-04-19T10:01:00.000Z");
  assert.equal(createPushRetryRunAt(now, 2), null);
});

test("createQstashPushRetryScheduler with createPushJobHandler publishes 30s delayed retry and removes stale tokens", async () => {
  const published: Array<Readonly<{ delay: number; body: PushRetryJobPayload }>> = [];
  const deletedTokens: Array<Readonly<{ userId: string; deviceId: string }>> = [];

  const client: QstashPushPublishClient = {
    publishJSON: async (input) => {
      published.push({ delay: input.delay, body: input.body });
      return { messageId: "msg_retry_1" };
    },
  };

  const retryScheduler = createQstashPushRetryScheduler({
    schedulerProvider: "qstash",
    qstashToken: "test-token",
    client,
    callbackBaseUrl: "https://api.example.test",
  });

  const handler = createPushJobHandler({
    deliveryService: {
      deliverToToken: async (request) => {
        if (request.token.deviceId === "retry-device") {
          return {
            classification: "transient_failure",
            statusCode: 429,
          };
        }

        if (request.token.deviceId === "stale-device") {
          return {
            classification: "unregistered",
            statusCode: 404,
            errorCode: "UNREGISTERED",
          };
        }

        return { classification: "delivered" };
      },
    },
    deviceTokensRepository: {
      deleteByDeviceIdForUser: async (input) => {
        deletedTokens.push(input);
        return true;
      },
    },
    retryScheduler,
    terminalFailureRecorder: {
      record: async () => undefined,
    },
  });

  const result = await handler.handle({
    userId: "user-1",
    reminderId: "reminder-1",
    changeEventId: "event-1",
    attempt: 0,
    tokens: [
      { deviceId: "retry-device", fcmToken: "retry-token" },
      { deviceId: "stale-device", fcmToken: "stale-token" },
      { deviceId: "ok-device", fcmToken: "ok-token" },
    ],
  });

  assert.equal(result.processed, 3);
  assert.equal(result.delivered, 1);
  assert.equal(result.retriesScheduled, 1);
  assert.equal(result.unregisteredRemoved, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.delay, 30);
  assert.equal(published[0]?.body.token.deviceId, "retry-device");
  assert.equal(published[0]?.body.attempt, 1);
  assert.deepEqual(deletedTokens, [{ userId: "user-1", deviceId: "stale-device" }]);
});