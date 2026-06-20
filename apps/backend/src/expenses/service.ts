import { AppError } from '../middleware/error-middleware.js';
import {
  assertValidExpenseCells,
  cloneExpenseTableSchema,
  DEFAULT_EXPENSE_SCHEMA,
  expenseTableSchema,
  MAX_EXPENSE_ROWS_PER_PERIOD,
  mergeCellsWithSchemaDefaults,
  type ExpenseCells,
  type ExpensePeriodRecord,
  type ExpensePeriodSummary,
  type ExpenseRowRecord,
  type ExpenseSeedRow,
  type ExpenseTableSchema,
  type ExpenseUserSettingsRecord,
} from './contracts.js';
import { createExpensesRepository, type ExpensesRepository } from './repository.js';

const computeSum = (rows: ReadonlyArray<{ cells: ExpenseCells }>): number => {
  return rows.reduce((sum, row) => {
    const amount = row.cells.amount;
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      return sum + amount;
    }
    return sum;
  }, 0);
};

const formatPeriodLabel = (year: number, month: number): string => {
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));
};

type ExpensesServiceDeps = Readonly<{
  expensesRepository?: ExpensesRepository;
  now?: () => Date;
}>;

export type ExpensePeriodWithRows = Readonly<{
  period: ExpensePeriodRecord & Readonly<{ label: string }>;
  rows: ReadonlyArray<ExpenseRowRecord>;
  sum: number;
}>;

export type ExpensesService = Readonly<{
  getOrCreateSettings: (input: Readonly<{ userId: string }>) => Promise<ExpenseUserSettingsRecord>;
  updateSettings: (
    input: Readonly<{
      userId: string;
      defaultSchema: ExpenseTableSchema;
      seedRows?: ReadonlyArray<ExpenseSeedRow>;
    }>,
  ) => Promise<ExpenseUserSettingsRecord>;
  listPeriodSummaries: (input: Readonly<{ userId: string }>) => Promise<ReadonlyArray<ExpensePeriodSummary>>;
  findPeriodByMonth: (
    input: Readonly<{ userId: string; year: number; month: number }>,
  ) => Promise<ExpensePeriodWithRows | null>;
  getOrCreateCurrentPeriod: (
    input: Readonly<{ userId: string }>,
  ) => Promise<ExpensePeriodWithRows>;
  createPeriod: (
    input: Readonly<{ userId: string; year: number; month: number }>,
  ) => Promise<ExpensePeriodWithRows>;
  getPeriodWithRows: (
    input: Readonly<{ periodId: string; userId: string }>,
  ) => Promise<ExpensePeriodWithRows>;
  updatePeriodSchema: (
    input: Readonly<{ periodId: string; userId: string; schema: ExpenseTableSchema }>,
  ) => Promise<ExpensePeriodRecord & Readonly<{ label: string }>>;
  createRow: (
    input: Readonly<{ periodId: string; userId: string; cells?: ExpenseCells }>,
  ) => Promise<ExpenseRowRecord>;
  updateRow: (
    input: Readonly<{ rowId: string; userId: string; cells?: ExpenseCells; position?: number }>,
  ) => Promise<ExpenseRowRecord>;
  deleteRow: (input: Readonly<{ rowId: string; userId: string }>) => Promise<ExpenseRowRecord>;
  listTrashRows: (
    input: Readonly<{ periodId: string; userId: string }>,
  ) => Promise<ReadonlyArray<ExpenseRowRecord>>;
  restoreRow: (input: Readonly<{ rowId: string; userId: string }>) => Promise<ExpenseRowRecord>;
}>;

const toNotFoundError = (message: string): AppError => {
  return new AppError({
    code: 'not_found',
    message,
  });
};

const toConflictError = (message: string): AppError => {
  return new AppError({
    code: 'conflict',
    message,
  });
};

const toValidationError = (message: string): AppError => {
  return new AppError({
    code: 'validation',
    message,
  });
};

const withPeriodLabel = (
  period: ExpensePeriodRecord,
): ExpensePeriodRecord & Readonly<{ label: string }> => {
  return {
    ...period,
    label: formatPeriodLabel(period.year, period.month),
  };
};

const buildPeriodWithRows = (
  period: ExpensePeriodRecord,
  rows: ReadonlyArray<ExpenseRowRecord>,
): ExpensePeriodWithRows => {
  return {
    period: withPeriodLabel(period),
    rows,
    sum: computeSum(rows),
  };
};

export const createExpensesService = (deps: ExpensesServiceDeps = {}): ExpensesService => {
  const expensesRepository = deps.expensesRepository ?? createExpensesRepository();
  const now = deps.now ?? (() => new Date());

  const getSettingsOrDefaults = async (userId: string): Promise<ExpenseUserSettingsRecord> => {
    const existing = await expensesRepository.findSettingsByUser(userId);
    if (existing) {
      return existing;
    }

    return await expensesRepository.upsertSettings({
      userId,
      defaultSchema: cloneExpenseTableSchema(DEFAULT_EXPENSE_SCHEMA),
      seedRows: [],
    });
  };

  const loadPeriodWithRows = async (
    period: ExpensePeriodRecord,
  ): Promise<ExpensePeriodWithRows> => {
    const rows = await expensesRepository.listRowsByPeriod({
      periodId: period.id,
      userId: period.userId,
    });

    return buildPeriodWithRows(period, rows);
  };

  return {
    getOrCreateSettings: async ({ userId }) => {
      return await getSettingsOrDefaults(userId);
    },

    updateSettings: async ({ userId, defaultSchema, seedRows }) => {
      const parsedSchema = expenseTableSchema.parse(defaultSchema);

      return await expensesRepository.upsertSettings({
        userId,
        defaultSchema: parsedSchema,
        seedRows: seedRows ?? [],
      });
    },

    listPeriodSummaries: async ({ userId }) => {
      const summaries = await expensesRepository.listPeriodSummariesByUser(userId);

      return summaries.map((summary) => ({
        ...summary,
        label: formatPeriodLabel(summary.year, summary.month),
      }));
    },

    findPeriodByMonth: async ({ userId, year, month }) => {
      const period = await expensesRepository.findPeriodByUserAndMonth({ userId, year, month });
      if (!period) {
        return null;
      }

      return await loadPeriodWithRows(period);
    },

    getOrCreateCurrentPeriod: async ({ userId }) => {
      const current = now();
      const year = current.getFullYear();
      const month = current.getMonth() + 1;

      const existing = await expensesRepository.findPeriodByUserAndMonth({ userId, year, month });
      if (existing) {
        return await loadPeriodWithRows(existing);
      }

      const settings = await getSettingsOrDefaults(userId);
      const period = await expensesRepository.createPeriodWithSeedRows({
        userId,
        year,
        month,
        schema: cloneExpenseTableSchema(settings.defaultSchema),
        seedRows: settings.seedRows,
      });

      return await loadPeriodWithRows(period);
    },

    createPeriod: async ({ userId, year, month }) => {
      const existing = await expensesRepository.findPeriodByUserAndMonth({ userId, year, month });
      if (existing) {
        throw toConflictError(`Expense period already exists for ${year}-${month}`);
      }

      const settings = await getSettingsOrDefaults(userId);
      const period = await expensesRepository.createPeriodWithSeedRows({
        userId,
        year,
        month,
        schema: cloneExpenseTableSchema(settings.defaultSchema),
        seedRows: settings.seedRows,
      });

      return await loadPeriodWithRows(period);
    },

    getPeriodWithRows: async ({ periodId, userId }) => {
      const period = await expensesRepository.findPeriodByIdForUser({ periodId, userId });
      if (!period) {
        throw toNotFoundError('Expense period not found');
      }

      return await loadPeriodWithRows(period);
    },

    updatePeriodSchema: async ({ periodId, userId, schema }) => {
      const parsedSchema = expenseTableSchema.parse(schema);
      const updated = await expensesRepository.updatePeriodSchema({
        periodId,
        userId,
        schema: parsedSchema,
      });

      if (!updated) {
        throw toNotFoundError('Expense period not found');
      }

      return withPeriodLabel(updated);
    },

    createRow: async ({ periodId, userId, cells }) => {
      const period = await expensesRepository.findPeriodByIdForUser({ periodId, userId });
      if (!period) {
        throw toNotFoundError('Expense period not found');
      }

      const activeRowCount = await expensesRepository.countActiveRowsByPeriod({ periodId, userId });
      if (activeRowCount >= MAX_EXPENSE_ROWS_PER_PERIOD) {
        throw toValidationError(`Maximum of ${MAX_EXPENSE_ROWS_PER_PERIOD} rows per period exceeded`);
      }

      const mergedCells = mergeCellsWithSchemaDefaults(period.schema, cells);
      assertValidExpenseCells(mergedCells);

      const existingRows = await expensesRepository.listRowsByPeriod({ periodId, userId });
      const nextPosition =
        existingRows.length === 0
          ? 0
          : Math.max(...existingRows.map((row) => row.position)) + 1;

      return await expensesRepository.createRow({
        periodId,
        userId,
        position: nextPosition,
        cells: mergedCells,
      });
    },

    updateRow: async ({ rowId, userId, cells, position }) => {
      const existing = await expensesRepository.findRowByIdForUser({ rowId, userId });
      if (!existing || existing.deletedAt) {
        throw toNotFoundError('Expense row not found');
      }

      const period = await expensesRepository.findPeriodByIdForUser({
        periodId: existing.periodId,
        userId,
      });
      if (!period) {
        throw toNotFoundError('Expense period not found');
      }

      const mergedCells =
        cells === undefined
          ? existing.cells
          : {
              ...existing.cells,
              ...cells,
            };

      if (cells !== undefined) {
        assertValidExpenseCells(mergedCells);
      }

      const updated = await expensesRepository.patchRow({
        rowId,
        userId,
        patch: {
          ...(cells !== undefined ? { cells: mergedCells } : {}),
          ...(position !== undefined ? { position } : {}),
          updatedAt: now(),
        },
      });

      if (!updated) {
        throw toNotFoundError('Expense row not found');
      }

      return updated;
    },

    deleteRow: async ({ rowId, userId }) => {
      const existing = await expensesRepository.findRowByIdForUser({ rowId, userId });
      if (!existing || existing.deletedAt) {
        throw toNotFoundError('Expense row not found');
      }

      const updated = await expensesRepository.patchRow({
        rowId,
        userId,
        patch: {
          deletedAt: now(),
          updatedAt: now(),
        },
      });

      if (!updated) {
        throw toNotFoundError('Expense row not found');
      }

      return updated;
    },

    listTrashRows: async ({ periodId, userId }) => {
      const period = await expensesRepository.findPeriodByIdForUser({ periodId, userId });
      if (!period) {
        throw toNotFoundError('Expense period not found');
      }

      return await expensesRepository.listTrashRowsByPeriod({ periodId, userId });
    },

    restoreRow: async ({ rowId, userId }) => {
      const existing = await expensesRepository.findRowByIdForUser({ rowId, userId });
      if (!existing || !existing.deletedAt) {
        throw toNotFoundError('Expense row not found in trash');
      }

      const updated = await expensesRepository.patchRow({
        rowId,
        userId,
        patch: {
          deletedAt: null,
          updatedAt: now(),
        },
      });

      if (!updated) {
        throw toNotFoundError('Expense row not found in trash');
      }

      return updated;
    },
  };
};