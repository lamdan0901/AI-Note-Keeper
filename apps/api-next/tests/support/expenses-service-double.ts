import type {
  ExpensePeriodRecord,
  ExpenseRowRecord,
  ExpenseUserSettingsRecord,
} from "@backend/expenses/contracts.js";
import type { ExpensesRepository } from "@backend/expenses/repository";
import { createExpensesService, type ExpensesService } from "@backend/expenses/service";

export const EXPENSES_TEST_NOW = new Date("2026-06-06T12:00:00.000Z");

export type InMemoryExpensesRepositoryInitial = Readonly<{
  settings?: ExpenseUserSettingsRecord | null;
  periods?: ReadonlyArray<ExpensePeriodRecord>;
  rows?: ReadonlyArray<ExpenseRowRecord>;
}>;

export const createInMemoryExpensesRepository = (
  initial: InMemoryExpensesRepositoryInitial = {},
): ExpensesRepository => {
  let settings = initial.settings ?? null;
  const periods = new Map<string, ExpensePeriodRecord>(
    (initial.periods ?? []).map((period) => [period.id, period]),
  );
  const rows = new Map<string, ExpenseRowRecord>(
    (initial.rows ?? []).map((row) => [row.id, row]),
  );

  const periodKey = (userId: string, year: number, month: number): string => {
    return `${userId}:${year}:${month}`;
  };

  const periodByMonth = new Map<string, string>();
  for (const period of periods.values()) {
    periodByMonth.set(periodKey(period.userId, period.year, period.month), period.id);
  }

  return {
    findSettingsByUser: async (userId) => {
      if (!settings || settings.userId !== userId) {
        return null;
      }

      return settings;
    },

    upsertSettings: async (input) => {
      settings = {
        userId: input.userId,
        defaultSchema: input.defaultSchema,
        seedRows: [...input.seedRows],
        updatedAt: EXPENSES_TEST_NOW,
      };

      return settings;
    },

    listPeriodSummariesByUser: async (userId) => {
      return [...periods.values()]
        .filter((period) => period.userId === userId)
        .sort((left, right) => {
          if (left.year !== right.year) {
            return right.year - left.year;
          }

          return right.month - left.month;
        })
        .map((period) => ({
          id: period.id,
          userId: period.userId,
          year: period.year,
          month: period.month,
          label: `${period.year}-${period.month}`,
          createdAt: period.createdAt,
          updatedAt: period.updatedAt,
        }));
    },

    findPeriodByUserAndMonth: async ({ userId, year, month }) => {
      const periodId = periodByMonth.get(periodKey(userId, year, month));
      if (!periodId) {
        return null;
      }

      return periods.get(periodId) ?? null;
    },

    findPeriodByIdForUser: async ({ periodId, userId }) => {
      const period = periods.get(periodId);
      if (!period || period.userId !== userId) {
        return null;
      }

      return period;
    },

    createPeriodWithSeedRows: async (input) => {
      const period: ExpensePeriodRecord = {
        id: `period-${periods.size + 1}`,
        userId: input.userId,
        year: input.year,
        month: input.month,
        schema: input.schema,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      };

      periods.set(period.id, period);
      periodByMonth.set(periodKey(input.userId, input.year, input.month), period.id);

      input.seedRows.forEach((seedRow, index) => {
        const rowId = `seed-row-${period.id}-${index}`;
        rows.set(rowId, {
          id: rowId,
          periodId: period.id,
          userId: input.userId,
          position: index,
          cells: {
            expense: seedRow.expense,
            ...(seedRow.amount !== undefined ? { amount: seedRow.amount } : {}),
            ...(seedRow.comment !== undefined ? { comment: seedRow.comment } : {}),
          },
          deletedAt: null,
          createdAt: EXPENSES_TEST_NOW,
          updatedAt: EXPENSES_TEST_NOW,
        });
      });

      return period;
    },

    updatePeriodSchema: async ({ periodId, userId, schema }) => {
      const period = periods.get(periodId);
      if (!period || period.userId !== userId) {
        return null;
      }

      const updated = {
        ...period,
        schema,
        updatedAt: EXPENSES_TEST_NOW,
      };

      periods.set(periodId, updated);
      return updated;
    },

    listRowsByPeriod: async ({ periodId, userId }) => {
      return [...rows.values()]
        .filter((row) => row.periodId === periodId && row.userId === userId && !row.deletedAt)
        .sort((left, right) => left.position - right.position);
    },

    listTrashRowsByPeriod: async ({ periodId, userId }) => {
      return [...rows.values()]
        .filter((row) => row.periodId === periodId && row.userId === userId && row.deletedAt)
        .sort((left, right) => {
          const leftDeleted = left.deletedAt?.getTime() ?? 0;
          const rightDeleted = right.deletedAt?.getTime() ?? 0;
          return rightDeleted - leftDeleted;
        });
    },

    countActiveRowsByPeriod: async ({ periodId, userId }) => {
      return [...rows.values()].filter(
        (row) => row.periodId === periodId && row.userId === userId && !row.deletedAt,
      ).length;
    },

    createRow: async (input) => {
      const row: ExpenseRowRecord = {
        id: `row-${rows.size + 1}`,
        periodId: input.periodId,
        userId: input.userId,
        position: input.position,
        cells: input.cells,
        deletedAt: null,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      };

      rows.set(row.id, row);
      return row;
    },

    findRowByIdForUser: async ({ rowId, userId }) => {
      const row = rows.get(rowId);
      if (!row || row.userId !== userId) {
        return null;
      }

      return row;
    },

    patchRow: async ({ rowId, userId, patch }) => {
      const existing = rows.get(rowId);
      if (!existing || existing.userId !== userId) {
        return null;
      }

      const updated: ExpenseRowRecord = {
        ...existing,
        ...(patch.cells !== undefined ? { cells: patch.cells } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
        updatedAt: patch.updatedAt ?? EXPENSES_TEST_NOW,
      };

      rows.set(rowId, updated);
      return updated;
    },
  };
};

export const createExpensesServiceDouble = (
  initial: InMemoryExpensesRepositoryInitial = {},
  repository?: ExpensesRepository,
): ExpensesService => {
  return createExpensesService({
    expensesRepository: repository ?? createInMemoryExpensesRepository(initial),
    now: () => EXPENSES_TEST_NOW,
  });
};