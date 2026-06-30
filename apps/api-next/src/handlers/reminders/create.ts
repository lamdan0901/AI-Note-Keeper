import type { RemindersService } from "@backend/reminders/service";

import type {
  PublicReminderRecord,
  ReminderCreateBody,
  RemindersHandler,
} from "./shared";
import { requireAuthUserId, serializeReminder, stripClientUserId } from "./shared";

type CreateReminderResult = Readonly<{
  reminder: PublicReminderRecord;
}>;

export const createCreateReminderHandler = (
  remindersService: RemindersService,
): RemindersHandler<CreateReminderResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const body = ctx.body as ReminderCreateBody;

    const reminder = await remindersService.createReminder({
      ...stripClientUserId(body),
      userId,
    });

    const serialized = serializeReminder(reminder);
    if (serialized === null) {
      throw new Error("createReminder returned null reminder");
    }

    return { reminder: serialized };
  };
};