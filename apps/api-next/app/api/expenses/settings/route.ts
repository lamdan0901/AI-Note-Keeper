import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createGetSettingsHandler } from "@/handlers/expenses/get-settings";
import { updateExpenseSettingsBodySchema } from "@/handlers/expenses/shared";
import { createUpdateSettingsHandler } from "@/handlers/expenses/update-settings";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const getSettingsHandler = withApiHandler(
  async (ctx) => {
    const handler = createGetSettingsHandler((await getComposedServices()).expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    requireHealthyDependencies: true,
    cors: true,
  },
);

const updateSettingsHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpdateSettingsHandler((await getComposedServices()).expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { body: updateExpenseSettingsBodySchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = getSettingsHandler;
export const PUT = updateSettingsHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });