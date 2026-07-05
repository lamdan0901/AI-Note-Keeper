-- Supports the notes trash purge scan/delete, which filters on soft-deleted
-- (trashed) notes past the retention window. All other note indexes are partial
-- on `active = true AND deleted_at IS NULL`, so without this the purge seq-scans.
CREATE INDEX IF NOT EXISTS idx_notes_trash_purge
  ON notes (deleted_at)
  WHERE active = false AND deleted_at IS NOT NULL;
