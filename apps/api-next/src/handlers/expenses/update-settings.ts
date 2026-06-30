import type {
  ExpenseSeedRow,
  ExpenseTableSchema,
  ExpenseUserSettingsRecord,
} from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type UpdateSettingsBody = Readonly<{
  defaultSchema: ExpenseTableSchema;
  seedRows?: ReadonlyArray<ExpenseSeedRow>;
}>;

type UpdateSettingsResult = Readonly<{
  settings: ExpenseUserSettingsRecord;
}>;

export const createUpdateSettingsHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<UpdateSettingsResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const body = ctx.body as UpdateSettingsBody;

    const settings = await expensesService.updateSettings({
      userId,
      defaultSchema: body.defaultSchema,
      seedRows: body.seedRows,
    });

    return { settings };
  };
};