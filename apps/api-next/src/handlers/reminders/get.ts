import type { RemindersService } from "@backend/reminders/service";

import type { PublicReminderRecord, RemindersHandler } from "./shared";
import { requireAuthUserId, serializeReminder } from "./shared";

type GetReminderResult = Readonly<{
  reminder: PublicReminderRecord | null;
}>;

export const createGetReminderHandler = (
  remindersService: RemindersService,
): RemindersHandler<GetReminderResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { reminderId } = ctx.params;

    const reminder = await remindersService.getReminder({ userId, reminderId });

    return { reminder: serializeReminder(reminder) };
  };
};