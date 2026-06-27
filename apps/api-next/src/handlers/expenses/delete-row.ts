import type { ExpenseRowRecord } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type DeleteRowResult = Readonly<{
  row: ExpenseRowRecord;
}>;

export const createDeleteRowHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<DeleteRowResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { rowId } = ctx.params;

    const row = await expensesService.deleteRow({ rowId, userId });

    return { row };
  };
};