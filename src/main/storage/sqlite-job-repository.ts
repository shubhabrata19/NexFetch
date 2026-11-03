import type { StatementSync } from 'node:sqlite'
import type { JobRepository, PersistedJobRecord } from '../download/job-repository'
import { normalizePersistedJobRecord } from './job-record'
import type { SqliteDatabase, SqliteLogger } from './sqlite-database'

function parseRecord(payload: string): PersistedJobRecord | null {
  try {
    return normalizePersistedJobRecord(JSON.parse(payload))
  } catch {
    return null
  }
}

export class SqliteJobRepository implements JobRepository {
  private readonly selectAll: StatementSync
  private readonly selectOne: StatementSync
  private readonly upsert: StatementSync
  private readonly upsertAttempt: StatementSync
  private readonly deleteOne: StatementSync

  constructor(
    private readonly database: SqliteDatabase,
    private readonly logger?: Pick<SqliteLogger, 'warn'>,
  ) {
    this.selectAll = database.prepare('SELECT id, payload FROM jobs ORDER BY created_at DESC')
    this.selectOne = database.prepare('SELECT id, payload FROM jobs WHERE id = ?')
    this.upsert = database.prepare(`
      INSERT INTO jobs (
        id, revision, engine_id, source_kind, title, status, destination, attempt,
        scheduled_at, created_at, updated_at, started_at, completed_at,
        downloaded_bytes, total_bytes, percent, bytes_per_second, eta_seconds,
        error_code, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        revision = excluded.revision,
        engine_id = excluded.engine_id,
        source_kind = excluded.source_kind,
        title = excluded.title,
        status = excluded.status,
        destination = excluded.destination,
        attempt = excluded.attempt,
        scheduled_at = excluded.scheduled_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        downloaded_bytes = excluded.downloaded_bytes,
        total_bytes = excluded.total_bytes,
        percent = excluded.percent,
        bytes_per_second = excluded.bytes_per_second,
        eta_seconds = excluded.eta_seconds,
        error_code = excluded.error_code,
        payload = excluded.payload
    `)
    this.upsertAttempt = database.prepare(`
      INSERT INTO job_attempts (job_id, attempt, status, started_at, completed_at, error_code)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, attempt) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_code = excluded.error_code
    `)
    this.deleteOne = database.prepare('DELETE FROM jobs WHERE id = ?')
  }

  list(): PersistedJobRecord[] {
    const rows = this.selectAll.all() as Array<{ id?: unknown; payload?: unknown }>
    const records: PersistedJobRecord[] = []
    for (const row of rows) {
      const record = typeof row.payload === 'string' ? parseRecord(row.payload) : null
      if (record) {
        records.push(record)
      } else {
        this.logger?.warn('sqlite_job_record_invalid', {
          jobId: typeof row.id === 'string' ? row.id : null,
        })
      }
    }
    return records
  }

  get(id: string): PersistedJobRecord | null {
    const row = this.selectOne.get(id) as { payload?: unknown } | undefined
    if (!row || typeof row.payload !== 'string') return null
    const record = parseRecord(row.payload)
    if (!record) {
      this.logger?.warn('sqlite_job_record_invalid', { jobId: id })
    }
    return record
  }

  save(job: PersistedJobRecord): void {
    this.database.transaction(() => {
      this.upsert.run(
        job.id,
        job.revision,
        job.engineId,
        job.source.kind,
        job.title,
        job.status,
        job.destination,
        job.attempt,
        job.scheduledAt ?? null,
        job.createdAt,
        job.updatedAt,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.progress.downloadedBytes ?? null,
        job.progress.totalBytes ?? null,
        job.progress.percent ?? null,
        job.progress.bytesPerSecond ?? null,
        job.progress.etaSeconds ?? null,
        job.error?.code ?? null,
        JSON.stringify(job),
      )
      this.upsertAttempt.run(
        job.id,
        job.attempt,
        job.status,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.error?.code ?? null,
      )
    })
  }

  importIfAbsent(job: PersistedJobRecord): boolean {
    if (this.get(job.id)) return false
    this.save(job)
    return true
  }

  remove(id: string): void {
    this.deleteOne.run(id)
  }
}
