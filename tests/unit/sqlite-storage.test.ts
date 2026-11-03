import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersistedJobRecord } from '@main/download/job-repository'
import { SettingsService } from '@main/services/settings-service'
import { migrateJsonJobs } from '@main/storage/json-migration'
import { migrateDatabase, SCHEMA_VERSION } from '@main/storage/migrations'
import { SqliteDatabase } from '@main/storage/sqlite-database'
import { SqliteJobRepository } from '@main/storage/sqlite-job-repository'
import { SqliteSettingsRepository } from '@main/storage/settings-repository'

const temporaryDirectories: string[] = []

function createFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nexfetch-storage-'))
  temporaryDirectories.push(directory)
  return directory
}

function openDatabase(directory: string): SqliteDatabase {
  const database = new SqliteDatabase({ filePath: join(directory, 'nexfetch.sqlite') })
  database.open()
  migrateDatabase(database)
  return database
}

function createJob(overrides: Partial<PersistedJobRecord> = {}): PersistedJobRecord {
  const now = new Date().toISOString()
  return {
    id: 'job-1',
    revision: 1,
    engineId: 'youtube',
    source: {
      kind: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    },
    title: 'Example video',
    status: 'completed',
    progress: {
      downloadedBytes: 100,
      totalBytes: 100,
      percent: 100,
      bytesPerSecond: null,
      etaSeconds: null,
    },
    destination: 'C:\\downloads',
    output: null,
    details: null,
    error: null,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
    scheduledAt: null,
    selection: null,
    workspaceDirectory: null,
    ...overrides,
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite storage', () => {
  it('creates the schema, uses WAL, and persists across reopen', () => {
    const directory = createFixture()
    const database = openDatabase(directory)

    expect(database.userVersion).toBe(SCHEMA_VERSION)
    const journal = database.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown }
    expect(journal.journal_mode).toBe('wal')

    const jobs = new SqliteJobRepository(database)
    jobs.save(createJob())
    database.close()

    const reopened = openDatabase(directory)
    expect(reopened.userVersion).toBe(SCHEMA_VERSION)
    expect(new SqliteJobRepository(reopened).get('job-1')?.title).toBe('Example video')
    reopened.close()
  })

  it('saves, lists, updates, and removes jobs', () => {
    const directory = createFixture()
    const database = openDatabase(directory)
    const repository = new SqliteJobRepository(database)

    repository.save(createJob())
    repository.save(
      createJob({ id: 'job-2', title: 'Second', createdAt: '2026-01-01T00:00:00.000Z' }),
    )
    expect(repository.list()).toHaveLength(2)

    repository.save(createJob({ title: 'Updated', status: 'failed' }))
    expect(repository.get('job-1')?.title).toBe('Updated')
    expect(repository.get('job-1')?.status).toBe('failed')

    const attempts = database
      .prepare('SELECT status FROM job_attempts WHERE job_id = ?')
      .all('job-1') as Array<{ status?: unknown }>
    expect(attempts.map((row) => row.status)).toContain('failed')

    repository.remove('job-1')
    expect(repository.get('job-1')).toBeNull()
    database.close()
  })

  it('imports legacy JSON jobs once and preserves the source file', () => {
    const directory = createFixture()
    const database = openDatabase(directory)
    const repository = new SqliteJobRepository(database)
    const jobsFile = join(directory, 'jobs.json')
    writeFileSync(jobsFile, JSON.stringify([createJob(), { invalid: true }]), 'utf8')

    const result = migrateJsonJobs({ database, repository, jobsFilePath: jobsFile })
    expect(result).toMatchObject({ imported: 1, skipped: 1, alreadyMigrated: false })
    expect(repository.get('job-1')?.title).toBe('Example video')
    expect(existsSync(jobsFile)).toBe(false)
    expect(readdirSync(directory).some((name) => name.startsWith('jobs.json.migrated-'))).toBe(true)

    const second = migrateJsonJobs({ database, repository, jobsFilePath: jobsFile })
    expect(second.alreadyMigrated).toBe(true)
    expect(repository.list()).toHaveLength(1)
    database.close()
  })

  it('preserves a corrupt legacy jobs file without crashing startup', () => {
    const directory = createFixture()
    const database = openDatabase(directory)
    const repository = new SqliteJobRepository(database)
    const jobsFile = join(directory, 'jobs.json')
    writeFileSync(jobsFile, '{not json', 'utf8')

    const result = migrateJsonJobs({ database, repository, jobsFilePath: jobsFile })
    expect(result.imported).toBe(0)
    expect(repository.list()).toHaveLength(0)
    expect(readdirSync(directory).some((name) => name.startsWith('jobs.json.corrupt-'))).toBe(true)
    database.close()
  })

  it('stores settings in SQLite and migrates a legacy JSON file', () => {
    const directory = createFixture()
    const database = openDatabase(directory)
    const legacySettings = join(directory, 'settings.json')
    const downloadDirectory = join(directory, 'downloads')
    writeFileSync(
      legacySettings,
      JSON.stringify({
        downloadDirectory,
        maxConcurrentDownloads: 3,
        theme: 'dark',
      }),
      'utf8',
    )

    const settings = new SettingsService({
      repository: new SqliteSettingsRepository(database),
      defaultDownloadDirectory: downloadDirectory,
      legacyFilePath: legacySettings,
    })

    expect(settings.get()).toMatchObject({
      downloadDirectory,
      maxConcurrentDownloads: 3,
      concurrentFragments: 4,
      maxDownloadRateBytesPerSecond: 0,
      theme: 'dark',
    })
    expect(existsSync(legacySettings)).toBe(false)
    expect(readdirSync(directory).some((name) => name.startsWith('settings.json.migrated-'))).toBe(
      true,
    )

    settings.update({ theme: 'light' })
    const reloaded = new SettingsService({
      repository: new SqliteSettingsRepository(database),
      defaultDownloadDirectory: downloadDirectory,
    })
    expect(reloaded.get().theme).toBe('light')
    database.close()
  })

  it('writes a valid JSON settings file when using the legacy repository', () => {
    const directory = createFixture()
    const settingsFile = join(directory, 'settings.json')
    const downloadDirectory = join(directory, 'downloads')
    const settings = new SettingsService({
      filePath: settingsFile,
      defaultDownloadDirectory: downloadDirectory,
    })

    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual(settings.get())
  })
})
