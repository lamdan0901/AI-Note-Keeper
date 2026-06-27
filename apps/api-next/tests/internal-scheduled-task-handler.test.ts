import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@backend/middleware/error-middleware";
import type { QstashVerifierConfig } from "@backend/reminders/runtime";
import type { ScheduledTaskExecutor } from "@backend/reminders/scheduled-task-executor";

import { createScheduledTaskHandler } from "../src/handlers/internal/scheduled-task";
import type { QstashVerifyInput } from "../src/http/raw-body";

const verifierConfig: QstashVerifierConfig = {
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
  callbackUrl: "https://api.example.test/internal/reminders/scheduled-task",
};

const validPayload = {
  reminderId: "reminder-1",
  occurrenceAt: "2026-06-13T10:05:00.000Z",
  version: 1,
  deliveryKey: "key",
} as const;

const validRawBody = JSON.stringify(validPayload);

const createExecutorDouble = () => {
  const executed: string[] = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: "sent" };
    },
  };
  return { executor, executed };
};

test("scheduled task handler rejects missing Upstash signature", async () => {
  const { executor } = createExecutorDouble();
  const handler = createScheduledTaskHandler({ executor, verifierConfig, verify: async () => true });

  await assert.rejects(
    () =>
      handler({
        rawBody: validRawBody,
        signature: undefined,
        parsedBody: validPayload,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Invalid QStash signature");
      return true;
    },
  );
});

test("scheduled task handler rejects missing raw body", async () => {
  const { executor } = createExecutorDouble();
  const handler = createScheduledTaskHandler({ executor, verifierConfig, verify: async () => true });

  await assert.rejects(
    () =>
      handler({
        rawBody: undefined,
        signature: "signed-jwt",
        parsedBody: validPayload,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Invalid QStash signature");
      return true;
    },
  );
});

test("scheduled task handler verifies exact raw body and callback url before executing", async () => {
  const { executor, executed } = createExecutorDouble();
  const verified: QstashVerifyInput[] = [];
  const handler = createScheduledTaskHandler({
    executor,
    verifierConfig,
    verify: async (input) => {
      verified.push(input);
      return true;
    },
  });

  const result = await handler({
    rawBody: validRawBody,
    signature: "signed-jwt",
    parsedBody: validPayload,
  });

  assert.deepEqual(result, { status: "sent" });
  assert.deepEqual(executed, ["reminder-1"]);
  assert.deepEqual(verified, [
    {
      signature: "signed-jwt",
      body: validRawBody,
      url: "https://api.example.test/internal/reminders/scheduled-task",
    },
  ]);
});

test("scheduled task handler rejects failed QStash verification without executing", async () => {
  const { executor, executed } = createExecutorDouble();
  const handler = createScheduledTaskHandler({
    executor,
    verifierConfig,
    verify: async () => false,
  });

  await assert.rejects(
    () =>
      handler({
        rawBody: validRawBody,
        signature: "bad-signature",
        parsedBody: validPayload,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Invalid QStash signature");
      return true;
    },
  );

  assert.deepEqual(executed, []);
});

test("scheduled task handler throws validation AppError for invalid body", async () => {
  const { executor, executed } = createExecutorDouble();
  const handler = createScheduledTaskHandler({
    executor,
    verifierConfig,
    verify: async () => true,
  });

  await assert.rejects(
    () =>
      handler({
        rawBody: validRawBody,
        signature: "signed-jwt",
        parsedBody: { reminderId: "" },
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

  assert.deepEqual(executed, []);
});