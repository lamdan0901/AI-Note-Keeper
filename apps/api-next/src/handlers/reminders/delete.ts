import type { RemindersService } from "@backend/reminders/service";

import type { RemindersHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type DeleteReminderResult = Readonly<{
  deleted: boolean;
}>;

export const createDeleteReminderHandler = (
  remindersService: RemindersService,
): RemindersHandler<DeleteReminderResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { reminderId } = ctx.params;

    const deleted = await remindersService.deleteReminder({
      userId,
      reminderId,
    });

    return { deleted };
  };
};