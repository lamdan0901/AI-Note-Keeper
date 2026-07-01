import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createRestoreRowHandler } from "@/handlers/expenses/restore-row";
import { expenseRowIdParamsSchema } from "@/handlers/expenses/shared";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const restoreRowHandler = withApiHandler(
  async (ctx) => {
    const handler = createRestoreRowHandler((await getComposedServices()).expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: expenseRowIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const POST = restoreRowHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });