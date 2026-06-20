import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { AppError } from '../middleware/error-middleware.js';

const loadDefaultExpenseSchema = (): unknown => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(
    here,
    '../../../../packages/shared/constants/expenseDefaultSchema.json',
  );

  return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
};

export const MAX_EXPENSE_COLUMNS = 10;
export const MAX_EXPENSE_ROWS_PER_PERIOD = 500;

export const expenseColumnTypeSchema = z.enum(['text', 'number', 'currency', 'date']);
export const expenseColumnIconSchema = z.enum(['text', 'number', 'currency', 'date']);
export const expenseColumnRoleSchema = z.enum(['amount', 'date']).nullable().optional();

export const expenseColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: expenseColumnTypeSchema,
  icon: expenseColumnIconSchema,
  visible: z.boolean(),
  position: z.number().int().min(0),
  defaultValue: z.union([z.string(), z.number(), z.null()]),
  role: expenseColumnRoleSchema,
  computed: z.literal('auto_increment').optional(),
});

export const expenseTableSchema = z.object({
  columns: z
    .array(expenseColumnSchema)
    .min(1)
    .max(MAX_EXPENSE_COLUMNS),
});

export const expenseSeedRowSchema = z.object({
  expense: z.string().min(1),
  amount: z.number().finite().optional(),
  comment: z.string().optional(),
});

export const expenseDateValueSchema = z.object({
  start: z.union([z.string(), z.null()]),
  end: z.union([z.string(), z.null()]).optional(),
  includeTime: z.boolean().optional(),
  remind: z.literal('none').optional(),
});

export const expenseCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.null(),
  expenseDateValueSchema,
]);

export const expenseCellsSchema = z.record(z.string().min(1), expenseCellValueSchema);

export const updateExpenseSettingsBodySchema = z.object({
  defaultSchema: expenseTableSchema,
  seedRows: z.array(expenseSeedRowSchema).optional(),
});

export const createExpensePeriodBodySchema = z.object({
  year: z.number().int().min(1970).max(2100),
  month: z.number().int().min(1).max(12),
});

export const patchExpensePeriodSchemaBodySchema = z.object({
  schema: expenseTableSchema,
});

export const createExpenseRowBodySchema = z.object({
  cells: expenseCellsSchema.optional(),
});

export const patchExpenseRowBodySchema = z.object({
  cells: expenseCellsSchema.optional(),
  position: z.number().int().min(0).optional(),
});

export const expensePeriodIdParamsSchema = z.object({
  periodId: z.string().min(1),
});

export const expenseRowIdParamsSchema = z.object({
  rowId: z.string().min(1),
});

export const expensePeriodByMonthQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export type ExpenseColumn = z.infer<typeof expenseColumnSchema>;
export type ExpenseTableSchema = z.infer<typeof expenseTableSchema>;
export type ExpenseSeedRow = z.infer<typeof expenseSeedRowSchema>;
export type ExpenseCells = z.infer<typeof expenseCellsSchema>;

export type ExpenseUserSettingsRecord = Readonly<{
  userId: string;
  defaultSchema: ExpenseTableSchema;
  seedRows: ReadonlyArray<ExpenseSeedRow>;
  updatedAt: Date;
}>;

export type ExpensePeriodRecord = Readonly<{
  id: string;
  userId: string;
  year: number;
  month: number;
  schema: ExpenseTableSchema;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ExpensePeriodSummary = Readonly<{
  id: string;
  userId: string;
  year: number;
  month: number;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ExpenseRowRecord = Readonly<{
  id: string;
  periodId: string;
  userId: string;
  position: number;
  cells: ExpenseCells;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ExpenseUserSettingsUpsertInput = Readonly<{
  userId: string;
  defaultSchema: ExpenseTableSchema;
  seedRows: ReadonlyArray<ExpenseSeedRow>;
}>;

export type ExpensePeriodCreateInput = Readonly<{
  userId: string;
  year: number;
  month: number;
  schema: ExpenseTableSchema;
  seedRows: ReadonlyArray<ExpenseSeedRow>;
}>;

export type ExpenseRowCreateInput = Readonly<{
  periodId: string;
  userId: string;
  position: number;
  cells: ExpenseCells;
}>;

export type ExpenseRowPatch = {
  cells?: ExpenseCells;
  position?: number;
  deletedAt?: Date | null;
  updatedAt?: Date;
};

export const DEFAULT_EXPENSE_SCHEMA = expenseTableSchema.parse(loadDefaultExpenseSchema());

export const cloneExpenseTableSchema = (schema: ExpenseTableSchema): ExpenseTableSchema => {
  return expenseTableSchema.parse(JSON.parse(JSON.stringify(schema)));
};

export const buildDefaultCellsFromSchema = (schema: ExpenseTableSchema): ExpenseCells => {
  const cells: ExpenseCells = {};

  for (const column of schema.columns) {
    if (column.computed === 'auto_increment') {
      continue;
    }

    if (column.defaultValue !== undefined) {
      cells[column.id] = column.defaultValue;
    }
  }

  return cells;
};

export const seedRowToCells = (seedRow: ExpenseSeedRow): ExpenseCells => {
  const cells: ExpenseCells = {
    expense: seedRow.expense,
  };

  if (seedRow.amount !== undefined) {
    cells.amount = seedRow.amount;
  }

  if (seedRow.comment !== undefined) {
    cells.comment = seedRow.comment;
  }

  return cells;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

const isValidExpenseDateString = (value: string): boolean => {
  return ISO_DATE_RE.test(value) || ISO_DATETIME_RE.test(value);
};

const isExpenseDateObject = (value: unknown): value is z.infer<typeof expenseDateValueSchema> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'start' in value
  );
};

const assertValidExpenseDateCellValue = (value: unknown): void => {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string') {
    if (!isValidExpenseDateString(value)) {
      throw new Error('Date must be an ISO date (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:mm) string');
    }
    return;
  }

  if (isExpenseDateObject(value)) {
    if (value.start !== null && typeof value.start === 'string' && !isValidExpenseDateString(value.start)) {
      throw new Error('Date start must be an ISO date or datetime string');
    }

    if (value.end !== undefined && value.end !== null && !isValidExpenseDateString(value.end)) {
      throw new Error('Date end must be an ISO date or datetime string');
    }

    if (value.remind !== undefined && value.remind !== 'none') {
      throw new Error('Unsupported expense date remind option');
    }

    return;
  }

  throw new Error('Date must be an ISO string, structured date object, or null');
};

export const mergeCellsWithSchemaDefaults = (
  schema: ExpenseTableSchema,
  cells: ExpenseCells = {},
): ExpenseCells => {
  return {
    ...buildDefaultCellsFromSchema(schema),
    ...cells,
  };
};

export const assertValidExpenseCells = (cells: ExpenseCells): void => {
  const result = expenseCellsSchema.safeParse(cells);
  if (!result.success) {
    throw new AppError({
      code: 'validation',
      details: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'cells',
          message: issue.message,
          code: issue.code,
        })),
      },
    });
  }

  if (Object.hasOwn(cells, 'amount')) {
    const amount = cells.amount;
    if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount))) {
      throw new AppError({
        code: 'validation',
        message: 'Amount must be a finite number or null',
      });
    }
  }

  if (Object.hasOwn(cells, 'date')) {
    const date = cells.date;
    try {
      assertValidExpenseDateCellValue(date);
    } catch (error) {
      throw new AppError({
        code: 'validation',
        message: error instanceof Error ? error.message : 'Invalid date cell value',
      });
    }
  }

  if (Object.hasOwn(cells, 'comment') && cells.comment !== null && typeof cells.comment !== 'string') {
    throw new AppError({
      code: 'validation',
      message: 'Comment must be a string',
    });
  }

  if (Object.hasOwn(cells, 'expense') && cells.expense !== null && typeof cells.expense !== 'string') {
    throw new AppError({
      code: 'validation',
      message: 'Expense must be a string',
    });
  }
};