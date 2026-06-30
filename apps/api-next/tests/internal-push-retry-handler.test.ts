import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@backend/middleware/error-middleware";
import type {
  PushJobHandler,
  PushJobPayload,
  PushJobRunResult,
} from "@backend/jobs/push/push-job-handler";

import { createPushRetryHandler } from "../src/handlers/internal/push-retry";

const validPayload = {
  userId: "user-1",
  reminderId: "reminder-1",
  changeEventId: "event-1",
  isTrigger: true,
  attempt: 1,
  token: {
    deviceId: "device-1",
    fcmToken: "fcm-token-1",
  },
  title: "Reminder title",
  body: "Reminder body",
} as const;

const createPushJobHandlerDouble = (
  handle: (job: PushJobPayload) => Promise<PushJobRunResult>,
): PushJobHandler => ({
  handle,
});

test("push retry handler throws validation AppError for invalid body", async () => {
  const handler = createPushRetryHandler({
    pushJobHandler: createPushJobHandlerDouble(async () => {
      throw new Error("should not be called");
    }),
  });

  await assert.rejects(
    () =>
      handler({
        parsedBody: { userId: "", attempt: 0 },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "validation");
      const issues = error.details?.issues as ReadonlyArray<{ path: string }>;
      assert.ok(Array.isArray(issues));
      assert.equal(issues.length > 0, true);
      return true;
    },
  );
});

test("push retry handler rejects attempt below 1", async () => {
  const handler = createPushRetryHandler({
    pushJobHandler: createPushJobHandlerDouble(async () => {
      throw new Error("should not be called");
    }),
  });

  await assert.rejects(
    () =>
      handler({
        parsedBody: {
          ...validPayload,
          attempt: 0,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "validation");
      return true;
    },
  );
});

test("push retry handler invokes pushJobHandler with single-token payload", async () => {
  const handled: PushJobPayload[] = [];
  const handler = createPushRetryHandler({
    pushJobHandler: createPushJobHandlerDouble(async (job) => {
      handled.push(job);
      return {
        processed: 1,
        delivered: 1,
        retriesScheduled: 0,
        unregisteredRemoved: 0,
        terminalFailures: 0,
      };
    }),
  });

  const result = await handler({
    parsedBody: validPayload,
  });

  assert.deepEqual(result, {
    processed: 1,
    delivered: 1,
    retriesScheduled: 0,
    unregisteredRemoved: 0,
    terminalFailures: 0,
  });
  assert.deepEqual(handled, [
    {
      userId: "user-1",
      reminderId: "reminder-1",
      changeEventId: "event-1",
      isTrigger: true,
      attempt: 1,
      tokens: [
        {
          deviceId: "device-1",
          fcmToken: "fcm-token-1",
        },
      ],
      title: "Reminder title",
      body: "Reminder body",
    },
  ]);
});

test("push retry handler returns push job handler run summary", async () => {
  const handler = createPushRetryHandler({
    pushJobHandler: createPushJobHandlerDouble(async () => ({
      processed: 1,
      delivered: 0,
      retriesScheduled: 1,
      unregisteredRemoved: 0,
      terminalFailures: 0,
    })),
  });

  const result = await handler({
    parsedBody: validPayload,
  });

  assert.deepEqual(result, {
    processed: 1,
    delivered: 0,
    retriesScheduled: 1,
    unregisteredRemoved: 0,
    terminalFailures: 0,
  });
});