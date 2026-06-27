import assert from "node:assert/strict";
import { test } from "node:test";

import type { QstashVerifierConfig } from "@backend/reminders/runtime";
import type { ScheduledTaskExecutor } from "@backend/reminders/scheduled-task-executor";

import type { QstashVerifyInput } from "../src/http/raw-body";
import { startInternalTestServer } from "./support/internal-test-server";

const verifierConfig: QstashVerifierConfig = {
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
  callbackUrl: "https://api.example.test/internal/reminders/scheduled-task",
};

test("internal scheduled task route requires Upstash signature", async () => {
  const executor: ScheduledTaskExecutor = {
    execute: async () => ({ status: "sent" }),
  };
  const server = await startInternalTestServer({
    executor,
    verifierConfig,
    verify: async () => true,
  });

  try {
    const response = await server.fetch("/internal/reminders/scheduled-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reminderId: "reminder-1",
        occurrenceAt: "2026-06-13T10:05:00.000Z",
        version: 1,
        deliveryKey: "key",
      }),
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

test("internal scheduled task route verifies exact raw body and callback url before executing", async () => {
  const executed: string[] = [];
  const verified: QstashVerifyInput[] = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: "sent" };
    },
  };
  const server = await startInternalTestServer({
    executor,
    verifierConfig,
    verify: async (input) => {
      verified.push(input);
      return true;
    },
  });
  const body = JSON.stringify({
    reminderId: "reminder-1",
    occurrenceAt: "2026-06-13T10:05:00.000Z",
    version: 1,
    deliveryKey: "key",
  });

  try {
    const response = await server.fetch("/internal/reminders/scheduled-task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Upstash-Signature": "signed-jwt",
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "sent" });
    assert.deepEqual(executed, ["reminder-1"]);
    assert.deepEqual(verified, [
      {
        signature: "signed-jwt",
        body,
        url: "https://api.example.test/internal/reminders/scheduled-task",
      },
    ]);
  } finally {
    await server.close();
  }
});

test("internal scheduled task route rejects failed QStash verification", async () => {
  const executed: string[] = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: "sent" };
    },
  };
  const server = await startInternalTestServer({
    executor,
    verifierConfig,
    verify: async () => false,
  });

  try {
    const response = await server.fetch("/internal/reminders/scheduled-task", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Upstash-Signature": "bad-signature",
      },
      body: JSON.stringify({
        reminderId: "reminder-1",
        occurrenceAt: "2026-06-13T10:05:00.000Z",
        version: 1,
        deliveryKey: "key",
      }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(executed, []);
  } finally {
    await server.close();
  }
});