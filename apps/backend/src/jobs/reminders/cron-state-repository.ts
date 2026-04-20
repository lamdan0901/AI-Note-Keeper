import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type { CronStateRepository } from './contracts.js';

type CronStateRow = Readonly<{
  last_checked_at: Date;
}>;

export const createCronStateRepository = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): CronStateRepository => {
  const db = deps.db ?? pool;

  return {
    getLastCheckedAt: async (key) => {
      const result = await db.query<CronStateRow>(
        `
          SELECT last_checked_at
          FROM cron_state
          WHERE key = $1
          LIMIT 1
        `,
        [key],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0].last_checked_at;
    },

    upsertLastCheckedAt: async ({ key, lastCheckedAt }) => {
      await db.query(
        `
          INSERT INTO cron_state (key, last_checked_at)
          VALUES ($1, $2)
          ON CONFLICT (key)
          DO UPDATE SET last_checked_at = EXCLUDED.last_checked_at
        `,
        [key, lastCheckedAt],
      );
    },
  };
};
