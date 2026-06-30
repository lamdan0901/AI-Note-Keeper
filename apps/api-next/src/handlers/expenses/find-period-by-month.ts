import { AppError } from "@backend/middleware/error-middleware";
import type { ExpensePeriodWithRows, ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { expensePeriodByMonthQuerySchema, requireAuthUserId } from "./shared";

export const createFindPeriodByMonthHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<ExpensePeriodWithRows> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { year, month } = expensePeriodByMonthQuerySchema.parse(ctx.query);

    const result = await expensesService.findPeriodByMonth({ userId, year, month });
    if (result === null) {
      throw new AppError({
        code: "not_found",
        message: `Expense period not found for ${year}-${month}`,
      });
    }

    return result;
  };
};