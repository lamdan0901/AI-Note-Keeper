import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { ensureDatabaseExists } from './db/bootstrap.js';

const migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');

async function runMigrations() {
  const client = await pool.connect();

  try {
    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure migrations directory exists
    try {
      await fs.access(migrationsDir);
    } catch {
      console.log(`[migrate] No migrations directory found at ${migrationsDir}`);
      return;
    }

    // Read all migration files
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b)); // Sort alphabetically to run in order

    if (sqlFiles.length === 0) {
      console.log('[migrate] No migration files found.');
      return;
    }

    // Get applied migrations
    const { rows: appliedRows } = await client.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(appliedRows.map((row) => row.version));

    let appliedCount = 0;

    for (const file of sqlFiles) {
      if (appliedVersions.has(file)) {
        continue; // Already applied
      }

      console.log(`[migrate] Applying migration: ${file}...`);

      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf-8');

      // Execute each migration inside a transaction
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');

        console.log(`[migrate] Successfully applied: ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] Error applying migration ${file}: `);
        console.error(err);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log('[migrate] Database is up to date.');
    } else {
      console.log(`[migrate] Successfully applied ${appliedCount} migration(s).`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await ensureDatabaseExists(config.DATABASE_URL);
    await runMigrations();
  } catch (err) {
    console.error('[migrate] Migration runner failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
