import assert from "node:assert/strict";
import { test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import {
  jsonAuthHeaders,
  startMergeTestServer,
} from "./support/merge-test-server";
import { createMergeServiceDouble } from "./support/merge-service-double";

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

const preflightBody = () => ({
  toUserId: "target-user",
  username: "alice",
  password: "correct-password",
});

test("merge preflight returns parity summary fields and count objects", async () => {
  const server = await startMergeTestServer({
    mergeService: createMergeServiceDouble(),
  });
  const token = await createAccessToken("source-user");

  try {
    const response = await server.fetch("/api/merge/preflight", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify(preflightBody()),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      summary: {
        sourceEmpty: boolean;
        sourceSampleOnly: boolean;
        targetEmpty: boolean;
        hasConflicts: boolean;
        sourceCounts: Record<string, number>;
        targetCounts: Record<string, number>;
      };
    };

    assert.equal(typeof payload.summary.sourceEmpty, "boolean");
    assert.equal(typeof payload.summary.sourceSampleOnly, "boolean");
    assert.equal(typeof payload.summary.targetEmpty, "boolean");
    assert.equal(typeof payload.summary.hasConflicts, "boolean");
    assert.deepEqual(Object.keys(payload.summary.sourceCounts).sort(), [
      "events",
      "expensePeriods",
      "expenseRows",
      "notes",
      "subscriptions",
      "tokens",
    ]);
    assert.deepEqual(Object.keys(payload.summary.targetCounts).sort(), [
      "events",
      "expensePeriods",
      "expenseRows",
      "notes",
      "subscriptions",
      "tokens",
    ]);
  } finally {
    await server.close();
  }
});

test("merge apply accepts only cloud|local|both and returns deterministic summary", async () => {
  const server = await startMergeTestServer({
    mergeService: createMergeServiceDouble(),
  });
  const token = await createAccessToken("source-user");

  try {
    const invalid = await server.fetch("/api/merge/apply", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        ...preflightBody(),
        strategy: "hybrid",
      }),
    });

    assert.equal(invalid.status, 400);
    const invalidPayload = (await invalid.json()) as { code: string; status: number };
    assert.equal(invalidPayload.code, "validation");

    const valid = await server.fetch("/api/merge/apply", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        ...preflightBody(),
        strategy: "both",
      }),
    });

    assert.equal(valid.status, 200);
    const payload = (await valid.json()) as {
      strategy: string;
      resolution: string;
      summary: {
        sourceCounts: { notes: number };
        targetCounts: { notes: number };
      };
    };

    assert.equal(payload.strategy, "both");
    assert.equal(payload.resolution, "prompt");
    assert.equal(payload.summary.sourceCounts.notes, 2);
    assert.equal(payload.summary.targetCounts.notes, 2);
  } finally {
    await server.close();
  }
});

test("merge throttle rejection returns rate_limit with retryAfterSeconds and resetAt only", async () => {
  const server = await startMergeTestServer({
    mergeService: createMergeServiceDouble(),
  });
  const token = await createAccessToken("source-user");

  try {
    const response = await server.fetch("/api/merge/apply", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        ...preflightBody(),
        password: "blocked",
        strategy: "local",
      }),
    });

    assert.equal(response.status, 429);
    const payload = (await response.json()) as {
      code: string;
      status: number;
      details?: Record<string, unknown>;
    };

    assert.equal(payload.code, "rate_limit");
    assert.equal(payload.status, 429);
    assert.equal(payload.details?.retryAfterSeconds, 12);
    assert.equal(payload.details?.resetAt, 1_700_000_012_000);
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload.details ?? {}, "internalStack"),
      false,
    );
  } finally {
    await server.close();
  }
});