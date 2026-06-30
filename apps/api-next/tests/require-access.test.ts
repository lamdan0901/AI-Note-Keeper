import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";

import { AppError } from "@backend/middleware/error-middleware";

import {
  requireAccessUser,
  requireAccessUserOrWebGuest,
  resetGuestRateLimitStateForTests,
} from "../src/http/auth/require-access";
import { EMPTY_ROUTE_CONTEXT, type RequestContext } from "../src/http/types";
import { withApiHandler } from "../src/http/with-api-handler";

const createContext = (
  headers: Readonly<Record<string, string>> = {},
  clientIp: string | null = "198.51.100.20",
): RequestContext => {
  const request = new NextRequest("http://localhost:3001/api/notes", {
    headers: clientIp ? { ...headers, "x-forwarded-for": clientIp } : headers,
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

afterEach(() => {
  resetGuestRateLimitStateForTests();
});

test("requireAccessUser rejects missing bearer token", async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async () => {
        throw new Error("should not run");
      },
    },
  });

  await assert.rejects(
    async () => middleware(createContext()),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Access token is required");
      return true;
    },
  );
});

test("requireAccessUser rejects invalid bearer token", async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async () => {
        throw new Error("invalid token");
      },
    },
  });

  await assert.rejects(
    async () => middleware(createContext({ authorization: "Bearer bad-token" })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Invalid access token");
      return true;
    },
  );
});

test("requireAccessUser injects authenticated user from valid bearer token", async () => {
  const middleware = requireAccessUser({
    tokenFactory: {
      verifyAccessToken: async (token) => {
        assert.equal(token, "token-123");
        return {
          type: "access",
          userId: "user-1",
          username: "alice",
          sessionId: "session-1",
        };
      },
    },
  });

  const updated = await middleware(
    createContext({ authorization: "Bearer token-123" }),
  );

  assert.deepStrictEqual(updated.authUser, {
    userId: "user-1",
    username: "alice",
  });
});

test("requireAccessUser does not accept guest headers without bearer", async () => {
  const middleware = requireAccessUser({
    resolveWebGuestUser: async (guestUserId: string) => ({
      userId: guestUserId,
      username: `__web_guest_user__${guestUserId}`,
    }),
  });

  await assert.rejects(
    async () =>
      middleware(
        createContext({
          "x-client-platform": "web",
          "x-guest-user-id": "web-guest-123e4567-e89b-12d3-a456-426614174000",
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Access token is required");
      return true;
    },
  );
});

test("requireAccessUserOrWebGuest injects authenticated user from valid bearer token", async () => {
  const middleware = requireAccessUserOrWebGuest({
    tokenFactory: {
      verifyAccessToken: async (token) => {
        assert.equal(token, "token-123");
        return {
          type: "access",
          userId: "user-1",
          username: "alice",
          sessionId: "session-1",
        };
      },
    },
  });

  const updated = await middleware(
    createContext({ authorization: "Bearer token-123" }),
  );

  assert.deepStrictEqual(updated.authUser, {
    userId: "user-1",
    username: "alice",
  });
});

test("requireAccessUserOrWebGuest rejects missing bearer when no guest headers", async () => {
  const middleware = requireAccessUserOrWebGuest({
    resolveWebGuestUser: async () => {
      throw new Error("unexpected guest resolver call");
    },
  });

  await assert.rejects(
    async () => middleware(createContext()),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Access token is required");
      return true;
    },
  );
});

test("requireAccessUserOrWebGuest rejects invalid bearer token", async () => {
  const middleware = requireAccessUserOrWebGuest({
    tokenFactory: {
      verifyAccessToken: async () => {
        throw new Error("invalid token");
      },
    },
  });

  await assert.rejects(
    async () => middleware(createContext({ authorization: "Bearer bad-token" })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.equal(error.message, "Invalid access token");
      return true;
    },
  );
});

test("requireAccessUserOrWebGuest injects guest user context for valid web guest headers", async () => {
  const middleware = requireAccessUserOrWebGuest({
    resolveWebGuestUser: async (guestUserId: string) => {
      return {
        userId: guestUserId,
        username: `__web_guest_user__${guestUserId}`,
      };
    },
  });

  const updated = await middleware(
    createContext({
      "x-client-platform": "web",
      "x-guest-user-id": "web-guest-123e4567-e89b-12d3-a456-426614174000",
    }),
  );

  assert.equal(updated.authUser?.userId, "web-guest-123e4567-e89b-12d3-a456-426614174000");
  assert.match(updated.authUser?.username ?? "", /__web_guest_user__/);
});

test("requireAccessUserOrWebGuest injects guest user context for valid mobile guest headers", async () => {
  const middleware = requireAccessUserOrWebGuest({
    resolveWebGuestUser: async (guestUserId: string) => {
      return {
        userId: guestUserId,
        username: `__web_guest_user__${guestUserId}`,
      };
    },
  });

  const updated = await middleware(
    createContext({
      "x-client-platform": "mobile",
      "x-guest-user-id": "123e4567-e89b-12d3-a456-426614174000",
    }),
  );

  assert.equal(updated.authUser?.userId, "123e4567-e89b-12d3-a456-426614174000");
  assert.match(updated.authUser?.username ?? "", /__web_guest_user__/);
});

test("requireAccessUserOrWebGuest rejects malformed web guest ids", async () => {
  const middleware = requireAccessUserOrWebGuest({
    resolveWebGuestUser: async () => {
      throw new Error("unexpected guest resolver call");
    },
  });

  await assert.rejects(
    async () =>
      middleware(
        createContext({
          "x-client-platform": "web",
          "x-guest-user-id": "invalid-guest",
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "auth");
      assert.match(error.message ?? "", /invalid guest user id/i);
      return true;
    },
  );
});

test("requireAccessUserOrWebGuest enforces guest rate limit with retry metadata", async () => {
  const middleware = requireAccessUserOrWebGuest({
    resolveWebGuestUser: async (guestUserId: string) => ({
      userId: guestUserId,
      username: `__web_guest_user__${guestUserId}`,
    }),
  });

  const guestHeaders = {
    "x-client-platform": "web",
    "x-guest-user-id": "web-guest-123e4567-e89b-12d3-a456-426614174000",
  } as const;
  const clientIp = "198.51.100.21";

  for (let index = 0; index < 120; index += 1) {
    await middleware(createContext(guestHeaders, clientIp));
  }

  await assert.rejects(
    async () => middleware(createContext(guestHeaders, clientIp)),
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

test("withApiHandler maps requireAccessUserOrWebGuest failures to 401", async () => {
  const handler = withApiHandler(async (ctx) => ({ userId: ctx.authUser?.userId }), {
    middleware: [requireAccessUserOrWebGuest()],
    cors: false,
  });

  const request = new NextRequest("http://localhost:3001/api/notes");
  const response = await handler(request, EMPTY_ROUTE_CONTEXT);
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(payload.code, "auth");
});

test("withApiHandler maps guest rate limit failures to 429", async () => {
  const middleware = requireAccessUserOrWebGuest({
    resolveWebGuestUser: async (guestUserId: string) => ({
      userId: guestUserId,
      username: `__web_guest_user__${guestUserId}`,
    }),
  });

  const handler = withApiHandler(async () => ({ ok: true }), {
    middleware: [middleware],
    cors: false,
  });

  const guestHeaders = {
    "x-client-platform": "web",
    "x-guest-user-id": "web-guest-123e4567-e89b-12d3-a456-426614174000",
    "x-forwarded-for": "198.51.100.22",
  };

  for (let index = 0; index < 120; index += 1) {
    const response = await handler(
      new NextRequest("http://localhost:3001/api/notes", { headers: guestHeaders }),
      EMPTY_ROUTE_CONTEXT,
    );
    assert.equal(response.status, 200);
  }

  const limitedResponse = await handler(
    new NextRequest("http://localhost:3001/api/notes", { headers: guestHeaders }),
    EMPTY_ROUTE_CONTEXT,
  );
  const payload = (await limitedResponse.json()) as Record<string, unknown>;

  assert.equal(limitedResponse.status, 429);
  assert.equal(payload.code, "rate_limit");
  assert.equal(typeof payload.details, "object");
  const details = payload.details as Record<string, unknown>;
  assert.equal(typeof details.retryAfterSeconds, "number");
  assert.equal(typeof details.resetAt, "string");
});