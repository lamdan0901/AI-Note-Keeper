import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { ZodError } from "zod";

import { AppError } from "@backend/middleware/error-middleware";

import { toErrorResponse } from "../src/http/errors";

const createRequest = (url: string, headers?: Record<string, string>): NextRequest => {
  return new NextRequest(url, headers ? { headers } : undefined);
};

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

test("toErrorResponse maps AppError to correct status and flat error shape", async () => {
  const request = createRequest("http://localhost:3001/known-conflict");
  const response = toErrorResponse(
    new AppError({ code: "conflict", message: "Duplicate payload", details: { field: "id" } }),
    request,
  );
  const payload = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepStrictEqual(payload, {
    code: "conflict",
    message: "Duplicate payload",
    status: 409,
    details: { field: "id" },
  });
});

test("toErrorResponse sanitizes rate-limit details to safe keys only", async () => {
  const request = createRequest("http://localhost:3001/known-rate-limit");
  const response = toErrorResponse(
    new AppError({
      code: "rate_limit",
      details: {
        retryAfterSeconds: 30,
        resetAt: "2026-04-18T00:00:00Z",
        stackHint: "do-not-expose",
      },
    }),
    request,
  );
  const payload = await readJson(response);

  assert.equal(response.status, 429);
  assert.deepStrictEqual(payload, {
    code: "rate_limit",
    message: "Rate limit exceeded",
    status: 429,
    details: {
      retryAfterSeconds: 30,
      resetAt: "2026-04-18T00:00:00Z",
    },
  });
});

test("toErrorResponse normalizes unknown errors to internal", async () => {
  const request = createRequest("http://localhost:3001/unknown-failure");
  const response = toErrorResponse(new Error("boom"), request);
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});

test("toErrorResponse maps raw ZodError to internal", async () => {
  const request = createRequest("http://localhost:3001/validated");
  const zodError = new ZodError([
    {
      code: "invalid_type",
      expected: "number",
      received: "string",
      path: ["amount"],
      message: "Expected number, received string",
    },
  ]);
  const response = toErrorResponse(zodError, request);
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});

test("toErrorResponse echoes traceId from x-request-id header for unknown errors", async () => {
  const request = createRequest("http://localhost:3001/unknown-failure", {
    "x-request-id": "  req-123  ",
  });
  const response = toErrorResponse(new Error("boom"), request);
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.equal(payload.traceId, "req-123");
});

test("toErrorResponse omits traceId when not provided", async () => {
  const request = createRequest("http://localhost:3001/known-no-trace");
  const response = toErrorResponse(new AppError({ code: "forbidden" }), request);
  const payload = await readJson(response);

  assert.equal(response.status, 403);
  assert.equal("traceId" in payload, false);
});

test("toErrorResponse prefers AppError traceId over request header", async () => {
  const request = createRequest("http://localhost:3001/known-with-trace", {
    "x-request-id": "header-trace",
  });
  const response = toErrorResponse(new AppError({ code: "forbidden", traceId: "app-trace" }), request);
  const payload = await readJson(response);

  assert.equal(response.status, 403);
  assert.equal(payload.traceId, "app-trace");
});