import { AppError } from "@backend/middleware/error-middleware";

import type { RequestContext } from "@/http/types";
import type { ApiMiddleware } from "@/http/with-api-handler";

type RateLimitState = Readonly<{
  count: number;
  resetAt: number;
}>;

export const createAuthRateLimiter = (
  input: Readonly<{ maxRequests: number; windowMs: number }>,
): ApiMiddleware => {
  const byIp = new Map<string, RateLimitState>();
  const maxEntries = 5_000;
  let requestCounter = 0;

  const evictExpiredEntries = (now: number): void => {
    for (const [key, state] of byIp.entries()) {
      if (state.resetAt <= now) {
        byIp.delete(key);
      }
    }
  };

  const evictOldestWhenCapped = (): void => {
    if (byIp.size < maxEntries) {
      return;
    }

    const oldestKey = byIp.keys().next().value;
    if (typeof oldestKey === "string") {
      byIp.delete(oldestKey);
    }
  };

  return async (ctx: RequestContext): Promise<void> => {
    const now = Date.now();
    requestCounter += 1;

    if (requestCounter % 100 === 0) {
      evictExpiredEntries(now);
    }

    const key = ctx.clientIp ?? "unknown-ip";
    const existing = byIp.get(key);

    if (!existing || now >= existing.resetAt) {
      evictOldestWhenCapped();
      byIp.set(key, {
        count: 1,
        resetAt: now + input.windowMs,
      });
      return;
    }

    if (existing.count >= input.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      throw new AppError({
        code: "rate_limit",
        details: {
          retryAfterSeconds,
          resetAt: new Date(existing.resetAt).toISOString(),
        },
      });
    }

    byIp.set(key, {
      ...existing,
      count: existing.count + 1,
    });
  };
};

export const registerRateLimit = createAuthRateLimiter({ maxRequests: 20, windowMs: 60_000 });
export const loginRateLimit = createAuthRateLimiter({ maxRequests: 30, windowMs: 60_000 });
export const refreshRateLimit = createAuthRateLimiter({ maxRequests: 60, windowMs: 60_000 });
export const upgradeRateLimit = createAuthRateLimiter({ maxRequests: 15, windowMs: 60_000 });
export const logoutRateLimit = createAuthRateLimiter({ maxRequests: 60, windowMs: 60_000 });