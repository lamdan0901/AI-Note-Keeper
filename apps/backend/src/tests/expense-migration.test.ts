import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationFileName = '00010_expense_notes.sql';

const resolveMigrationPath = async (fileName: string): Promise<string> => {
  const localWorkspacePath = path.join(process.cwd(), 'src', 'db', 'migrations', fileName);
  try {
    await fs.access(localWorkspacePath);
    return localWorkspacePath;
  } catch {
    const monorepoRootPath = path.join(
      process.cwd(),
      'apps',
      'backend',
      'src',
      'db',
      'migrations',
      fileName,
    );
    await fs.access(monorepoRootPath);
    return monorepoRootPath;
  }
};

test('expense notes migration creates settings, periods, and rows tables', async () => {
  const migrationPath = await resolveMigrationPath(migrationFileName);
  const sql = await fs.readFile(migrationPath, 'utf-8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS expense_user_settings/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS expense_periods/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS expense_rows/i);
  assert.match(sql, /UNIQUE \(user_id, year, month\)/i);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_expense_rows_period\s+ON expense_rows \(period_id, position\)\s+WHERE deleted_at IS NULL;/i,
  );
});