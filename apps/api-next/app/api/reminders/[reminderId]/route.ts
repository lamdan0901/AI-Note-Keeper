import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createDeleteReminderHandler } from "@/handlers/reminders/delete";
import { createGetReminderHandler } from "@/handlers/reminders/get";
import {
  reminderIdParamsSchema,
  reminderUpdateBodySchema,
} from "@/handlers/reminders/shared";
import { createUpdateReminderHandler } from "@/handlers/reminders/update";
import { requireAccessUser } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const getReminderHandler = withApiHandler(
  async (ctx) => {
    const handler = createGetReminderHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { params: reminderIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

const updateReminderHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpdateReminderHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { params: reminderIdParamsSchema, body: reminderUpdateBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

const deleteReminderHandler = withApiHandler(
  async (ctx) => {
    const handler = createDeleteReminderHandler((await getComposedServices()).remindersService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUser()],
    validation: { params: reminderIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = getReminderHandler;
export const PATCH = updateReminderHandler;
export const DELETE = deleteReminderHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });