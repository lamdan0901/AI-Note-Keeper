import type { MergeApplyResult } from "@backend/merge/contracts";
import type { MergeService } from "@backend/merge/service";

import type { MergeApplyBody, MergeHandler } from "./shared";
import { remapRateLimitError, requireAuthUserId } from "./shared";

export const createMergeApplyHandler = (
  mergeService: MergeService,
): MergeHandler<MergeApplyResult> => {
  return async (ctx) => {
    const fromUserId = requireAuthUserId(ctx);
    const body = ctx.body as MergeApplyBody;

    try {
      return await mergeService.apply({
        fromUserId,
        toUserId: body.toUserId,
        username: body.username,
        password: body.password,
        strategy: body.strategy,
      });
    } catch (error) {
      return remapRateLimitError(error);
    }
  };
};