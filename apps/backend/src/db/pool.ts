import pg from 'pg';

import type { DbQueryClient, DbQueryResult } from '../auth/contracts.js';
import { config } from '../config.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

const resolveConnectionTimeoutMillis = (): number => {
  const configured = process.env.DB_CONNECTION_TIMEOUT_MS;
  if (configured) {
    const parsed = Number(configured);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return process.env.VERCEL === '1' ? 10_000 : 2_000;
};

const createPool = (): pg.Pool => {
  const nextPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: resolveConnectionTimeoutMillis(),
  });

  nextPool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  return nextPool;
};

const getPool = (): pg.Pool => {
  if (poolInstance !== null) {
    return poolInstance;
  }

  poolInstance = createPool();
  return poolInstance;
};

type PoolFacade = DbQueryClient &
  Pick<pg.Pool, 'connect' | 'end' | 'on' | 'removeAllListeners'>;

export const pool: PoolFacade = {
  query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ): Promise<DbQueryResult<Row>> => {
    const result = await getPool().query<Row>(text, values as unknown[] | undefined);
    return {
      rows: result.rows,
    };
  },
  connect: () => getPool().connect(),
  end: async () => {
    if (poolInstance === null) {
      return;
    }

    const activePool = poolInstance;
    poolInstance = null;
    await activePool.end();
  },
  on: ((event: 'error', listener: (err: Error) => void) => {
    getPool().on(event, listener);
    return pool;
  }) as PoolFacade['on'],
  removeAllListeners: ((event?: string | symbol) => {
    getPool().removeAllListeners(event);
    return pool;
  }) as PoolFacade['removeAllListeners'],
};
