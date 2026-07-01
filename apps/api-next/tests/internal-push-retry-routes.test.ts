import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import type {
  PushJobHandler,
  PushJobPayload,
  PushJobRunResult,
} from "@backend/jobs/push/push-job-handler";
import type { QstashVerifierConfig } from "@backend/reminders/runtime";

import { POST as pushRetryRoutePost } from "../app/internal/push/retry/route";
import type { QstashVerifyInput } from "../src/http/raw-body";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../src/server/compose-services-impl";
import { startInternalPushRetryTestServer } from "./support/internal-push-retry-test-server";

const verifierConfig: QstashVerifierConfig = {
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
  callbackUrl: "https://api.example.test/internal/push/retry",
};

const validBody = {
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

test("internal push retry route requires Upstash signature", async () => {
  const server = await startInternalPushRetryTestServer({
    pushJobHandler: createPushJobHandlerDouble(async () => {
      throw new Error("should not be called");
    }),
    verifierConfig,
    verify: async () => true,
  });

  try {
    const response = await server.fetch("/internal/push/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid QStash signature");
    assert.equal(payload.status, 401);
  } finally {
    await server.close();
  }
});

test("internal push retry route verifies exact raw body and callback url before executing", async () => {
  const handled: PushJobPayload[] = [];
  const verified: QstashVerifyInput[] = [];
  const server = await startInternalPushRetryTestServer({
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
    verifierConfig,
    verify: async (input) => {
      verified.push(input);
      return true;
    },
  });
  const body = JSON.stringify(validBody);

  try {
    const response = await server.fetch("/internal/push/retry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Upstash-Signature": "signed-jwt",
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
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
    assert.deepEqual(verified, [
      {
        signature: "signed-jwt",
        body,
        url: "https://api.example.test/internal/push/retry",
      },
    ]);
  } finally {
    await server.close();
  }
});

test("push retry route returns 404 when push retry deps are not configured", async () => {
  resetComposedServicesForTests();
  const previousProvider = process.env.REMINDER_SCHEDULER_PROVIDER;
  process.env.REMINDER_SCHEDULER_PROVIDER = "disabled";

  try {
    setComposedServicesForTests(composeServices());

    const response = await pushRetryRoutePost(
      new NextRequest("http://localhost/internal/push/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody),
      }),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      code: "not_found",
      message: "Not found",
      status: 404,
    });
  } finally {
    resetComposedServicesForTests();
    if (previousProvider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = previousProvider;
    }
  }
});

test("internal push retry route rejects failed QStash verification", async () => {
  const handled: PushJobPayload[] = [];
  const server = await startInternalPushRetryTestServer({
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
    verifierConfig,
    verify: async () => false,
  });

  try {
    const response = await server.fetch("/internal/push/retry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Upstash-Signature": "bad-signature",
      },
      body: JSON.stringify(validBody),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(handled, []);
  } finally {
    await server.close();
  }
});