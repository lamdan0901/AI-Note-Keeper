import type { ReminderUpdatePayload } from "@backend/reminders/contracts.js";
import type { RemindersService } from "@backend/reminders/service";

import type {
  PublicReminderRecord,
  ReminderUpdateBody,
  RemindersHandler,
} from "./shared";
import {
  computeReminderUpdated,
  requireAuthUserId,
  serializeReminder,
} from "./shared";

type UpdateReminderResult = Readonly<{
  updated: boolean;
  reminder: PublicReminderRecord | null;
}>;

export const createUpdateReminderHandler = (
  remindersService: RemindersService,
): RemindersHandler<UpdateReminderResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { reminderId } = ctx.params;
    const body = ctx.body as ReminderUpdateBody;

    const before = await remindersService.getReminder({ userId, reminderId });
    const reminder = await remindersService.updateReminder({
      userId,
      reminderId,
      patch: body as ReminderUpdatePayload,
      deviceId: body.deviceId,
    });

    return {
      updated: computeReminderUpdated(before, reminder),
      reminder: serializeReminder(reminder),
    };
  };
};