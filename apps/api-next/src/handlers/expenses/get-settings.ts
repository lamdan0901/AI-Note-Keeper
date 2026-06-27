import type {
  ExpenseUserSettingsRecord,
} from "@backend/expenses/contracts.js";
import type { ExpensesService } from "@backend/expenses/service";

import type { ExpensesHandler } from "./shared";
import { requireAuthUserId } from "./shared";

type GetSettingsResult = Readonly<{
  settings: ExpenseUserSettingsRecord;
}>;

export const createGetSettingsHandler = (
  expensesService: ExpensesService,
): ExpensesHandler<GetSettingsResult> => {
  return async (ctx) => {
    const userId = requireAuthUserId(ctx);
    const settings = await expensesService.getOrCreateSettings({ userId });
    return { settings };
  };
};