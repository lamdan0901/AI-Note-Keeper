import type { ExpensePeriodRecord, ExpenseTableSchema } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type UpdatePeriodSchemaBody = Readonly<{
  schema: ExpenseTableSchema;
}>;

type UpdatePeriodSchemaResult = Readonly<{
  period: ExpensePeriodRecord & Readonly<{ label: string }>;
}>;

export const createUpdatePeriodSchemaHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<UpdatePeriodSchemaResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { periodId } = ctx.params;
    const body = ctx.body as UpdatePeriodSchemaBody;

    const period = await expensesService.updatePeriodSchema({
      periodId,
      userId,
      schema: body.schema,
    });

    return { period };
  };
};