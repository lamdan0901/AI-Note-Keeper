import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createListTrashRowsHandler } from "@/handlers/expenses/list-trash-rows";
import { expensePeriodIdParamsSchema } from "@/handlers/expenses/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const listTrashRowsHandler = withApiHandler(
  async (ctx) => {
    const handler = createListTrashRowsHandler((await getComposedServices()).expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: expensePeriodIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const GET = listTrashRowsHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });