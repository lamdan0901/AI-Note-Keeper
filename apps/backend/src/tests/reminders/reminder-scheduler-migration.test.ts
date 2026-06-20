import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('reminder scheduler migration adds scheduler metadata and delivery uniqueness', () => {
  const sql = readFileSync(
    new URL('../../db/migrations/00011_reminder_scheduler.sql', import.meta.url),
    'utf-8',
  );

  assert.match(sql, /ALTER TABLE notes/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS schedule_provider TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS schedule_target_id TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS schedule_target_version INTEGER/i);
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS schedule_target_fire_at TIMESTAMP WITH TIME ZONE/i,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_notes_reminder_next_fire\s+ON notes \(next_trigger_at\)\s+WHERE trigger_at IS NOT NULL\s+AND active = true\s+AND deleted_at IS NULL;/i,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_notes_reminder_scheduler_missing\s+ON notes \(next_trigger_at, schedule_target_id\)\s+WHERE trigger_at IS NOT NULL\s+AND active = true\s+AND deleted_at IS NULL;/i,
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS reminder_deliveries/i);
  assert.match(sql, /UNIQUE \(reminder_id, occurrence_at\)/i);
  assert.match(sql, /UNIQUE \(delivery_key\)/i);
});
