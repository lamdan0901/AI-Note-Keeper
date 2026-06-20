import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertValidExpenseCells,
  buildDefaultCellsFromSchema,
  createExpensePeriodBodySchema,
  DEFAULT_EXPENSE_SCHEMA,
  expenseTableSchema,
  mergeCellsWithSchemaDefaults,
  patchExpenseRowBodySchema,
  updateExpenseSettingsBodySchema,
} from '../../expenses/contracts.js';

test('DEFAULT_EXPENSE_SCHEMA matches the five default columns', () => {
  assert.equal(DEFAULT_EXPENSE_SCHEMA.columns.length, 5);
  assert.deepEqual(
    DEFAULT_EXPENSE_SCHEMA.columns.map((column) => column.id),
    ['expense', 'row_number', 'amount', 'date', 'comment'],
  );
});

test('updateExpenseSettingsBodySchema rejects invalid schema payloads', () => {
  const result = updateExpenseSettingsBodySchema.safeParse({
    defaultSchema: {
      columns: [],
    },
  });

  assert.equal(result.success, false);
});

test('createExpensePeriodBodySchema rejects invalid month', () => {
  const result = createExpensePeriodBodySchema.safeParse({
    year: 2026,
    month: 13,
  });

  assert.equal(result.success, false);
});

test('patchExpenseRowBodySchema rejects non-finite amount values', () => {
  const result = patchExpenseRowBodySchema.safeParse({
    cells: {
      amount: Number.NaN,
    },
  });

  assert.equal(result.success, false);
});

test('buildDefaultCellsFromSchema skips computed columns', () => {
  const cells = buildDefaultCellsFromSchema(DEFAULT_EXPENSE_SCHEMA);

  assert.deepEqual(cells, {
    expense: '',
    amount: 0,
    date: null,
    comment: '',
  });
  assert.equal(Object.hasOwn(cells, 'row_number'), false);
});

test('mergeCellsWithSchemaDefaults applies schema defaults then overrides', () => {
  const merged = mergeCellsWithSchemaDefaults(DEFAULT_EXPENSE_SCHEMA, {
    expense: 'winmart',
    amount: -76,
  });

  assert.equal(merged.expense, 'winmart');
  assert.equal(merged.amount, -76);
  assert.equal(merged.comment, '');
});

test('assertValidExpenseCells rejects invalid ISO dates', () => {
  assert.throws(
    () => {
      assertValidExpenseCells({
        date: '06/04/2026',
      });
    },
    (error: unknown) => {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'validation'
      );
    },
  );
});

test('assertValidExpenseCells accepts datetime and structured date ranges', () => {
  assert.doesNotThrow(() => {
    assertValidExpenseCells({
      date: '2026-06-04T09:00',
    });
  });

  assert.doesNotThrow(() => {
    assertValidExpenseCells({
      date: {
        start: '2026-06-04',
        end: '2026-06-10',
        includeTime: true,
        remind: 'none',
      },
    });
  });
});

test('expenseTableSchema accepts renamed default columns', () => {
  const renamed = expenseTableSchema.parse({
    columns: DEFAULT_EXPENSE_SCHEMA.columns.map((column) =>
      column.id === 'comment' ? { ...column, name: 'Notes' } : column,
    ),
  });

  assert.equal(renamed.columns.find((column) => column.id === 'comment')?.name, 'Notes');
});