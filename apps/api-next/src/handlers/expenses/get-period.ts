import type { ExpensePeriodWithRows, ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

export const createGetPeriodHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<ExpensePeriodWithRows> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { periodId } = ctx.params;

    return expensesService.getPeriodWithRows({ periodId, userId });
  };
};