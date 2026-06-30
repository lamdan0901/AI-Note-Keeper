import assert from "node:assert/strict";
import { test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import type {
  PushDeliveryRequest,
  PushDeliveryResult,
  PushDeliveryService,
  PushRetryJobPayload,
  PushRetryScheduler,
} from "@backend/jobs/push/contracts";
import { createPushJobHandler } from "@backend/jobs/push/push-job-handler";

import {
  createEmptyMergeTransactionStats,
  createPhase5MergeParityService,
} from "../support/phase5-merge-parity-harness";
import { jsonAuthHeaders, startMergeTestServer } from "../support/merge-test-server";

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({ userId, username: userId });
  return pair.accessToken;
};

const mergeBody = () => ({
  toUserId: "target-user",
  username: "target-username",
  password: "secret",
});

test("phase-5 parity HTTP: merge preflight returns parity summary and apply enforces strategy enum", async () => {
  const transactionStats = createEmptyMergeTransactionStats();
  const server = await startMergeTestServer({
    mergeService: createPhase5MergeParityService(transactionStats),
  });
  const token = await createAccessToken("source-user");

  try {
    const preflight = await server.fetch("/api/merge/preflight", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify(mergeBody()),
    });

    assert.equal(preflight.status, 200);
    const preflightPayload = (await preflight.json()) as {
      summary: {
        sourceCounts: Record<string, number>;
        targetCounts: Record<string, number>;
      };
    };

    assert.deepEqual(Object.keys(preflightPayload.summary.sourceCounts).sort(), [
      "events",
      "expensePeriods",
      "expenseRows",
      "notes",
      "subscriptions",
      "tokens",
    ]);
    assert.deepEqual(Object.keys(preflightPayload.summary.targetCounts).sort(), [
      "events",
      "expensePeriods",
      "expenseRows",
      "notes",
      "subscriptions",
      "tokens",
    ]);

    const invalidApply = await server.fetch("/api/merge/apply", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        ...mergeBody(),
        strategy: "hybrid",
      }),
    });

    assert.equal(invalidApply.status, 400);
    const invalidPayload = (await invalidApply.json()) as { code: string; status: number };
    assert.equal(invalidPayload.code, "validation");
    assert.equal(invalidPayload.status, 400);
  } finally {
    await server.close();
  }
});

test("phase-5 parity HTTP: merge apply supports cloud/local/both and preserves transaction accounting", async () => {
  const transactionStats = createEmptyMergeTransactionStats();
  const server = await startMergeTestServer({
    mergeService: createPhase5MergeParityService(transactionStats),
  });
  const token = await createAccessToken("source-user");

  try {
    const strategies = ["cloud", "local", "both"] as const;
    const expectedNotes = {
      cloud: 2,
      local: 4,
      both: 5,
    } as const;

    for (const strategy of strategies) {
      const response = await server.fetch("/api/merge/apply", {
        method: "POST",
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({
          ...mergeBody(),
          strategy,
        }),
      });

      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        strategy: string;
        resolution: string;
        summary: { targetCounts: { notes: number } };
      };

      assert.equal(payload.strategy, strategy);
      assert.equal(payload.summary.targetCounts.notes, expectedNotes[strategy]);

      if (strategy === "both") {
        assert.equal(payload.resolution, "prompt");
      }
    }

    assert.equal(transactionStats.started, 3);
    assert.equal(transactionStats.committed, 3);
    assert.equal(transactionStats.rolledBack, 0);

    const blocked = await server.fetch("/api/merge/apply", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        ...mergeBody(),
        password: "blocked",
        strategy: "local",
      }),
    });

    assert.equal(blocked.status, 429);
    const blockedPayload = (await blocked.json()) as {
      code: string;
      details?: Record<string, unknown>;
    };
    assert.equal(blockedPayload.code, "rate_limit");
    assert.equal(blockedPayload.details?.retryAfterSeconds, 12);
    assert.equal(blockedPayload.details?.resetAt, 1_700_000_012_000);
    assert.equal(
      Object.prototype.hasOwnProperty.call(blockedPayload.details ?? {}, "internalStack"),
      false,
    );
  } finally {
    await server.close();
  }
});

test("phase-5 parity HTTP: push failure path keeps retry and stale-token cleanup semantics with worker doubles", async () => {
  const scheduledRetries: Array<Readonly<{ delayMs: number; job: PushRetryJobPayload }>> = [];
  const deletedTokens: Array<Readonly<{ userId: string; deviceId: string }>> = [];

  const deliveryService: PushDeliveryService = {
    deliverToToken: async (request: PushDeliveryRequest): Promise<PushDeliveryResult> => {
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

      return {
        classification: "delivered",
      };
    },
  };

  const retryScheduler: PushRetryScheduler = {
    scheduleRetry: async ({ delayMs, job }) => {
      scheduledRetries.push({ delayMs, job });
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
  assert.equal(scheduledRetries.length, 1);
  assert.equal(scheduledRetries[0]?.delayMs, 30_000);
  assert.equal(scheduledRetries[0]?.job.token.deviceId, "retry-device");
  assert.deepEqual(deletedTokens, [{ userId: "user-1", deviceId: "stale-device" }]);
});