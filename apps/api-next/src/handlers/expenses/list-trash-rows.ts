import type { ExpenseRowRecord } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type ListTrashRowsResult = Readonly<{
  rows: ReadonlyArray<ExpenseRowRecord>;
}>;

export const createListTrashRowsHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<ListTrashRowsResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { periodId } = ctx.params;

    const rows = await expensesService.listTrashRows({ periodId, userId });
    return { rows };
  };
};