import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { AppError } from "@backend/middleware/error-middleware";

import { createAuthRateLimiter } from "../src/http/auth/rate-limit";
import type { RequestContext } from "../src/http/types";
import { withApiHandler } from "../src/http/with-api-handler";

const createContext = (clientIp: string | null): RequestContext => {
  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers: clientIp ? { "x-forwarded-for": clientIp } : undefined,
  });

  return {
    request,
    method: request.method,
    url: request.nextUrl,
    headers: request.headers,
    body: undefined,
    params: {},
    query: {},
    cookies: {},
    clientIp,
    forwardedProto: null,
  };
};

const runLimiter = async (
  limiter: ReturnType<typeof createAuthRateLimiter>,
  clientIp: string | null,
): Promise<void> => {
  await limiter(createContext(clientIp));
};

test("createAuthRateLimiter throws rate_limit when max requests exceeded within window", async () => {
  const limiter = createAuthRateLimiter({ maxRequests: 2, windowMs: 60_000 });
  const clientIp = "198.51.100.10";

  await runLimiter(limiter, clientIp);
  await runLimiter(limiter, clientIp);

  await assert.rejects(
    async () => runLimiter(limiter, clientIp),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "rate_limit");
      assert.equal(error.status, 429);
      assert.equal(typeof error.details?.retryAfterSeconds, "number");
      assert.ok((error.details?.retryAfterSeconds as number) >= 1);
      assert.equal(typeof error.details?.resetAt, "string");
      assert.ok(!Number.isNaN(Date.parse(error.details?.resetAt as string)));
      return true;
    },
  );
});

test("createAuthRateLimiter resets counter after window expires", async () => {
  const limiter = createAuthRateLimiter({ maxRequests: 1, windowMs: 40 });
  const clientIp = "198.51.100.11";

  await runLimiter(limiter, clientIp);

  await assert.rejects(
    async () => runLimiter(limiter, clientIp),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "rate_limit");
      return true;
    },
  );

  await delay(50);

  await assert.doesNotReject(async () => runLimiter(limiter, clientIp));
});

test("createAuthRateLimiter keys by unknown-ip when clientIp is absent", async () => {
  const limiter = createAuthRateLimiter({ maxRequests: 1, windowMs: 60_000 });

  await runLimiter(limiter, null);

  await assert.rejects(
    async () => runLimiter(limiter, null),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "rate_limit");
      return true;
    },
  );
});

test("withApiHandler maps rate limit middleware to 429 response", async () => {
  const limiter = createAuthRateLimiter({ maxRequests: 1, windowMs: 60_000 });
  const handler = withApiHandler(async () => ({ ok: true }), {
    middleware: [limiter],
    cors: false,
  });

  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.12" },
  });

  const firstResponse = await handler(request);
  assert.equal(firstResponse.status, 200);

  const secondResponse = await handler(request);
  const payload = (await secondResponse.json()) as Record<string, unknown>;

  assert.equal(secondResponse.status, 429);
  assert.equal(payload.code, "rate_limit");
  assert.equal(typeof payload.details, "object");
  const details = payload.details as Record<string, unknown>;
  assert.equal(typeof details.retryAfterSeconds, "number");
  assert.equal(typeof details.resetAt, "string");
});