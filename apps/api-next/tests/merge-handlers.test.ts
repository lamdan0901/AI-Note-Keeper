import assert from "node:assert/strict";
import { test } from "node:test";

import type { MergeApplyResult, MergePreflightResult } from "@backend/merge/contracts";
import type { MergeService } from "@backend/merge/service";
import { AppError } from "@backend/middleware/error-middleware";

import { createMergeApplyHandler } from "../src/handlers/merge/apply";
import { createMergePreflightHandler } from "../src/handlers/merge/preflight";
import type { AuthenticatedContext } from "../src/http/types";

const AUTH_USER_ID = "source-user";

const sampleSummary = () => ({
  sourceEmpty: false,
  sourceSampleOnly: false,
  targetEmpty: false,
  hasConflicts: true,
  sourceCounts: {
    notes: 2,
    subscriptions: 1,
    tokens: 1,
    events: 1,
    expensePeriods: 2,
    expenseRows: 5,
  },
  targetCounts: {
    notes: 1,
    subscriptions: 0,
    tokens: 1,
    events: 0,
    expensePeriods: 1,
    expenseRows: 3,
  },
});

const samplePreflightResult = (): MergePreflightResult => ({
  summary: sampleSummary(),
});

const sampleApplyResult = (): MergeApplyResult => ({
  strategy: "both",
  resolution: "prompt",
  summary: sampleSummary(),
});

const minimalPreflightBody = () => ({
  toUserId: "target-user",
  username: "alice",
  password: "correct-password",
});

const createAuthContext = (body: unknown): AuthenticatedContext => ({
  request: {} as AuthenticatedContext["request"],
  method: "POST",
  url: new URL("http://localhost/api/merge/preflight"),
  headers: new Headers(),
  body,
  params: {},
  query: {},
  cookies: {},
  clientIp: null,
  forwardedProto: null,
  authUser: { userId: AUTH_USER_ID, username: "alice" },
});

const createMergeServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const mergeService: MergeService = {
    preflight: async (input) => {
      calls.push({ method: "preflight", args: input as Record<string, unknown> });
      return samplePreflightResult();
    },
    apply: async (input) => {
      calls.push({ method: "apply", args: input as Record<string, unknown> });
      return sampleApplyResult();
    },
  };

  return { mergeService, calls };
};

test("createMergePreflightHandler delegates to mergeService.preflight with auth fromUserId", async () => {
  const { mergeService, calls } = createMergeServiceDouble();
  const handler = createMergePreflightHandler(mergeService);

  const result = await handler(createAuthContext(minimalPreflightBody()));

  assert.deepStrictEqual(calls[0]?.args, {
    fromUserId: AUTH_USER_ID,
    toUserId: "target-user",
    username: "alice",
    password: "correct-password",
  });
  assert.deepStrictEqual(result, samplePreflightResult());
});

test("createMergeApplyHandler delegates to mergeService.apply with auth fromUserId and body strategy", async () => {
  const { mergeService, calls } = createMergeServiceDouble();
  const handler = createMergeApplyHandler(mergeService);

  const result = await handler(
    createAuthContext({
      ...minimalPreflightBody(),
      strategy: "local",
    }),
  );

  assert.deepStrictEqual(calls[0]?.args, {
    fromUserId: AUTH_USER_ID,
    toUserId: "target-user",
    username: "alice",
    password: "correct-password",
    strategy: "local",
  });
  assert.deepStrictEqual(result, sampleApplyResult());
});

test("createMergeApplyHandler remaps rate_limit errors without internal detail fields", async () => {
  const mergeService: MergeService = {
    preflight: async () => samplePreflightResult(),
    apply: async () => {
      throw new AppError({
        code: "rate_limit",
        details: {
          retryAfterSeconds: 12,
          resetAt: 1_700_000_012_000,
          internalStack: "should-not-leak",
        },
      });
    },
  };

  const handler = createMergeApplyHandler(mergeService);

  await assert.rejects(
    async () =>
      handler(
        createAuthContext({
          ...minimalPreflightBody(),
          strategy: "local",
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "rate_limit");
      assert.equal(error.status, 429);
      assert.equal(error.details?.retryAfterSeconds, 12);
      assert.equal(error.details?.resetAt, 1_700_000_012_000);
      assert.equal(
        Object.prototype.hasOwnProperty.call(error.details ?? {}, "internalStack"),
        false,
      );
      return true;
    },
  );
});

test("createMergeApplyHandler propagates conflict AppError from service", async () => {
  const mergeService: MergeService = {
    preflight: async () => samplePreflightResult(),
    apply: async () => {
      throw new AppError({
        code: "conflict",
        message: "Merge already completed",
      });
    },
  };

  const handler = createMergeApplyHandler(mergeService);

  await assert.rejects(
    async () =>
      handler(
        createAuthContext({
          ...minimalPreflightBody(),
          strategy: "cloud",
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "conflict");
      assert.equal(error.status, 409);
      return true;
    },
  );
});