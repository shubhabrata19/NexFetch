import type { SqliteDatabase, SqliteLogger } from './sqlite-database'

export const SCHEMA_VERSION = 1

const SCHEMA_V1 = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    engine_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    destination TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    scheduled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    downloaded_bytes INTEGER,
    total_bytes INTEGER,
    percent REAL,
    bytes_per_second INTEGER,
    eta_seconds INTEGER,
    error_code TEXT,
    payload TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS jobs_status_created
    ON jobs (status, created_at);
  CREATE INDEX IF NOT EXISTS jobs_created
    ON jobs (created_at DESC);
  CREATE INDEX IF NOT EXISTS jobs_scheduled
    ON jobs (scheduled_at)
    WHERE scheduled_at IS NOT NULL;

  CREATE TABLE IF NOT EXISTS job_attempts (
    job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    PRIMARY KEY (job_id, attempt),
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

export function migrateDatabase(database: SqliteDatabase, logger?: SqliteLogger): void {
  const currentVersion = database.userVersion
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `The database schema version ${currentVersion} is newer than this application supports.`,
    )
  }
  if (currentVersion === SCHEMA_VERSION) return

  if (currentVersion > 0 && database.filePath !== ':memory:') {
    const backupPath = `${database.filePath}.backup-v${currentVersion}-${Date.now()}`
    try {
      database.backupTo(backupPath)
      logger?.info('sqlite_backup_created', { backupPath, fromVersion: currentVersion })
    } catch (error) {
      logger?.warn('sqlite_backup_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  database.transaction(() => {
    if (currentVersion < 1) {
      database.exec(SCHEMA_V1)
    }
    database.setUserVersion(SCHEMA_VERSION)
  })

  logger?.info('sqlite_schema_migrated', {
    fromVersion: currentVersion,
    toVersion: SCHEMA_VERSION,
  })
}
