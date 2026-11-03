import type { AppError } from '@shared/domain/errors'
import type { DownloadSource, EngineDetails, JobProgress, JobStatus } from '@shared/domain/job'
import type { EngineSelection } from '@shared/domain/engine'
import type { PersistedJobRecord } from '../download/job-repository'

const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'resolving',
  'downloading',
  'processing',
  'verifying',
  'paused',
  'seeding',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && JOB_STATUSES.includes(value as JobStatus)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeProgress(value: unknown): JobProgress {
  if (!isObject(value)) {
    return {
      downloadedBytes: null,
      totalBytes: null,
      percent: null,
      bytesPerSecond: null,
      etaSeconds: null,
    }
  }

  return {
    downloadedBytes: finiteNumber(value.downloadedBytes),
    totalBytes: finiteNumber(value.totalBytes),
    percent: finiteNumber(value.percent),
    bytesPerSecond: finiteNumber(value.bytesPerSecond),
    etaSeconds: finiteNumber(value.etaSeconds),
  }
}

/**
 * Normalizes a persisted job from JSON or SQLite. Older releases may not have
 * every field, so missing optional values are filled without discarding the
 * row. Returns null when the record cannot be identified safely.
 */
export function normalizePersistedJobRecord(value: unknown): PersistedJobRecord | null {
  if (!isObject(value)) return null

  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.engineId !== 'string' ||
    value.engineId.length === 0 ||
    !isObject(value.source) ||
    typeof value.source.kind !== 'string' ||
    typeof value.title !== 'string' ||
    !isJobStatus(value.status) ||
    typeof value.destination !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    revision: finiteNumber(value.revision) ?? 1,
    engineId: value.engineId,
    source: value.source as DownloadSource,
    title: value.title,
    status: value.status,
    progress: normalizeProgress(value.progress),
    destination: value.destination,
    output: isObject(value.output)
      ? (value.output as unknown as PersistedJobRecord['output'])
      : null,
    details: isObject(value.details) ? (value.details as unknown as EngineDetails) : null,
    error: isObject(value.error) ? (value.error as unknown as AppError) : null,
    attempt: finiteNumber(value.attempt) ?? 1,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
    scheduledAt: typeof value.scheduledAt === 'string' ? value.scheduledAt : null,
    selection: isObject(value.selection) ? (value.selection as unknown as EngineSelection) : null,
    workspaceDirectory:
      typeof value.workspaceDirectory === 'string' ? value.workspaceDirectory : null,
  }
}
