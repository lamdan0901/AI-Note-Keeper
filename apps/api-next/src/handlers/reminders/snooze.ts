import type { RemindersService } from "@backend/reminders/service";

import type {
  PublicReminderRecord,
  ReminderSnoozeBody,
  RemindersHandler,
} from "./shared";
import {
  computeReminderUpdated,
  requireAuthUserId,
  serializeReminder,
} from "./shared";

type SnoozeReminderResult = Readonly<{
  updated: boolean;
  reminder: PublicReminderRecord | null;
}>;

export const createSnoozeReminderHandler = (
  remindersService: RemindersService,
): RemindersHandler<SnoozeReminderResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { reminderId } = ctx.params;
    const body = ctx.body as ReminderSnoozeBody;

    const before = await remindersService.getReminder({ userId, reminderId });
    const reminder = await remindersService.snoozeReminder({
      userId,
      reminderId,
      snoozedUntil: body.snoozedUntil,
      deviceId: body.deviceId,
    });

    return {
      updated: computeReminderUpdated(before, reminder),
      reminder: serializeReminder(reminder),
    };
  };
};