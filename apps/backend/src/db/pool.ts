import pg from 'pg';

import type { DbQueryClient, DbQueryResult } from '../auth/contracts.js';
import { config } from '../config.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export const isLocalDatabaseHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

export const resolveConnectionTimeoutMillis = (databaseUrl: string = config.DATABASE_URL): number => {
  const configured = process.env.DB_CONNECTION_TIMEOUT_MS;
  if (configured) {
    const parsed = Number(configured);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  if (process.env.VERCEL === '1') {
    return 10_000;
  }

  try {
    const host = new URL(databaseUrl).hostname;
    if (!isLocalDatabaseHost(host)) {
      return 10_000;
    }
  } catch {
    // fall through to local default
  }

  return 2_000;
};

export const isRemoteDatabaseUrl = (databaseUrl: string = config.DATABASE_URL): boolean => {
  try {
    return !isLocalDatabaseHost(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
};

const TRANSIENT_DB_CONNECTION_ERROR_MARKERS = [
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'Client has encountered a connection error',
] as const;

export const isTransientDbConnectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const messages = [error.message];
  if (error.cause instanceof Error) {
    messages.push(error.cause.message);
  }

  return messages.some((message) =>
    TRANSIENT_DB_CONNECTION_ERROR_MARKERS.some((marker) => message.includes(marker)),
  );
};

export const resolveQueryRetryAttempts = (databaseUrl: string = config.DATABASE_URL): number => {
  const configured = process.env.DB_QUERY_RETRY_ATTEMPTS;
  if (configured) {
    const parsed = Number(configured);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }

  return isRemoteDatabaseUrl(databaseUrl) ? 3 : 1;
};

export const resolveQueryRetryDelayMs = (attempt: number): number =>
  Math.min(500 * 2 ** Math.max(0, attempt - 1), 3_000);

export const resolvePoolOptions = (
  databaseUrl: string = config.DATABASE_URL,
): pg.PoolConfig => {
  const remote = isRemoteDatabaseUrl(databaseUrl);

  return {
    connectionString: databaseUrl,
    max: remote ? 10 : 20,
    idleTimeoutMillis: remote ? 10_000 : 30_000,
    connectionTimeoutMillis: resolveConnectionTimeoutMillis(databaseUrl),
    ...(remote
      ? {
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
          maxUses: 750,
        }
      : {}),
  };
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const recycleIdlePoolIfUnused = async (): Promise<void> => {
  const activePool = poolInstance;
  if (activePool === null) {
    return;
  }

  if (activePool.totalCount !== activePool.idleCount || activePool.waitingCount > 0) {
    return;
  }

  poolInstance = null;
  try {
    await activePool.end();
  } catch {
    // Ignore shutdown errors while recycling stale pooled connections.
  }
};

const createPool = (): pg.Pool => {
  const nextPool = new Pool(resolvePoolOptions());

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
    const maxAttempts = resolveQueryRetryAttempts();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await getPool().query<Row>(text, values as unknown[] | undefined);
        return {
          rows: result.rows,
        };
      } catch (error) {
        lastError = error;
        if (!isTransientDbConnectionError(error) || attempt === maxAttempts) {
          throw error;
        }

        await recycleIdlePoolIfUnused();
        await sleep(resolveQueryRetryDelayMs(attempt));
      }
    }

    throw lastError;
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
