import type { SubscriptionsService } from "@backend/subscriptions/service";

import type { SubscriptionsHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type EmptyTrashResult = Readonly<{
  deleted: number;
}>;

export const createEmptyTrashHandler = (
  subscriptionsService: SubscriptionsService,
): SubscriptionsHandler<EmptyTrashResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const deleted = await subscriptionsService.emptyTrash({ userId });
    return { deleted };
  };
};