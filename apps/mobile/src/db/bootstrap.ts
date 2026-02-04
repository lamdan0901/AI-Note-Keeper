import { openDatabaseAsync, SQLiteDatabase } from "expo-sqlite/next";

import { migrations } from "./migrations";

const DB_NAME = "ai-note-keeper.db";

let dbPromise: Promise<SQLiteDatabase> | null = null;

export const getDb = async (): Promise<SQLiteDatabase> => {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
};

export const runMigrations = async (): Promise<void> => {
  const db = await getDb();
  await db.execAsync("PRAGMA foreign_keys = ON;");
  await db.execAsync(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY);",
  );

  const appliedRows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM schema_migrations;",
  );
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    await db.execAsync(migration.sql);
    await db.runAsync("INSERT INTO schema_migrations (id) VALUES (?);", [
      migration.id,
    ]);
  }
};
