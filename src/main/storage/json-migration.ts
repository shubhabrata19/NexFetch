import { existsSync, readFileSync, renameSync } from 'node:fs'
import type { SqliteJobRepository } from './sqlite-job-repository'
import type { SqliteDatabase, SqliteLogger } from './sqlite-database'
import { normalizePersistedJobRecord } from './job-record'

const JOBS_MIGRATION_KEY = 'json_jobs_migrated_at'

function getMeta(database: SqliteDatabase, key: string): string | null {
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    { value?: unknown } | undefined
  return typeof row?.value === 'string' ? row.value : null
}

function setMeta(database: SqliteDatabase, key: string, value: string): void {
  database
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}

function preserveFile(filePath: string, suffix: string, logger?: SqliteLogger): void {
  try {
    renameSync(filePath, `${filePath}.${suffix}-${Date.now()}`)
  } catch (error) {
    logger?.warn('json_migration_preserve_failed', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface JsonJobMigrationResult {
  imported: number
  skipped: number
  alreadyMigrated: boolean
}

/**
 * Imports jobs from the pre-SQLite JSON store exactly once. Invalid rows are
 * skipped individually; a malformed file is preserved rather than deleted.
 */
export function migrateJsonJobs(options: {
  database: SqliteDatabase
  repository: SqliteJobRepository
  jobsFilePath: string
  logger?: SqliteLogger
}): JsonJobMigrationResult {
  const { database, repository, jobsFilePath, logger } = options

  if (getMeta(database, JOBS_MIGRATION_KEY)) {
    return { imported: 0, skipped: 0, alreadyMigrated: true }
  }

  if (!existsSync(jobsFilePath)) {
    setMeta(database, JOBS_MIGRATION_KEY, new Date().toISOString())
    return { imported: 0, skipped: 0, alreadyMigrated: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(jobsFilePath, 'utf8'))
  } catch (error) {
    logger?.warn('json_jobs_migration_invalid_json', {
      error: error instanceof Error ? error.message : String(error),
    })
    preserveFile(jobsFilePath, 'corrupt', logger)
    setMeta(database, JOBS_MIGRATION_KEY, new Date().toISOString())
    return { imported: 0, skipped: 0, alreadyMigrated: false }
  }

  if (!Array.isArray(parsed)) {
    logger?.warn('json_jobs_migration_invalid_shape')
    preserveFile(jobsFilePath, 'corrupt', logger)
    setMeta(database, JOBS_MIGRATION_KEY, new Date().toISOString())
    return { imported: 0, skipped: 0, alreadyMigrated: false }
  }

  let imported = 0
  let skipped = 0
  database.transaction(() => {
    for (const entry of parsed) {
      const record = normalizePersistedJobRecord(entry)
      if (!record) {
        skipped += 1
        continue
      }
      if (repository.importIfAbsent(record)) {
        imported += 1
      }
    }
    setMeta(database, JOBS_MIGRATION_KEY, new Date().toISOString())
  })

  preserveFile(jobsFilePath, 'migrated', logger)
  logger?.info('json_jobs_migrated', { imported, skipped })
  return { imported, skipped, alreadyMigrated: false }
}
