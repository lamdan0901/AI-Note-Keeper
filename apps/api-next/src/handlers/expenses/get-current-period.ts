import type { ExpensePeriodWithRows, ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

export const createGetCurrentPeriodHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<ExpensePeriodWithRows> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    return expensesService.getOrCreateCurrentPeriod({ userId });
  };
};