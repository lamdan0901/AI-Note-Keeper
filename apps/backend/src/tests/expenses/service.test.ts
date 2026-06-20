import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../middleware/error-middleware.js';
import {
  DEFAULT_EXPENSE_SCHEMA,
  type ExpensePeriodRecord,
  type ExpenseRowRecord,
  type ExpenseUserSettingsRecord,
} from '../../expenses/contracts.js';
import type { ExpensesRepository } from '../../expenses/repository.js';
import { createExpensesService } from '../../expenses/service.js';

const now = new Date('2026-06-06T12:00:00.000Z');

const basePeriod: ExpensePeriodRecord = {
  id: 'period-1',
  userId: 'user-1',
  year: 2026,
  month: 6,
  schema: DEFAULT_EXPENSE_SCHEMA,
  createdAt: now,
  updatedAt: now,
};

const createRow = (
  input: Readonly<{
    id: string;
    position: number;
    cells: ExpenseRowRecord['cells'];
  }>,
): ExpenseRowRecord => {
  return {
    id: input.id,
    periodId: basePeriod.id,
    userId: basePeriod.userId,
    position: input.position,
    cells: input.cells,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
};

const createInMemoryExpensesRepository = (
  initial: Readonly<{
    settings?: ExpenseUserSettingsRecord | null;
    periods?: ReadonlyArray<ExpensePeriodRecord>;
    rows?: ReadonlyArray<ExpenseRowRecord>;
  }> = {},
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
        updatedAt: now,
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
        createdAt: now,
        updatedAt: now,
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
          createdAt: now,
          updatedAt: now,
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
        updatedAt: now,
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
        createdAt: now,
        updatedAt: now,
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
        updatedAt: patch.updatedAt ?? now,
      };

      rows.set(rowId, updated);
      return updated;
    },
  };
};

test('getOrCreateSettings bootstraps default schema and empty seed rows', async () => {
  const repository = createInMemoryExpensesRepository();
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const settings = await service.getOrCreateSettings({ userId: 'user-1' });

  assert.equal(settings.userId, 'user-1');
  assert.equal(settings.defaultSchema.columns.length, 5);
  assert.deepEqual(settings.seedRows, []);
});

test('createPeriod copies settings schema and inserts seed rows in order', async () => {
  const repository = createInMemoryExpensesRepository({
    settings: {
      userId: 'user-1',
      defaultSchema: {
        columns: DEFAULT_EXPENSE_SCHEMA.columns.map((column) =>
          column.id === 'comment' ? { ...column, name: 'Notes' } : column,
        ),
      },
      seedRows: [
        { expense: 'Initial budgets', amount: 16500, comment: 'internet' },
        { expense: 'prev month', amount: 22306 },
      ],
      updatedAt: now,
    },
  });
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const result = await service.createPeriod({ userId: 'user-1', year: 2026, month: 7 });

  assert.equal(result.period.year, 2026);
  assert.equal(result.period.month, 7);
  assert.equal(result.period.label, 'July 2026');
  assert.equal(
    result.period.schema.columns.find((column) => column.id === 'comment')?.name,
    'Notes',
  );
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.cells.expense, 'Initial budgets');
  assert.equal(result.rows[0]?.cells.amount, 16500);
  assert.equal(result.rows[1]?.cells.expense, 'prev month');
  assert.equal(result.rows[1]?.position, 1);
});

test('getPeriodWithRows recomputes sum from amount cells', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [basePeriod],
    rows: [
      createRow({ id: 'row-1', position: 0, cells: { expense: 'a', amount: 16500 } }),
      createRow({ id: 'row-2', position: 1, cells: { expense: 'b', amount: -76 } }),
      createRow({ id: 'row-3', position: 2, cells: { expense: 'c', amount: 200 } }),
    ],
  });
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const result = await service.getPeriodWithRows({ periodId: 'period-1', userId: 'user-1' });

  assert.equal(result.sum, 16624);
});

test('createRow merges schema default values into cells', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [basePeriod],
    rows: [createRow({ id: 'row-1', position: 0, cells: { expense: 'seed', amount: 100 } })],
  });
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const row = await service.createRow({
    periodId: 'period-1',
    userId: 'user-1',
    cells: {
      expense: 'winmart',
      amount: -76,
    },
  });

  assert.equal(row.cells.expense, 'winmart');
  assert.equal(row.cells.amount, -76);
  assert.equal(row.cells.comment, '');
  assert.equal(row.cells.date, null);
  assert.equal(row.position, 1);
});

test('getOrCreateCurrentPeriod creates once and returns same period on repeat', async () => {
  const repository = createInMemoryExpensesRepository();
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const first = await service.getOrCreateCurrentPeriod({ userId: 'user-1' });
  const second = await service.getOrCreateCurrentPeriod({ userId: 'user-1' });

  assert.equal(first.period.id, second.period.id);
  assert.equal(first.period.year, 2026);
  assert.equal(first.period.month, 6);
});

test('createPeriod rejects duplicate month with conflict error', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [basePeriod],
  });
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  await assert.rejects(
    () => service.createPeriod({ userId: 'user-1', year: 2026, month: 6 }),
    (error: unknown) => {
      return error instanceof AppError && error.code === 'conflict';
    },
  );
});

test('deleteRow soft-deletes row and excludes it from period sum', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [basePeriod],
    rows: [
      createRow({ id: 'row-1', position: 0, cells: { expense: 'a', amount: 100 } }),
      createRow({ id: 'row-2', position: 1, cells: { expense: 'b', amount: 50 } }),
    ],
  });
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const deleted = await service.deleteRow({ rowId: 'row-1', userId: 'user-1' });
  assert.ok(deleted.deletedAt);

  const period = await service.getPeriodWithRows({ periodId: 'period-1', userId: 'user-1' });
  assert.equal(period.rows.length, 1);
  assert.equal(period.rows[0]?.id, 'row-2');
  assert.equal(period.sum, 50);

  const trash = await service.listTrashRows({ periodId: 'period-1', userId: 'user-1' });
  assert.equal(trash.length, 1);
  assert.equal(trash[0]?.id, 'row-1');
});

test('restoreRow returns deleted row to active period', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [basePeriod],
    rows: [
      {
        ...createRow({ id: 'row-1', position: 0, cells: { expense: 'a', amount: 100 } }),
        deletedAt: now,
      },
    ],
  });
  const service = createExpensesService({ expensesRepository: repository, now: () => now });

  const restored = await service.restoreRow({ rowId: 'row-1', userId: 'user-1' });
  assert.equal(restored.deletedAt, null);

  const period = await service.getPeriodWithRows({ periodId: 'period-1', userId: 'user-1' });
  assert.equal(period.rows.length, 1);
  assert.equal(period.sum, 100);
});