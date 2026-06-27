import type { ExpensePeriodSummary } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type ListPeriodsResult = Readonly<{
  periods: ReadonlyArray<ExpensePeriodSummary>;
}>;

export const createListPeriodsHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<ListPeriodsResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const periods = await expensesService.listPeriodSummaries({ userId });
    return { periods };
  };
};