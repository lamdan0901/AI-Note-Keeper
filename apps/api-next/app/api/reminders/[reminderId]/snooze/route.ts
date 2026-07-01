import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createSnoozeReminderHandler } from "@/handlers/reminders/snooze";
import {
  reminderIdParamsSchema,
  reminderSnoozeBodySchema,
} from "@/handlers/reminders/shared";
import { requireAccessUser } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const snoozeReminderHandler = withApiHandler(
  async (ctx) => {
    const handler = createSnoozeReminderHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { params: reminderIdParamsSchema, body: reminderSnoozeBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = snoozeReminderHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });