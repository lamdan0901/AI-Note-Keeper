import assert from "node:assert/strict";
import { test } from "node:test";

import type { PushRetryJobPayload } from "@backend/jobs/push/contracts";

import {
  createPushRetryCallbackUrl,
  createQstashPushRetryScheduler,
  type QstashPushPublishClient,
} from "../src/server/qstash-push-retry-scheduler";

test("createPushRetryCallbackUrl appends internal push retry path", () => {
  assert.equal(
    createPushRetryCallbackUrl("https://api.example.test"),
    "https://api.example.test/internal/push/retry",
  );
});

test("createQstashPushRetryScheduler publishes delayed retry payload", async () => {
  const published: Array<{
    url: string;
    body: PushRetryJobPayload;
    delay: number;
    deduplicationId?: string;
  }> = [];
  const client: QstashPushPublishClient = {
    publishJSON: async (input) => {
      published.push(input);
      return { messageId: "msg_retry_1" };
    },
  };
  const scheduler = createQstashPushRetryScheduler({
    schedulerProvider: "qstash",
    qstashToken: "test-token",
    client,
    callbackBaseUrl: "https://api.example.test",
  });

  const job: PushRetryJobPayload = {
    userId: "user-1",
    reminderId: "reminder-1",
    changeEventId: "event-1",
    isTrigger: true,
    attempt: 1,
    token: { deviceId: "device-1", fcmToken: "token-1" },
    title: "Title",
    body: "Body",
  };

  await scheduler.scheduleRetry({ delayMs: 30_000, job, jobKey: "retry-key-1" });

  assert.equal(published.length, 1);
  assert.equal(published[0]?.url, "https://api.example.test/internal/push/retry");
  assert.deepEqual(published[0]?.body, job);
  assert.equal(published[0]?.delay, 30);
  assert.equal(published[0]?.deduplicationId, "retry-key-1");
});

test("createQstashPushRetryScheduler throws when scheduler provider is disabled", () => {
  assert.throws(
    () =>
      createQstashPushRetryScheduler({
        schedulerProvider: "disabled",
        callbackBaseUrl: "https://api.example.test",
        client: {
          publishJSON: async () => ({ messageId: "msg" }),
        },
      }),
    /disabled/i,
  );
});