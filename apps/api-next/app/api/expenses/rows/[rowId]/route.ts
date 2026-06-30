import { toAuthenticatedContext } from "@/handlers/notes/shared";
import { createDeleteRowHandler } from "@/handlers/expenses/delete-row";
import {
  expenseRowIdParamsSchema,
  patchExpenseRowBodySchema,
} from "@/handlers/expenses/shared";
import { createUpdateRowHandler } from "@/handlers/expenses/update-row";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const updateRowHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpdateRowHandler(getComposedServices().expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: {
      params: expenseRowIdParamsSchema,
      body: patchExpenseRowBodySchema,
    },
    requireHealthyDependencies: true,
    cors: true,
  },
);

const deleteRowHandler = withApiHandler(
  async (ctx) => {
    const handler = createDeleteRowHandler(getComposedServices().expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: { params: expenseRowIdParamsSchema },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const PATCH = updateRowHandler;
export const DELETE = deleteRowHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });