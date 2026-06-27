import type { ExpenseRowRecord } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type RestoreRowResult = Readonly<{
  row: ExpenseRowRecord;
}>;

export const createRestoreRowHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<RestoreRowResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { rowId } = ctx.params;

    const row = await expensesService.restoreRow({ rowId, userId });

    return { row };
  };
};