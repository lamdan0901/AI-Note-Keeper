import type { RemindersService } from "@backend/reminders/service";

import type { PublicReminderRecord, RemindersHandler } from "./shared";
import {
  listQuerySchema,
  requireAuthUserId,
  serializeReminder,
} from "./shared";

type ListRemindersResult = Readonly<{
  reminders: ReadonlyArray<PublicReminderRecord>;
}>;

export const createListRemindersHandler = (
  remindersService: RemindersService,
): RemindersHandler<ListRemindersResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { updatedSince } = listQuerySchema.parse(ctx.query);

    const reminders = await remindersService.listReminders({
      userId,
      updatedSince,
    });

    const serializedReminders = reminders.map((reminder) => {
      const serialized = serializeReminder(reminder);
      if (serialized === null) {
        throw new Error("serializeReminder returned null for reminder record");
      }
      return serialized;
    });

    return { reminders: serializedReminders };
  };
};