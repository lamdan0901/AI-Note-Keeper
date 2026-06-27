import type { ExpenseCells, ExpenseRowRecord } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type UpdateRowBody = Readonly<{
  cells?: ExpenseCells;
  position?: number;
}>;

type UpdateRowResult = Readonly<{
  row: ExpenseRowRecord;
}>;

export const createUpdateRowHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<UpdateRowResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { rowId } = ctx.params;
    const body = ctx.body as UpdateRowBody;

    const row = await expensesService.updateRow({
      rowId,
      userId,
      cells: body.cells,
      position: body.position,
    });

    return { row };
  };
};