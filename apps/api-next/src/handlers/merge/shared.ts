import { AppError } from "@backend/middleware/error-middleware";

import type { AuthenticatedContext } from "@/http/types";

export {
  mergeApplyBodySchema,
  mergePreflightBodySchema,
  type MergeApplyBody,
  type MergePreflightBody,
} from "@backend/merge/contracts";

export type MergeHandler<TResult = unknown> = (
  ctx: AuthenticatedContext,
) => Promise<TResult>;

export const requireAuthUserId = (ctx: AuthenticatedContext): string => {
  return ctx.authUser.userId;
};

export const remapRateLimitError = (error: unknown): never => {
  if (error instanceof AppError && error.code === "rate_limit") {
    throw new AppError({
      code: "rate_limit",
      details: {
        retryAfterSeconds: error.details?.retryAfterSeconds,
        resetAt: error.details?.resetAt,
      },
    });
  }

  throw error;
};