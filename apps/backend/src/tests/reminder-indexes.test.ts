import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationFileName = '00009_core_indexes.sql';

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

test('core indexes migration includes reminder lookup indexes', async () => {
  const coreIndexesMigration = await resolveMigrationPath(migrationFileName);
  const sql = await fs.readFile(coreIndexesMigration, 'utf-8');

  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_notes_active_next_trigger_at\s+ON notes \(next_trigger_at\)\s+WHERE active = true AND deleted_at IS NULL AND next_trigger_at IS NOT NULL;/i,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_notes_active_snoozed_until\s+ON notes \(snoozed_until\)\s+WHERE active = true AND deleted_at IS NULL AND snoozed_until IS NOT NULL;/i,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_notes_active_trigger_at\s+ON notes \(trigger_at\)\s+WHERE active = true AND deleted_at IS NULL AND trigger_at IS NOT NULL;/i,
  );
});

test('phase P0-07 core index categories are covered (sync, dedupe, token lookup)', async () => {
  const notesSql = await fs.readFile(await resolveMigrationPath('00002_notes.sql'), 'utf-8');
  const eventsSql = await fs.readFile(
    await resolveMigrationPath('00005_note_change_events.sql'),
    'utf-8',
  );
  const deviceTokensSql = await fs.readFile(
    await resolveMigrationPath('00004_device_push_tokens.sql'),
    'utf-8',
  );
  const refreshTokensSql = await fs.readFile(
    await resolveMigrationPath('00008_refresh_tokens.sql'),
    'utf-8',
  );

  assert.match(notesSql, /idx_notes_user_id/i);
  assert.match(notesSql, /idx_notes_updated_at/i);
  assert.match(eventsSql, /idx_note_change_events_dedupe/i);
  assert.match(deviceTokensSql, /idx_device_push_tokens_device_id/i);
  assert.match(refreshTokensSql, /idx_refresh_tokens_token_hash/i);
});
