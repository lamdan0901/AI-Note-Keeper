import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import {
  createMergeRepository,
  expensePeriodMonthKey,
  type MergeSnapshot,
} from '../../merge/repositories/merge-repository.js';

type CapturedQuery = Readonly<{
  text: string;
  values: ReadonlyArray<unknown>;
}>;

type ExpensePeriodState = Readonly<{
  id: string;
  userId: string;
  year: number;
  month: number;
}>;

type ExpenseRowState = Readonly<{
  id: string;
  periodId: string;
  userId: string;
  position: number;
  cells: Record<string, unknown>;
}>;

type ExpenseSettingsState = Readonly<{
  userId: string;
  defaultSchema: Record<string, unknown>;
  seedRows: unknown;
}>;

const defaultSchema = { columns: [{ id: 'expense', name: 'Expense', type: 'text' }] };

const createStatefulExpenseDb = (
  input: Readonly<{
    periods: ExpensePeriodState[];
    rows: ExpenseRowState[];
    settings: ExpenseSettingsState[];
  }>,
): Readonly<{
  db: DbQueryClient & { connect: () => Promise<DbQueryClient & { release: () => void }> };
  queries: CapturedQuery[];
  periods: ExpensePeriodState[];
  rows: ExpenseRowState[];
  settings: ExpenseSettingsState[];
}> => {
  const queries: CapturedQuery[] = [];
  const periods = input.periods.map((period) => ({ ...period }));
  const rows = input.rows.map((row) => ({ ...row }));
  const settings = input.settings.map((entry) => ({ ...entry }));

  const query = async (text: string, values: ReadonlyArray<unknown> = []) => {
    queries.push({ text, values });
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('from notes')) return { rows: [] };
    if (normalized.includes('from subscriptions')) return { rows: [] };
    if (normalized.includes('from device_push_tokens')) return { rows: [] };
    if (normalized.includes('from note_change_events')) return { rows: [] };
    if (normalized.startsWith('delete from device_push_tokens')) return { rows: [] };
    if (normalized.startsWith('delete from subscriptions')) return { rows: [] };
    if (normalized.startsWith('delete from notes')) return { rows: [] };
    if (normalized.startsWith('update notes set user_id')) return { rows: [] };
    if (normalized.startsWith('update subscriptions set user_id')) return { rows: [] };
    if (normalized.startsWith('update device_push_tokens set user_id')) return { rows: [] };
    if (normalized.startsWith('update note_change_events set user_id')) return { rows: [] };

    if (normalized.includes('from expense_user_settings')) {
      const userId = values[0];
      const row = settings.find((entry) => entry.userId === userId);
      return {
        rows: row
          ? [
              {
                user_id: row.userId,
                default_schema: row.defaultSchema,
                seed_rows: row.seedRows,
                updated_at: new Date('2026-06-01T00:00:00.000Z'),
              },
            ]
          : [],
      };
    }

    if (normalized.includes('from expense_periods')) {
      const userId = values[0];
      return {
        rows: periods
          .filter((period) => period.userId === userId)
          .map((period) => ({
            id: period.id,
            user_id: period.userId,
            year: period.year,
            month: period.month,
            schema: defaultSchema,
            created_at: new Date('2026-06-01T00:00:00.000Z'),
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          })),
      };
    }

    if (normalized.includes('from expense_rows')) {
      const userId = values[0];
      return {
        rows: rows
          .filter((row) => row.userId === userId)
          .map((row) => ({
            id: row.id,
            period_id: row.periodId,
            user_id: row.userId,
            position: row.position,
            cells: row.cells,
            deleted_at: null,
            created_at: new Date('2026-06-01T00:00:00.000Z'),
            updated_at: new Date('2026-06-01T00:00:00.000Z'),
          })),
      };
    }

    if (normalized.includes('delete from expense_rows where user_id')) {
      const userId = values[0] as string;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (rows[index].userId === userId) {
          rows.splice(index, 1);
        }
      }
      return { rows: [] };
    }

    if (normalized.includes('delete from expense_periods where user_id')) {
      const userId = values[0] as string;
      for (let index = periods.length - 1; index >= 0; index -= 1) {
        if (periods[index].userId === userId) {
          periods.splice(index, 1);
        }
      }
      return { rows: [] };
    }

    if (normalized.includes('delete from expense_user_settings')) {
      const userId = String(values[0] ?? '');
      const remaining = settings.filter((entry) => entry.userId !== userId);
      settings.splice(0, settings.length, ...remaining);
      return { rows: [] };
    }

    if (normalized.includes('delete from expense_periods where id')) {
      const periodId = values[0] as string;
      const index = periods.findIndex((period) => period.id === periodId);
      if (index >= 0) {
        periods.splice(index, 1);
      }
      return { rows: [] };
    }

    if (
      normalized.includes('update expense_periods set user_id = $1 where user_id = $2')
    ) {
      const [targetUserId, sourceUserId] = values as [string, string];
      for (const period of periods) {
        if (period.userId === sourceUserId) {
          (period as { userId: string }).userId = targetUserId;
        }
      }
      return { rows: [] };
    }

    if (normalized.includes('update expense_rows set user_id = $1 where user_id = $2')) {
      const [targetUserId, sourceUserId] = values as [string, string];
      for (const row of rows) {
        if (row.userId === sourceUserId) {
          (row as { userId: string }).userId = targetUserId;
        }
      }
      return { rows: [] };
    }

    if (normalized.includes('update expense_rows set user_id = $1 where period_id = $2')) {
      const [targetUserId, periodId] = values as [string, string];
      for (const row of rows) {
        if (row.periodId === periodId) {
          (row as { userId: string }).userId = targetUserId;
        }
      }
      return { rows: [] };
    }

    if (normalized.includes('update expense_periods set user_id = $1 where id = $2')) {
      const [targetUserId, periodId] = values as [string, string];
      const period = periods.find((entry) => entry.id === periodId);
      if (period) {
        (period as { userId: string }).userId = targetUserId;
      }
      return { rows: [] };
    }

    if (normalized.includes('max(position) as max_position')) {
      const periodId = values[0] as string;
      const maxPosition = rows
        .filter((row) => row.periodId === periodId)
        .reduce((max, row) => Math.max(max, row.position), -1);
      return { rows: [{ max_position: maxPosition < 0 ? null : maxPosition }] };
    }

    if (normalized.includes('ordered_source_rows')) {
      const [sourcePeriodId, targetPeriodId, targetUserId, startPosition] = values as [
        string,
        string,
        string,
        number,
      ];
      const sourceRows = rows
        .filter((row) => row.periodId === sourcePeriodId)
        .sort((left, right) => left.position - right.position);

      sourceRows.forEach((row, index) => {
        (row as { periodId: string }).periodId = targetPeriodId;
        (row as { userId: string }).userId = targetUserId;
        (row as { position: number }).position = startPosition + index;
      });

      return { rows: [] };
    }

    if (
      normalized.includes('insert into expense_user_settings') ||
      normalized.includes('on conflict (user_id) do update')
    ) {
      const [userId, defaultSchemaValue, seedRows] = values as [string, unknown, unknown];
      const existingIndex = settings.findIndex((entry) => entry.userId === userId);
      const next = {
        userId,
        defaultSchema: defaultSchemaValue as Record<string, unknown>,
        seedRows,
      };
      if (existingIndex >= 0) {
        settings[existingIndex] = next;
      } else {
        settings.push(next);
      }
      return { rows: [] };
    }

    if (normalized.startsWith('insert into migration_attempts')) return { rows: [] };
    if (normalized.includes('from migration_attempts')) {
      return {
        rows: [
          {
            id: 'attempt-1',
            key: values[0],
            attempts: 0,
            last_attempt_at: new Date('2026-06-01T00:00:00.000Z'),
            blocked_until: null,
          },
        ],
      };
    }
    if (normalized.startsWith('update migration_attempts')) {
      return {
        rows: [
          {
            id: 'attempt-1',
            key: values[2],
            attempts: values[0],
            last_attempt_at: new Date('2026-06-01T00:00:00.000Z'),
            blocked_until: values[1],
          },
        ],
      };
    }
    if (normalized.includes('from users')) {
      return {
        rows: [
          {
            id: values[0],
            username: 'alice',
            password_hash: 'stored-hash',
          },
        ],
      };
    }

    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      return { rows: [] };
    }

    throw new Error(`Unsupported query in expense merge test adapter: ${text}`);
  };

  const client = { query, release: () => undefined };

  const db = {
    query,
    connect: async () => client,
  } as DbQueryClient & { connect: () => Promise<DbQueryClient & { release: () => void }> };

  return {
    db,
    queries,
    periods,
    rows,
    settings,
  };
};

test('expensePeriodMonthKey encodes year and month for collision detection', () => {
  assert.equal(expensePeriodMonthKey({ year: 2026, month: 6 }), '2026-6');
});

test('replaceTargetWithSource issues expense delete and move statements', async () => {
  const state = createStatefulExpenseDb({
    periods: [{ id: 'guest-period', userId: 'guest-user', year: 2026, month: 6 }],
    rows: [],
    settings: [],
  });

  const repository = createMergeRepository({ db: state.db });

  await repository.withTransaction(async (transaction) => {
    await transaction.replaceTargetWithSource({
      sourceUserId: 'guest-user',
      targetUserId: 'account-user',
    });
  });

  const normalizedQueries = state.queries.map((entry) =>
    entry.text.replace(/\s+/g, ' ').trim().toLowerCase(),
  );

  assert.equal(
    normalizedQueries.some((text) => text.includes('delete from expense_rows where user_id')),
    true,
  );
  assert.equal(
    normalizedQueries.some((text) => text.includes('update expense_periods set user_id')),
    true,
  );
});

test('mergeSourceIntoTarget issues expense row merge SQL for colliding months', async () => {
  const state = createStatefulExpenseDb({
    periods: [
      { id: 'guest-period', userId: 'guest-user', year: 2026, month: 6 },
      { id: 'account-period', userId: 'account-user', year: 2026, month: 6 },
    ],
    rows: [
      {
        id: 'guest-row',
        periodId: 'guest-period',
        userId: 'guest-user',
        position: 0,
        cells: { expense: 'guest food', amount: -50 },
      },
      {
        id: 'account-row',
        periodId: 'account-period',
        userId: 'account-user',
        position: 0,
        cells: { expense: 'account rent', amount: -500 },
      },
    ],
    settings: [],
  });

  const repository = createMergeRepository({ db: state.db });
  const source: MergeSnapshot = await repository.withTransaction((transaction) =>
    transaction.readSnapshotForUser('guest-user'),
  );
  const target: MergeSnapshot = await repository.withTransaction((transaction) =>
    transaction.readSnapshotForUser('account-user'),
  );

  await repository.withTransaction(async (transaction) => {
    await transaction.mergeSourceIntoTarget({
      source,
      target,
      sourceUserId: 'guest-user',
      targetUserId: 'account-user',
      conflictingNoteIds: new Set(),
    });
  });

  const normalizedQueries = state.queries.map((entry) =>
    entry.text.replace(/\s+/g, ' ').trim().toLowerCase(),
  );

  assert.equal(normalizedQueries.some((text) => text.includes('ordered_source_rows')), true);
  assert.equal(
    normalizedQueries.some((text) => text.includes('delete from expense_periods where id')),
    true,
  );
});