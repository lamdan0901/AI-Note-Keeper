import type { RemindersService } from "@backend/reminders/service";

import type {
  PublicReminderRecord,
  ReminderAckBody,
  RemindersHandler,
} from "./shared";
import { requireAuthUserId, serializeReminder } from "./shared";

type AckReminderResult = Readonly<{
  updated: boolean;
  reminder: PublicReminderRecord | null;
}>;

export const createAckReminderHandler = (
  remindersService: RemindersService,
): RemindersHandler<AckReminderResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { reminderId } = ctx.params;
    const body = ctx.body as ReminderAckBody;

    const reminder = await remindersService.ackReminder({
      userId,
      reminderId,
      ackType: body.ackType,
      deviceId: body.deviceId,
    });

    return {
      updated: reminder !== null,
      reminder: serializeReminder(reminder),
    };
  };
};