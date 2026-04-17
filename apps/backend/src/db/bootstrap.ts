import pg from 'pg';

const { Pool } = pg;

type QueryResult = {
  rows: Array<{ version?: string }>;
};

type BootstrapClient = {
  query: (text: string, values?: readonly unknown[]) => Promise<QueryResult>;
  release: () => void;
};

type BootstrapPool = {
  connect: () => Promise<BootstrapClient>;
  end: () => Promise<void>;
};

type BootstrapOptions = {
  createPool?: (connectionString: string) => BootstrapPool;
};

function getDatabaseName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return url.pathname.replace(/^\//, '') || 'postgres';
}

function getMaintenanceConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function ensureDatabaseExists(
  databaseUrl: string,
  options: BootstrapOptions = {},
): Promise<void> {
  const createPool =
    options.createPool ??
    ((connectionString: string) =>
      new Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 2000,
      }));

  const databaseName = getDatabaseName(databaseUrl);
  const maintenancePool = createPool(getMaintenanceConnectionString(databaseUrl));
  const client = await maintenancePool.connect();

  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);

    if (rows.length > 0) {
      return;
    }

    await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    console.log(`[migrate] Created missing database: ${databaseName}`);
  } finally {
    client.release();
    await maintenancePool.end();
  }
}
