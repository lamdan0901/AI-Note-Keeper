import { AppError } from '../middleware/error-middleware.js';

export type AiEndpoint = 'parse' | 'clarify';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type Limits = Readonly<{
  parseLimit: number;
  clarifyLimit: number;
  windowMs: number;
}>;

const DEFAULT_LIMITS: Limits = {
  parseLimit: 10,
  clarifyLimit: 20,
  windowMs: 60_000,
};

export type AiRateLimiter = Readonly<{
  enforce: (input: Readonly<{ userId: string; endpoint: AiEndpoint }>) => void;
}>;

export const createAiRateLimiter = (
  limits: Partial<Limits> = {},
  now: () => number = Date.now,
): AiRateLimiter => {
  const config: Limits = {
    ...DEFAULT_LIMITS,
    ...limits,
  };

  const buckets = new Map<string, RateLimitBucket>();

  return {
    enforce: ({ userId, endpoint }) => {
      const limit = endpoint === 'parse' ? config.parseLimit : config.clarifyLimit;
      const key = `${userId}:${endpoint}`;
      const currentTime = now();
      const existing = buckets.get(key);

      const bucket =
        existing && existing.resetAt > currentTime
          ? existing
          : {
              count: 0,
              resetAt: currentTime + config.windowMs,
            };

      bucket.count += 1;
      buckets.set(key, bucket);

      if (bucket.count <= limit) {
        return;
      }

      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));
      throw new AppError({
        code: 'rate_limit',
        details: {
          retryAfterSeconds,
          resetAt: bucket.resetAt,
        },
      });
    },
  };
};
