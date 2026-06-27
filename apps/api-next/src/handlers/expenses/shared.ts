import type { AuthenticatedContext } from "@/http/types";

export {
  createExpensePeriodBodySchema,
  createExpenseRowBodySchema,
  expensePeriodByMonthQuerySchema,
  expensePeriodIdParamsSchema,
  expenseRowIdParamsSchema,
  patchExpensePeriodSchemaBodySchema,
  patchExpenseRowBodySchema,
  updateExpenseSettingsBodySchema,
} from "@backend/expenses/contracts.js";

export type ExpensesHandler<TResult = unknown> = (
  ctx: AuthenticatedContext,
) => Promise<TResult>;

export const requireAuthUserId = (ctx: AuthenticatedContext): string => {
  return ctx.authUser.userId;
};