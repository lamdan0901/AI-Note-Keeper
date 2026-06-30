import { createTokenFactory } from "@backend/auth/tokens";
import { AppError } from "@backend/middleware/error-middleware";

import { pool } from "@/db/pool";
import type { RequestContext } from "@/http/types";
import type { ApiMiddleware } from "@/http/with-api-handler";

export type AccessMiddlewareDeps = Readonly<{
  tokenFactory?: Pick<ReturnType<typeof createTokenFactory>, "verifyAccessToken">;
  resolveWebGuestUser?: (
    guestUserId: string,
  ) => Promise<Readonly<{ userId: string; username: string }>>;
}>;

const WEB_GUEST_USER_ID_PREFIX = "web-guest-";
const WEB_GUEST_USERNAME_PREFIX = "__web_guest_user__";
const WEB_GUEST_PASSWORD_HASH = "__web_guest_account_disabled__";
const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_RATE_LIMIT_WINDOW_MS = 60_000;
const GUEST_RATE_LIMIT_MAX_REQUESTS = 120;
const GUEST_RATE_LIMIT_MAX_ENTRIES = 10_000;

type GuestRateState = Readonly<{
  count: number;
  resetAt: number;
}>;

const guestRateByKey = new Map<string, GuestRateState>();
let guestRateCounter = 0;

const toGuestUsername = (guestUserId: string): string => {
  return `${WEB_GUEST_USERNAME_PREFIX}${guestUserId}`;
};

const toAuthError = (message: string): AppError => {
  return new AppError({ code: "auth", message });
};

const evictExpiredGuestRateEntries = (now: number): void => {
  for (const [key, state] of guestRateByKey.entries()) {
    if (state.resetAt <= now) {
      guestRateByKey.delete(key);
    }
  }
};

const enforceGuestRequestRateLimit = (ctx: RequestContext, guestUserId: string): void => {
  const now = Date.now();
  guestRateCounter += 1;

  if (guestRateCounter % 100 === 0) {
    evictExpiredGuestRateEntries(now);
  }

  if (guestRateByKey.size >= GUEST_RATE_LIMIT_MAX_ENTRIES) {
    const oldestKey = guestRateByKey.keys().next().value;
    if (typeof oldestKey === "string") {
      guestRateByKey.delete(oldestKey);
    }
  }

  const key = `${ctx.clientIp ?? "unknown-ip"}:${guestUserId}`;
  const existing = guestRateByKey.get(key);

  if (!existing || now >= existing.resetAt) {
    guestRateByKey.set(key, {
      count: 1,
      resetAt: now + GUEST_RATE_LIMIT_WINDOW_MS,
    });
    return;
  }

  if (existing.count >= GUEST_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw new AppError({
      code: "rate_limit",
      details: {
        retryAfterSeconds,
        resetAt: new Date(existing.resetAt).toISOString(),
      },
    });
  }

  guestRateByKey.set(key, {
    ...existing,
    count: existing.count + 1,
  });
};

const isWebGuestUserId = (value: string): boolean => {
  if (value.startsWith(WEB_GUEST_USER_ID_PREFIX)) {
    const suffix = value.slice(WEB_GUEST_USER_ID_PREFIX.length);
    return UUID_V4_LIKE_PATTERN.test(suffix);
  }

  // Backward compatibility for older installs that stored raw UUID local IDs.
  return UUID_V4_LIKE_PATTERN.test(value);
};

const resolveWebGuestUserFromDb = async (
  guestUserId: string,
): Promise<Readonly<{ userId: string; username: string }>> => {
  const expectedGuestUsername = toGuestUsername(guestUserId);
  const existing = await pool.query<Readonly<{ id: string; username: string }>>(
    `
      SELECT id, username
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [guestUserId],
  );

  const existingRow = existing.rows[0];
  if (existingRow) {
    if (existingRow.username !== expectedGuestUsername) {
      throw toAuthError("Guest user id is reserved");
    }

    return {
      userId: existingRow.id,
      username: existingRow.username,
    };
  }

  await pool.query(
    `
      INSERT INTO users (id, username, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING
    `,
    [guestUserId, expectedGuestUsername, WEB_GUEST_PASSWORD_HASH],
  );

  const created = await pool.query<Readonly<{ id: string; username: string }>>(
    `
      SELECT id, username
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [guestUserId],
  );

  const createdRow = created.rows[0];
  if (!createdRow || createdRow.username !== expectedGuestUsername) {
    throw toAuthError("Guest user initialization failed");
  }

  return {
    userId: createdRow.id,
    username: createdRow.username,
  };
};

const extractBearerToken = (authorization: string): string => {
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw toAuthError("Bearer access token is required");
  }

  return token;
};

const extractWebGuestUserId = (ctx: RequestContext): string => {
  const platform = ctx.headers.get("x-client-platform")?.toLowerCase() ?? "";
  if (platform !== "web" && platform !== "mobile") {
    throw toAuthError("Access token is required");
  }

  const guestUserId = ctx.headers.get("x-guest-user-id");
  if (!guestUserId) {
    throw toAuthError("Access token is required");
  }

  if (!isWebGuestUserId(guestUserId)) {
    throw toAuthError("Invalid guest user id");
  }

  return guestUserId;
};

/** Test-only reset for module-scoped guest rate limit state. */
export const resetGuestRateLimitStateForTests = (): void => {
  guestRateByKey.clear();
  guestRateCounter = 0;
};

let accessMiddlewareDepsForTests: AccessMiddlewareDeps | undefined;

/** Test-only override for access middleware deps (resolved per request). */
export const setAccessMiddlewareDepsForTests = (deps: AccessMiddlewareDeps): void => {
  accessMiddlewareDepsForTests = deps;
};

export const resetAccessMiddlewareDepsForTests = (): void => {
  accessMiddlewareDepsForTests = undefined;
};

const resolveAccessMiddlewareDeps = (
  routeDeps: AccessMiddlewareDeps = {},
): AccessMiddlewareDeps => {
  return {
    ...accessMiddlewareDepsForTests,
    ...routeDeps,
  };
};

const authenticateBearerAccess = async (
  ctx: RequestContext,
  tokenFactory: Pick<ReturnType<typeof createTokenFactory>, "verifyAccessToken">,
): Promise<RequestContext> => {
  const authorization = ctx.headers.get("authorization");
  if (!authorization) {
    throw toAuthError("Access token is required");
  }

  const token = extractBearerToken(authorization);

  try {
    const payload = await tokenFactory.verifyAccessToken(token);
    return {
      ...ctx,
      authUser: {
        userId: payload.userId,
        username: payload.username,
      },
    };
  } catch {
    throw toAuthError("Invalid access token");
  }
};

export const requireAccessUser = (routeDeps: AccessMiddlewareDeps = {}): ApiMiddleware => {
  return async (ctx: RequestContext): Promise<RequestContext> => {
    const deps = resolveAccessMiddlewareDeps(routeDeps);
    const tokenFactory = deps.tokenFactory ?? createTokenFactory();
    return authenticateBearerAccess(ctx, tokenFactory);
  };
};

export const requireAccessUserOrWebGuest = (
  routeDeps: AccessMiddlewareDeps = {},
): ApiMiddleware => {
  return async (ctx: RequestContext): Promise<RequestContext> => {
    const deps = resolveAccessMiddlewareDeps(routeDeps);
    const tokenFactory = deps.tokenFactory ?? createTokenFactory();
    const resolveWebGuestUser = deps.resolveWebGuestUser ?? resolveWebGuestUserFromDb;

    const authorization = ctx.headers.get("authorization");
    if (authorization) {
      return authenticateBearerAccess(ctx, tokenFactory);
    }

    const guestUserId = extractWebGuestUserId(ctx);
    enforceGuestRequestRateLimit(ctx, guestUserId);

    const guestUser = await resolveWebGuestUser(guestUserId);
    return {
      ...ctx,
      authUser: {
        userId: guestUser.userId,
        username: guestUser.username,
      },
    };
  };
};