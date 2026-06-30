import type { ExpensePeriodWithRows, ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type CreatePeriodBody = Readonly<{
  year: number;
  month: number;
}>;

export const createCreatePeriodHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<ExpensePeriodWithRows> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const body = ctx.body as CreatePeriodBody;

    return expensesService.createPeriod({
      userId,
      year: body.year,
      month: body.month,
    });
  };
};