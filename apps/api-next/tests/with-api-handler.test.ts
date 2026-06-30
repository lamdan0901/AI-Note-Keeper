import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@backend/middleware/error-middleware";

import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import { EMPTY_ROUTE_CONTEXT, type RequestContext } from "../src/http/types";
import { withApiHandler } from "../src/http/with-api-handler";

const createMockPool = (): PoolErrorEventTarget & Readonly<{ emit: (error: Error) => void }> => {
  const emitter = new EventEmitter();

  return {
    removeAllListeners: (event?: string | symbol) => emitter.removeAllListeners(event),
    on: (event: "error", listener: (error: Error) => void) => emitter.on(event, listener),
    emit: (error: Error) => {
      emitter.emit("error", error);
    },
  };
};

afterEach(() => {
  resetPoolErrorStateForTests();
});

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

test("withApiHandler returns JSON 200 for plain object results", async () => {
  const handler = withApiHandler(async () => ({ ok: true, count: 2 }));
  const request = new NextRequest("http://localhost:3001/api/sample");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { ok: true, count: 2 });
});

test("withApiHandler maps thrown AppError to error response", async () => {
  const handler = withApiHandler(async () => {
    throw new AppError({ code: "forbidden", message: "Denied" });
  });
  const request = new NextRequest("http://localhost:3001/api/sample");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.equal(response.status, 403);
  assert.deepStrictEqual(payload, {
    code: "forbidden",
    message: "Denied",
    status: 403,
  });
});

test("withApiHandler maps returned AppError to error response", async () => {
  const handler = withApiHandler(async () => new AppError({ code: "not_found" }));
  const request = new NextRequest("http://localhost:3001/api/missing");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.equal(response.status, 404);
  assert.equal(payload.code, "not_found");
});

test("withApiHandler passes dynamic route params into context", async () => {
  let capturedParams: Readonly<Record<string, string>> | undefined;

  const handler = withApiHandler(async (ctx) => {
    capturedParams = ctx.params;
    return { id: ctx.params.id };
  });

  const request = new NextRequest("http://localhost:3001/api/notes/note-123");
  const response = await handler(request, {
    params: Promise.resolve({ id: "note-123" }),
  });
  const payload = await readJson(response);

  assert.deepStrictEqual(capturedParams, { id: "note-123" });
  assert.deepStrictEqual(payload, { id: "note-123" });
});

test("withApiHandler parses cookies from Cookie header", async () => {
  let capturedCookies: Readonly<Record<string, string>> | undefined;

  const handler = withApiHandler(async (ctx) => {
    capturedCookies = ctx.cookies;
    return { refresh: ctx.cookies.ank_refresh_token ?? null };
  });

  const request = new NextRequest("http://localhost:3001/api/auth/refresh", {
    headers: {
      cookie: "ank_refresh_token=refresh-token; other=value",
    },
  });
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.deepStrictEqual(capturedCookies, {
    ank_refresh_token: "refresh-token",
    other: "value",
  });
  assert.equal(payload.refresh, "refresh-token");
});

test("withApiHandler exposes forwarded proto and client IP on context", async () => {
  let capturedContext: RequestContext | undefined;

  const handler = withApiHandler(async (ctx) => {
    capturedContext = ctx;
    return { seen: true };
  });

  const request = new NextRequest("http://localhost:3001/api/auth/login", {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    },
  });
  await handler(request, EMPTY_ROUTE_CONTEXT);

  assert.equal(capturedContext?.forwardedProto, "https");
  assert.equal(capturedContext?.clientIp, "203.0.113.10");
});

test("withApiHandler runs optional validation before handler", async () => {
  const handler = withApiHandler(
    async (ctx) => ({ amount: (ctx.body as { amount: number }).amount }),
    {
      validation: {
        body: z.object({ amount: z.number().positive() }),
      },
    },
  );

  const validRequest = new NextRequest("http://localhost:3001/api/validated", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: 7 }),
  });
  const validResponse = await handler(validRequest, EMPTY_ROUTE_CONTEXT);
  const validPayload = await readJson(validResponse);

  assert.equal(validResponse.status, 200);
  assert.deepStrictEqual(validPayload, { amount: 7 });

  const invalidRequest = new NextRequest("http://localhost:3001/api/validated", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: -1 }),
  });
  const invalidResponse = await handler(invalidRequest, EMPTY_ROUTE_CONTEXT);
  const invalidPayload = await readJson(invalidResponse);

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.code, "validation");
});

test("withApiHandler passes through NextResponse results", async () => {
  const handler = withApiHandler(async () =>
    NextResponse.json({ custom: true }, { status: 201 }),
  );
  const request = new NextRequest("http://localhost:3001/api/sample");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.equal(response.status, 201);
  assert.deepStrictEqual(payload, { custom: true });
});

test("withApiHandler runs middleware chain before handler", async () => {
  const order: string[] = [];

  const handler = withApiHandler(
    async () => {
      order.push("handler");
      return { ok: true };
    },
    {
      middleware: [
        async () => {
          order.push("mw-1");
        },
        async () => {
          order.push("mw-2");
        },
      ],
    },
  );

  const request = new NextRequest("http://localhost:3001/api/sample");
  await handler(request, EMPTY_ROUTE_CONTEXT);

  assert.deepStrictEqual(order, ["mw-1", "mw-2", "handler"]);
});

test("withApiHandler applies context returned by enriching middleware", async () => {
  let capturedAuthUser: RequestContext["authUser"];

  const handler = withApiHandler(
    async (ctx) => {
      capturedAuthUser = ctx.authUser;
      return { userId: ctx.authUser?.userId ?? null };
    },
    {
      middleware: [
        (ctx) => ({
          ...ctx,
          authUser: {
            userId: "user-123",
            username: "test-user",
          },
        }),
      ],
    },
  );

  const request = new NextRequest("http://localhost:3001/api/notes");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.deepStrictEqual(capturedAuthUser, {
    userId: "user-123",
    username: "test-user",
  });
  assert.deepStrictEqual(payload, { userId: "user-123" });
});

test("withApiHandler chains enriching middleware immutably", async () => {
  let capturedAuthUser: RequestContext["authUser"];

  const handler = withApiHandler(
    async (ctx) => {
      capturedAuthUser = ctx.authUser;
      return { ok: true };
    },
    {
      middleware: [
        (ctx) => ({
          ...ctx,
          authUser: {
            userId: "user-123",
            username: "first",
          },
        }),
        (ctx) => ({
          ...ctx,
          authUser: {
            userId: ctx.authUser?.userId ?? "missing",
            username: "second",
          },
        }),
      ],
    },
  );

  const request = new NextRequest("http://localhost:3001/api/notes");
  await handler(request, EMPTY_ROUTE_CONTEXT);

  assert.deepStrictEqual(capturedAuthUser, {
    userId: "user-123",
    username: "second",
  });
});

test("withApiHandler leaves context unchanged when middleware returns void", async () => {
  let capturedAuthUser: RequestContext["authUser"];

  const handler = withApiHandler(
    async (ctx) => {
      capturedAuthUser = ctx.authUser;
      return { ok: true };
    },
    {
      middleware: [
        async () => {
          // side-effect-only middleware (e.g. rate limiter)
        },
      ],
    },
  );

  const request = new NextRequest("http://localhost:3001/api/auth/login");
  await handler(request, EMPTY_ROUTE_CONTEXT);

  assert.equal(capturedAuthUser, undefined);
});

test("withApiHandler returns 500 internal when requireHealthyDependencies and pool is degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const handler = withApiHandler(async () => ({ message: "ok" }), {
    requireHealthyDependencies: true,
    cors: false,
  });
  const request = new NextRequest("http://localhost:3001/api/sample");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});

test("withApiHandler without requireHealthyDependencies serves traffic when pool is degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const handler = withApiHandler(async () => ({ ok: true, service: "backend" }), {
    cors: false,
  });
  const request = new NextRequest("http://localhost:3001/health/live");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, {
    ok: true,
    service: "backend",
  });
});