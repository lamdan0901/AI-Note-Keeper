import { createCreateReminderHandler } from "@/handlers/reminders/create";
import { createListRemindersHandler } from "@/handlers/reminders/list";
import { listQuerySchema, reminderCreateBodySchema } from "@/handlers/reminders/shared";
import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { requireAccessUser } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const listHandler = withApiHandler(
  async (ctx) => {
    const handler = createListRemindersHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { query: listQuerySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

const createHandler = withApiHandler(
  async (ctx) => {
    const handler = createCreateReminderHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { body: reminderCreateBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = listHandler;
export const POST = createHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });