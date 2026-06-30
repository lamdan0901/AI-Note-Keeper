import assert from "node:assert/strict";
import { test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import {
  createEmptyMergeSecurityState,
  createPhase5SecurityMergeService,
} from "../support/phase5-merge-parity-harness";
import { jsonAuthHeaders, startMergeTestServer } from "../support/merge-test-server";

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({ userId, username: userId });
  return pair.accessToken;
};

const assertEnvelopeShape = (payload: {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}): void => {
  assert.equal(typeof payload.code, "string");
  assert.equal(typeof payload.message, "string");
  assert.equal(typeof payload.status, "number");
};

const mergeApplyBody = (overrides: Record<string, unknown> = {}) => ({
  toUserId: "target-user",
  username: "target-username",
  password: "wrong-password",
  strategy: "local",
  ...overrides,
});

test("phase-5 security: repeated merge abuse attempts trigger rate_limit with retry metadata", async () => {
  const state = createEmptyMergeSecurityState();
  const server = await startMergeTestServer({
    mergeService: createPhase5SecurityMergeService(state),
  });
  const token = await createAccessToken("source-user");

  try {
    const attempt = async (): Promise<Response> => {
      return await server.fetch("/api/merge/apply", {
        method: "POST",
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(mergeApplyBody()),
      });
    };

    const first = await attempt();
    const second = await attempt();
    const third = await attempt();
    const fourth = await attempt();

    assert.equal(first.status, 401);
    assert.equal(second.status, 401);
    assert.equal(third.status, 429);
    assert.equal(fourth.status, 429);

    const payload = (await third.json()) as {
      code: string;
      status: number;
      details?: Record<string, unknown>;
    };

    assert.equal(payload.code, "rate_limit");
    assert.equal(payload.status, 429);
    assert.equal(payload.details?.retryAfterSeconds, 60);
    assert.equal(payload.details?.resetAt, 1_800_000_000_000);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.details ?? {}, "debugStack"), false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload.details ?? {}, "internalStack"),
      false,
    );
  } finally {
    await server.close();
  }
});

test("phase-5 security: concurrent merge apply attempts do not double-write target state", async () => {
  const state = createEmptyMergeSecurityState();
  state.targetNotesByUser.set("target-user", 1);

  const server = await startMergeTestServer({
    mergeService: createPhase5SecurityMergeService(state),
  });
  const token = await createAccessToken("source-user");

  try {
    const runApply = async (): Promise<Response> => {
      return await server.fetch("/api/merge/apply", {
        method: "POST",
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(
          mergeApplyBody({
            password: "correct-password",
            strategy: "both",
          }),
        ),
      });
    };

    const [left, right] = await Promise.all([runApply(), runApply()]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const postPreflight = await server.fetch("/api/merge/preflight", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        toUserId: "target-user",
        username: "target-username",
        password: "correct-password",
      }),
    });

    assert.equal(postPreflight.status, 200);
    const summary = (await postPreflight.json()) as {
      summary: { targetCounts: { notes: number } };
    };

    assert.equal(summary.summary.targetCounts.notes, 2);
  } finally {
    await server.close();
  }
});

test("phase-5 security: unauthorized and malformed requests preserve stable non-2xx envelope shape", async () => {
  const state = createEmptyMergeSecurityState();
  const server = await startMergeTestServer({
    mergeService: createPhase5SecurityMergeService(state),
  });
  const token = await createAccessToken("source-user");

  try {
    const unauthorized = await server.fetch("/api/merge/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toUserId: "target-user",
        username: "target-username",
        password: "correct-password",
      }),
    });

    assert.equal(unauthorized.status, 401);
    const unauthorizedPayload = (await unauthorized.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assertEnvelopeShape(unauthorizedPayload);
    assert.equal(unauthorizedPayload.code, "auth");

    const malformed = await server.fetch("/api/merge/apply", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        toUserId: "",
        username: "target-username",
        password: "correct-password",
        strategy: "hybrid",
      }),
    });

    assert.equal(malformed.status, 400);
    const malformedPayload = (await malformed.json()) as {
      code: string;
      message: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assertEnvelopeShape(malformedPayload);
    assert.equal(malformedPayload.code, "validation");
    assert.ok((malformedPayload.details?.issues?.length ?? 0) > 0);
  } finally {
    await server.close();
  }
});