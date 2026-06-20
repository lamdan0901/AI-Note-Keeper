import type { DbQueryClient } from '../auth/contracts.js';
import { pool } from '../db/pool.js';
import type {
  ExpenseCells,
  ExpensePeriodCreateInput,
  ExpensePeriodRecord,
  ExpensePeriodSummary,
  ExpenseRowCreateInput,
  ExpenseRowPatch,
  ExpenseRowRecord,
  ExpenseSeedRow,
  ExpenseTableSchema,
  ExpenseUserSettingsRecord,
  ExpenseUserSettingsUpsertInput,
} from './contracts.js';
import { expenseCellsSchema, expenseSeedRowSchema, expenseTableSchema } from './contracts.js';

type ExpenseUserSettingsRow = Readonly<{
  user_id: string;
  default_schema: unknown;
  seed_rows: unknown;
  updated_at: Date;
}>;

type ExpensePeriodRow = Readonly<{
  id: string;
  user_id: string;
  year: number;
  month: number;
  schema: unknown;
  created_at: Date;
  updated_at: Date;
}>;

type ExpenseRowDbRow = Readonly<{
  id: string;
  period_id: string;
  user_id: string;
  position: number;
  cells: unknown;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

export type ExpensesRepository = Readonly<{
  findSettingsByUser: (userId: string) => Promise<ExpenseUserSettingsRecord | null>;
  upsertSettings: (input: ExpenseUserSettingsUpsertInput) => Promise<ExpenseUserSettingsRecord>;
  listPeriodSummariesByUser: (userId: string) => Promise<ReadonlyArray<ExpensePeriodSummary>>;
  findPeriodByUserAndMonth: (
    input: Readonly<{ userId: string; year: number; month: number }>,
  ) => Promise<ExpensePeriodRecord | null>;
  findPeriodByIdForUser: (
    input: Readonly<{ periodId: string; userId: string }>,
  ) => Promise<ExpensePeriodRecord | null>;
  createPeriodWithSeedRows: (input: ExpensePeriodCreateInput) => Promise<ExpensePeriodRecord>;
  updatePeriodSchema: (
    input: Readonly<{ periodId: string; userId: string; schema: ExpenseTableSchema }>,
  ) => Promise<ExpensePeriodRecord | null>;
  listRowsByPeriod: (
    input: Readonly<{ periodId: string; userId: string }>,
  ) => Promise<ReadonlyArray<ExpenseRowRecord>>;
  listTrashRowsByPeriod: (
    input: Readonly<{ periodId: string; userId: string }>,
  ) => Promise<ReadonlyArray<ExpenseRowRecord>>;
  countActiveRowsByPeriod: (
    input: Readonly<{ periodId: string; userId: string }>,
  ) => Promise<number>;
  createRow: (input: ExpenseRowCreateInput) => Promise<ExpenseRowRecord>;
  patchRow: (
    input: Readonly<{ rowId: string; userId: string; patch: ExpenseRowPatch }>,
  ) => Promise<ExpenseRowRecord | null>;
  findRowByIdForUser: (
    input: Readonly<{ rowId: string; userId: string }>,
  ) => Promise<ExpenseRowRecord | null>;
}>;

const toSeedRows = (value: unknown): ReadonlyArray<ExpenseSeedRow> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => expenseSeedRowSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
};

const toSettingsDomain = (row: ExpenseUserSettingsRow): ExpenseUserSettingsRecord => {
  return {
    userId: row.user_id,
    defaultSchema: expenseTableSchema.parse(row.default_schema),
    seedRows: toSeedRows(row.seed_rows),
    updatedAt: row.updated_at,
  };
};

const toPeriodDomain = (row: ExpensePeriodRow): ExpensePeriodRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    year: row.year,
    month: row.month,
    schema: expenseTableSchema.parse(row.schema),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toRowDomain = (row: ExpenseRowDbRow): ExpenseRowRecord => {
  return {
    id: row.id,
    periodId: row.period_id,
    userId: row.user_id,
    position: row.position,
    cells: expenseCellsSchema.parse(row.cells),
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toPatchColumns = (
  patch: ExpenseRowPatch,
): Array<Readonly<{ column: string; value: unknown }>> => {
  const columns: Array<Readonly<{ column: string; value: unknown }>> = [];
  const add = (column: string, value: unknown): void => {
    columns.push({ column, value });
  };

  if (Object.hasOwn(patch, 'cells')) {
    add('cells', JSON.stringify(patch.cells ?? {}));
  }
  if (Object.hasOwn(patch, 'position')) {
    add('position', patch.position ?? 0);
  }
  if (Object.hasOwn(patch, 'deletedAt')) {
    add('deleted_at', patch.deletedAt ?? null);
  }
  if (Object.hasOwn(patch, 'updatedAt')) {
    add('updated_at', patch.updatedAt ?? new Date());
  }

  return columns;
};

export const createExpensesRepository = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): ExpensesRepository => {
  const db = deps.db ?? pool;

  const findPeriodByIdForUser = async (
    input: Readonly<{ periodId: string; userId: string }>,
  ): Promise<ExpensePeriodRecord | null> => {
    const result = await db.query<ExpensePeriodRow>(
      `
        SELECT *
        FROM expense_periods
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [input.periodId, input.userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return toPeriodDomain(result.rows[0]);
  };

  const findRowByIdForUser = async (
    input: Readonly<{ rowId: string; userId: string }>,
  ): Promise<ExpenseRowRecord | null> => {
    const result = await db.query<ExpenseRowDbRow>(
      `
        SELECT *
        FROM expense_rows
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [input.rowId, input.userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return toRowDomain(result.rows[0]);
  };

  return {
    findSettingsByUser: async (userId) => {
      const result = await db.query<ExpenseUserSettingsRow>(
        `
          SELECT *
          FROM expense_user_settings
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toSettingsDomain(result.rows[0]);
    },

    upsertSettings: async (input) => {
      const result = await db.query<ExpenseUserSettingsRow>(
        `
          INSERT INTO expense_user_settings (
            user_id,
            default_schema,
            seed_rows,
            updated_at
          )
          VALUES ($1, $2::jsonb, $3::jsonb, NOW())
          ON CONFLICT (user_id)
          DO UPDATE SET
            default_schema = EXCLUDED.default_schema,
            seed_rows = EXCLUDED.seed_rows,
            updated_at = NOW()
          RETURNING *
        `,
        [
          input.userId,
          JSON.stringify(input.defaultSchema),
          JSON.stringify(input.seedRows),
        ],
      );

      return toSettingsDomain(result.rows[0]);
    },

    listPeriodSummariesByUser: async (userId) => {
      const result = await db.query<ExpensePeriodRow>(
        `
          SELECT *
          FROM expense_periods
          WHERE user_id = $1
          ORDER BY year DESC, month DESC
        `,
        [userId],
      );

      return result.rows.map((row) => {
        const period = toPeriodDomain(row);
        return {
          id: period.id,
          userId: period.userId,
          year: period.year,
          month: period.month,
          label: `${period.year}-${String(period.month).padStart(2, '0')}`,
          createdAt: period.createdAt,
          updatedAt: period.updatedAt,
        };
      });
    },

    findPeriodByUserAndMonth: async ({ userId, year, month }) => {
      const result = await db.query<ExpensePeriodRow>(
        `
          SELECT *
          FROM expense_periods
          WHERE user_id = $1 AND year = $2 AND month = $3
          LIMIT 1
        `,
        [userId, year, month],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toPeriodDomain(result.rows[0]);
    },

    findPeriodByIdForUser,

    createPeriodWithSeedRows: async (input) => {
      const insertSeedRows = async (
        queryClient: DbQueryClient,
        period: ExpensePeriodRecord,
      ): Promise<void> => {
        for (const [index, seedRow] of input.seedRows.entries()) {
          const cells: ExpenseCells = {
            expense: seedRow.expense,
          };

          if (seedRow.amount !== undefined) {
            cells.amount = seedRow.amount;
          }

          if (seedRow.comment !== undefined) {
            cells.comment = seedRow.comment;
          }

          await queryClient.query(
            `
              INSERT INTO expense_rows (
                id,
                period_id,
                user_id,
                position,
                cells,
                created_at,
                updated_at
              )
              VALUES (
                gen_random_uuid()::text,
                $1,
                $2,
                $3,
                $4::jsonb,
                NOW(),
                NOW()
              )
            `,
            [period.id, input.userId, index, JSON.stringify(cells)],
          );
        }
      };

      const insertPeriod = async (queryClient: DbQueryClient): Promise<ExpensePeriodRecord> => {
        const periodResult = await queryClient.query<ExpensePeriodRow>(
          `
            INSERT INTO expense_periods (
              id,
              user_id,
              year,
              month,
              schema,
              created_at,
              updated_at
            )
            VALUES (
              gen_random_uuid()::text,
              $1,
              $2,
              $3,
              $4::jsonb,
              NOW(),
              NOW()
            )
            RETURNING *
          `,
          [input.userId, input.year, input.month, JSON.stringify(input.schema)],
        );

        return toPeriodDomain(periodResult.rows[0]);
      };

      if (db !== pool) {
        const period = await insertPeriod(db);
        await insertSeedRows(db, period);
        return period;
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const period = await insertPeriod(client);
        await insertSeedRows(client, period);
        await client.query('COMMIT');
        return period;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    updatePeriodSchema: async ({ periodId, userId, schema }) => {
      const result = await db.query<ExpensePeriodRow>(
        `
          UPDATE expense_periods
          SET schema = $1::jsonb, updated_at = NOW()
          WHERE id = $2 AND user_id = $3
          RETURNING *
        `,
        [JSON.stringify(schema), periodId, userId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toPeriodDomain(result.rows[0]);
    },

    listRowsByPeriod: async ({ periodId, userId }) => {
      const result = await db.query<ExpenseRowDbRow>(
        `
          SELECT *
          FROM expense_rows
          WHERE period_id = $1 AND user_id = $2 AND deleted_at IS NULL
          ORDER BY position ASC
        `,
        [periodId, userId],
      );

      return result.rows.map(toRowDomain);
    },

    listTrashRowsByPeriod: async ({ periodId, userId }) => {
      const result = await db.query<ExpenseRowDbRow>(
        `
          SELECT *
          FROM expense_rows
          WHERE period_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
          ORDER BY deleted_at DESC
        `,
        [periodId, userId],
      );

      return result.rows.map(toRowDomain);
    },

    countActiveRowsByPeriod: async ({ periodId, userId }) => {
      const result = await db.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM expense_rows
          WHERE period_id = $1 AND user_id = $2 AND deleted_at IS NULL
        `,
        [periodId, userId],
      );

      return Number(result.rows[0]?.count ?? 0);
    },

    createRow: async (input) => {
      const result = await db.query<ExpenseRowDbRow>(
        `
          INSERT INTO expense_rows (
            id,
            period_id,
            user_id,
            position,
            cells,
            created_at,
            updated_at
          )
          VALUES (
            gen_random_uuid()::text,
            $1,
            $2,
            $3,
            $4::jsonb,
            NOW(),
            NOW()
          )
          RETURNING *
        `,
        [input.periodId, input.userId, input.position, JSON.stringify(input.cells)],
      );

      return toRowDomain(result.rows[0]);
    },

    findRowByIdForUser,

    patchRow: async ({ rowId, userId, patch }) => {
      const columns = toPatchColumns(patch);
      if (columns.length === 0) {
        return await findRowByIdForUser({ rowId, userId });
      }

      const setClause = columns
        .map((entry, index) => {
          if (entry.column === 'cells') {
            return `${entry.column} = $${index + 1}::jsonb`;
          }

          return `${entry.column} = $${index + 1}`;
        })
        .join(', ');
      const values = columns.map((entry) => entry.value);
      values.push(rowId, userId);

      const result = await db.query<ExpenseRowDbRow>(
        `
          UPDATE expense_rows
          SET ${setClause}
          WHERE id = $${columns.length + 1} AND user_id = $${columns.length + 2}
          RETURNING *
        `,
        values,
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toRowDomain(result.rows[0]);
    },
  };
};