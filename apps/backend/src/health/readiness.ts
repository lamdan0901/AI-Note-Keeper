export type QueryClient = Readonly<{
  query: (text: string, values?: ReadonlyArray<unknown>) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}>;

export type ReadinessStatus = Readonly<{
  ok: boolean;
  service: 'backend';
  checks: Readonly<{
    database: 'up' | 'down';
    migrations: 'up' | 'down';
  }>;
}>;

export type ReadinessInput = Readonly<{
  queryClient: QueryClient;
  dependencyDegraded: boolean;
}>;

const MIGRATION_TABLE_CHECK = `
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'schema_migrations'
  ) AS present;
`;

const createStatus = (database: 'up' | 'down', migrations: 'up' | 'down'): ReadinessStatus => {
  const ok = database === 'up' && migrations === 'up';

  return {
    ok,
    service: 'backend',
    checks: {
      database,
      migrations,
    },
  };
};

const readMigrationPresence = (row: Record<string, unknown> | undefined): boolean => {
  if (!row) {
    return false;
  }

  const value = row.present;
  return value === true;
};

export const evaluateReadiness = async (input: ReadinessInput): Promise<ReadinessStatus> => {
  if (input.dependencyDegraded) {
    return createStatus('down', 'down');
  }

  try {
    await input.queryClient.query('SELECT 1;');
    const migrationCheck = await input.queryClient.query(MIGRATION_TABLE_CHECK);

    if (!readMigrationPresence(migrationCheck.rows[0])) {
      return createStatus('up', 'down');
    }

    return createStatus('up', 'up');
  } catch {
    return createStatus('down', 'down');
  }
};