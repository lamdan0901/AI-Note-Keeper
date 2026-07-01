import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createAckReminderHandler } from "@/handlers/reminders/ack";
import {
  reminderAckBodySchema,
  reminderIdParamsSchema,
} from "@/handlers/reminders/shared";
import { requireAccessUser } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const ackReminderHandler = withApiHandler(
  async (ctx) => {
    const handler = createAckReminderHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { params: reminderIdParamsSchema, body: reminderAckBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = ackReminderHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });