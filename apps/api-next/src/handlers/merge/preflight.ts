import type { MergePreflightResult } from "@backend/merge/contracts";
import type { MergeService } from "@backend/merge/service";

import type { MergeHandler, MergePreflightBody } from "./shared";
import { remapRateLimitError, requireAuthUserId } from "./shared";

export const createMergePreflightHandler = (
  mergeService: MergeService,
): MergeHandler<MergePreflightResult> => {
  return async (ctx) => {
    const fromUserId = requireAuthUserId(ctx);
    const body = ctx.body as MergePreflightBody;

    try {
      return await mergeService.preflight({
        fromUserId,
        toUserId: body.toUserId,
        username: body.username,
        password: body.password,
      });
    } catch (error) {
      return remapRateLimitError(error);
    }
  };
};