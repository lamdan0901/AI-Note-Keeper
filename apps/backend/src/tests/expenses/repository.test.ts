import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import { DEFAULT_EXPENSE_SCHEMA } from '../../expenses/contracts.js';

type CapturedQuery = Readonly<{
  text: string;
  values: ReadonlyArray<unknown>;
}>;

const baseSettingsRow = {
  user_id: 'user-1',
  default_schema: DEFAULT_EXPENSE_SCHEMA,
  seed_rows: [],
  updated_at: new Date('2026-06-01T00:00:00.000Z'),
};

const basePeriodRow = {
  id: 'period-1',
  user_id: 'user-1',
  year: 2026,
  month: 6,
  schema: DEFAULT_EXPENSE_SCHEMA,
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-01T00:00:00.000Z'),
};

const baseRow = {
  id: 'row-1',
  period_id: 'period-1',
  user_id: 'user-1',
  position: 0,
  cells: { expense: 'food', amount: -130 },
  deleted_at: null,
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-01T00:00:00.000Z'),
};

const createCapturingDb = (): Readonly<{
  db: DbQueryClient;
  queries: Array<CapturedQuery>;
}> => {
  const queries: Array<CapturedQuery> = [];

  const db: DbQueryClient = {
    query: async <Row extends Record<string, unknown>>(
      text: string,
      values: ReadonlyArray<unknown> = [],
    ) => {
      queries.push({ text, values });

      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('insert into expense_user_settings')) {
        return {
          rows: [baseSettingsRow] as unknown as ReadonlyArray<Row>,
        };
      }

      if (normalized.includes('insert into expense_periods')) {
        return {
          rows: [basePeriodRow] as unknown as ReadonlyArray<Row>,
        };
      }

      if (normalized.includes('insert into expense_rows')) {
        return {
          rows: [baseRow] as unknown as ReadonlyArray<Row>,
        };
      }

      if (normalized.includes('select count(*)')) {
        return {
          rows: [{ count: '2' }] as unknown as ReadonlyArray<Row>,
        };
      }

      throw new Error(`Unsupported query in test adapter: ${text}`);
    },
  };

  return { db, queries };
};

const loadRepositoryFactory = async (): Promise<
  typeof import('../../expenses/repository.js').createExpensesRepository
> => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_note_keeper';
  }

  const module = await import('../../expenses/repository.js');
  return module.createExpensesRepository;
};

test('upsertSettings serializes schema and seed rows as JSONB', async () => {
  const { db, queries } = createCapturingDb();
  const createExpensesRepository = await loadRepositoryFactory();
  const repo = createExpensesRepository({ db });

  const settings = await repo.upsertSettings({
    userId: 'user-1',
    defaultSchema: DEFAULT_EXPENSE_SCHEMA,
    seedRows: [{ expense: 'Initial budgets', amount: 16500 }],
  });

  const insert = queries[0];
  assert.match(insert.text, /\$2::jsonb/i);
  assert.match(insert.text, /\$3::jsonb/i);
  assert.equal(insert.values[1], JSON.stringify(DEFAULT_EXPENSE_SCHEMA));
  assert.equal(insert.values[2], JSON.stringify([{ expense: 'Initial budgets', amount: 16500 }]));
  assert.equal(settings.seedRows.length, 0);
});

test('createPeriodWithSeedRows inserts period then seed rows in order', async () => {
  const { db, queries } = createCapturingDb();
  const createExpensesRepository = await loadRepositoryFactory();
  const repo = createExpensesRepository({ db });

  await repo.createPeriodWithSeedRows({
    userId: 'user-1',
    year: 2026,
    month: 6,
    schema: DEFAULT_EXPENSE_SCHEMA,
    seedRows: [
      { expense: 'Initial budgets', amount: 16500 },
      { expense: 'prev month', amount: 22306 },
    ],
  });

  assert.equal(queries.length, 3);
  assert.match(queries[0].text, /insert into expense_periods/i);
  assert.match(queries[1].text, /insert into expense_rows/i);
  assert.match(queries[2].text, /insert into expense_rows/i);
  assert.equal(queries[1].values[2], 0);
  assert.equal(queries[2].values[2], 1);
  assert.equal(queries[1].values[3], JSON.stringify({ expense: 'Initial budgets', amount: 16500 }));
});

test('createRow casts cells payload to JSONB', async () => {
  const { db, queries } = createCapturingDb();
  const createExpensesRepository = await loadRepositoryFactory();
  const repo = createExpensesRepository({ db });

  const row = await repo.createRow({
    periodId: 'period-1',
    userId: 'user-1',
    position: 3,
    cells: { expense: 'food', amount: -130, comment: '' },
  });

  const insert = queries[0];
  assert.match(insert.text, /\$4::jsonb/i);
  assert.equal(insert.values[3], JSON.stringify({ expense: 'food', amount: -130, comment: '' }));
  assert.equal(row.cells.amount, -130);
});

test('countActiveRowsByPeriod returns numeric count', async () => {
  const { db } = createCapturingDb();
  const createExpensesRepository = await loadRepositoryFactory();
  const repo = createExpensesRepository({ db });

  const count = await repo.countActiveRowsByPeriod({
    periodId: 'period-1',
    userId: 'user-1',
  });

  assert.equal(count, 2);
});