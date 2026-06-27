import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "@backend/middleware/error-middleware";

import {
  mergeApplyBodySchema,
  mergePreflightBodySchema,
  remapRateLimitError,
} from "../src/handlers/merge/shared";

const minimalPreflightBody = () => ({
  toUserId: "target-user",
  username: "alice",
  password: "secret",
});

test("mergePreflightBodySchema requires toUserId, username, and password", () => {
  assert.equal(mergePreflightBodySchema.safeParse(minimalPreflightBody()).success, true);
  assert.equal(
    mergePreflightBodySchema.safeParse({ ...minimalPreflightBody(), toUserId: "" }).success,
    false,
  );
  assert.equal(
    mergePreflightBodySchema.safeParse({ ...minimalPreflightBody(), username: "" }).success,
    false,
  );
  assert.equal(
    mergePreflightBodySchema.safeParse({ ...minimalPreflightBody(), password: "" }).success,
    false,
  );
});

test("mergeApplyBodySchema accepts cloud, local, and both strategies only", () => {
  for (const strategy of ["cloud", "local", "both"] as const) {
    const parsed = mergeApplyBodySchema.safeParse({
      ...minimalPreflightBody(),
      strategy,
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.strategy, strategy);
    }
  }
});

test("mergeApplyBodySchema rejects invalid strategy values", () => {
  for (const strategy of ["merge", "prompt", "invalid", ""]) {
    assert.equal(
      mergeApplyBodySchema.safeParse({ ...minimalPreflightBody(), strategy }).success,
      false,
      `expected strategy "${strategy}" to be rejected`,
    );
  }
});

test("remapRateLimitError preserves retryAfterSeconds and resetAt", () => {
  const original = new AppError({
    code: "rate_limit",
    details: {
      retryAfterSeconds: 12,
      resetAt: 1_700_000_012_000,
      internalStack: "should-not-leak",
      debugStack: "also-omit",
    },
  });

  assert.throws(
    () => remapRateLimitError(original),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "rate_limit");
      assert.equal(error.details?.retryAfterSeconds, 12);
      assert.equal(error.details?.resetAt, 1_700_000_012_000);
      assert.equal(
        Object.prototype.hasOwnProperty.call(error.details ?? {}, "internalStack"),
        false,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(error.details ?? {}, "debugStack"),
        false,
      );
      return true;
    },
  );
});

test("remapRateLimitError rethrows non-rate_limit errors unchanged", () => {
  const conflict = new AppError({ code: "conflict", message: "Already merged" });

  assert.throws(
    () => remapRateLimitError(conflict),
    (error: unknown) => {
      assert.equal(error, conflict);
      return true;
    },
  );
});

test("remapRateLimitError rethrows unknown errors unchanged", () => {
  const unknown = new Error("boom");

  assert.throws(
    () => remapRateLimitError(unknown),
    (error: unknown) => {
      assert.equal(error, unknown);
      return true;
    },
  );
});