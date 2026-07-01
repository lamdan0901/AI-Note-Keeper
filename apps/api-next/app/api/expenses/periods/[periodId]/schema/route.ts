import { toAuthenticatedContext } from "@/handlers/notes/shared";
import {
  expensePeriodIdParamsSchema,
  patchExpensePeriodSchemaBodySchema,
} from "@/handlers/expenses/shared";
import { createUpdatePeriodSchemaHandler } from "@/handlers/expenses/update-period-schema";
import { requireAccessUserOrWebGuest } from "@/http/auth/require-access";
import { withApiHandler } from "@/http/with-api-handler";
import { getComposedServices } from "@/server/compose-services";

export const runtime = "nodejs";

const updatePeriodSchemaHandler = withApiHandler(
  async (ctx) => {
    const handler = createUpdatePeriodSchemaHandler((await getComposedServices()).expensesService);
    return handler(toAuthenticatedContext(ctx));
  },
  {
    middleware: [requireAccessUserOrWebGuest()],
    validation: {
      params: expensePeriodIdParamsSchema,
      body: patchExpensePeriodSchemaBodySchema,
    },
    requireHealthyDependencies: true,
    cors: true,
  },
);

export const PATCH = updatePeriodSchemaHandler;
export const OPTIONS = withApiHandler(async () => null, { cors: true });