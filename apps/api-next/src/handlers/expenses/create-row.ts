import type { ExpenseCells, ExpenseRowRecord } from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type CreateRowBody = Readonly<{
  cells?: ExpenseCells;
}>;

type CreateRowResult = Readonly<{
  row: ExpenseRowRecord;
}>;

export const createCreateRowHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<CreateRowResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const { periodId } = ctx.params;
    const body = ctx.body as CreateRowBody;

    const row = await expensesService.createRow({
      periodId,
      userId,
      cells: body.cells,
    });

    return { row };
  };
};