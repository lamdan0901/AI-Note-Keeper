import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'node:url';

import { config } from './config.js';
import { ensureDatabaseExists } from './db/bootstrap.js';
import { pool } from './db/pool.js';

export const migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');

type MigrationClient = Readonly<{
  query: (text: string, values?: ReadonlyArray<unknown>) => Promise<{ rows: ReadonlyArray<{ version?: string }> }>;
  release: () => void;
}>;

type MigrationPool = Readonly<{
  connect: () => Promise<MigrationClient>;
  end: () => Promise<void>;
}>;

type FsLike = Readonly<{
  access: (target: string) => Promise<void>;
  readdir: (target: string) => Promise<ReadonlyArray<string>>;
  readFile: (target: string, encoding: BufferEncoding) => Promise<string>;
}>;

type Logger = Readonly<{
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}>;

export type RunMigrationsOptions = Readonly<{
  migrationPool?: MigrationPool;
  fileSystem?: FsLike;
  logger?: Logger;
  migrationsPath?: string;
}>;

export type MigrationRunResult = Readonly<{
  appliedCount: number;
  appliedVersions: ReadonlyArray<string>;
}>;

export type RunMigrationCommandOptions = Readonly<{
  databaseUrl?: string;
  migrationPool?: MigrationPool;
  runMigrationsFn?: () => Promise<MigrationRunResult>;
  ensureDatabaseExistsFn?: (databaseUrl: string) => Promise<void>;
  logger?: Logger;
}>;

const defaultLogger: Logger = {
  info: (message) => {
    console.log(message);
  },
  error: (message, error) => {
    console.error(message, error);
  },
};

const isMainModule = (): boolean => {
  const executedPath = process.argv[1];

  if (!executedPath) {
    return false;
  }

  return pathToFileURL(executedPath).href === import.meta.url;
};

const readSortedSqlFiles = async (fileSystem: FsLike, folderPath: string): Promise<ReadonlyArray<string>> => {
  const files = await fileSystem.readdir(folderPath);
  return files
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
};

export const runMigrations = async (options: RunMigrationsOptions = {}): Promise<MigrationRunResult> => {
  const migrationPool = options.migrationPool ?? pool;
  const fileSystem = options.fileSystem ?? fs;
  const logger = options.logger ?? defaultLogger;
  const folderPath = options.migrationsPath ?? migrationsDir;

  const client = await migrationPool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await fileSystem.access(folderPath);
    } catch {
      logger.info(`[migrate] No migrations directory found at ${folderPath}`);
      return {
        appliedCount: 0,
        appliedVersions: [],
      };
    }

    const sqlFiles = await readSortedSqlFiles(fileSystem, folderPath);

    if (sqlFiles.length === 0) {
      logger.info('[migrate] No migration files found.');
      return {
        appliedCount: 0,
        appliedVersions: [],
      };
    }

    const { rows: appliedRows } = await client.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(
      appliedRows
        .map((row) => row.version)
        .filter((version): version is string => typeof version === 'string' && version.length > 0),
    );

    const newlyAppliedVersions: Array<string> = [];

    for (const fileName of sqlFiles) {
      if (appliedVersions.has(fileName)) {
        continue;
      }

      logger.info(`[migrate] Applying migration: ${fileName}...`);

      const filePath = path.join(folderPath, fileName);
      const sql = await fileSystem.readFile(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [fileName]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`[migrate] Error applying migration ${fileName}:`, error);
        throw error;
      }

      logger.info(`[migrate] Successfully applied: ${fileName}`);
      newlyAppliedVersions.push(fileName);
    }

    if (newlyAppliedVersions.length === 0) {
      logger.info('[migrate] Database is up to date.');
    } else {
      logger.info(`[migrate] Successfully applied ${newlyAppliedVersions.length} migration(s).`);
    }

    return {
      appliedCount: newlyAppliedVersions.length,
      appliedVersions: newlyAppliedVersions,
    };
  } finally {
    client.release();
  }
};

export const runMigrationCommand = async (
  options: RunMigrationCommandOptions = {},
): Promise<MigrationRunResult> => {
  const migrationPool = options.migrationPool ?? pool;
  const logger = options.logger ?? defaultLogger;
  const ensureDatabase = options.ensureDatabaseExistsFn ?? ensureDatabaseExists;
  const runMigrationsFn = options.runMigrationsFn ?? (() => runMigrations({ migrationPool, logger }));
  const databaseUrl = options.databaseUrl ?? config.DATABASE_URL;

  try {
    await ensureDatabase(databaseUrl);
    return await runMigrationsFn();
  } finally {
    await migrationPool.end();
  }
};

if (isMainModule()) {
  runMigrationCommand().catch((error) => {
    defaultLogger.error('[migrate] Migration runner failed:', error);
    process.exit(1);
  });
}