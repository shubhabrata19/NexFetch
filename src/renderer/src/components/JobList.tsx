import type { DownloadJob, JobStatus } from '@shared/domain/job'
import { Icon } from './Icon'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'

interface JobListProps {
  jobs: DownloadJob[]
  emptyTitle: string
  emptyMessage: string
  emptyIcon: 'download' | 'history'
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRemove: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
}

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Queued',
  resolving: 'Preparing',
  downloading: 'Downloading',
  processing: 'Merging',
  verifying: 'Verifying',
  paused: 'Paused',
  seeding: 'Seeding',
  cancelling: 'Cancelling',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function statusTone(status: JobStatus): string {
  if (status === 'completed') return 'badge--success'
  if (status === 'failed') return 'badge--danger'
  if (status === 'cancelled') return 'badge--neutral'
  if (status === 'cancelling') return 'badge--warning'
  return 'badge--accent'
}

function isProgressStatus(status: JobStatus): boolean {
  return status === 'downloading' || status === 'processing' || status === 'verifying'
}

function jobDetailLine(job: DownloadJob): string | null {
  if (job.details?.engineId !== 'youtube') return null
  const parts = [
    job.details.selectedVideo?.label,
    job.details.selectedAudio?.label ? `Audio ${job.details.selectedAudio.label}` : null,
    job.details.container ? job.details.container.toUpperCase() : null,
  ].filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join(' · ') : null
}

function jobSize(job: DownloadJob): string {
  if (job.output?.files[0]?.bytes != null) return formatBytes(job.output.files[0].bytes)
  if (job.progress.totalBytes !== null) return formatBytes(job.progress.totalBytes)
  return 'Size unknown'
}

export function JobRow({
  job,
  compact = false,
  onCancel,
  onRetry,
  onRemove,
  onOpenLocation,
}: {
  job: DownloadJob
  compact?: boolean
  onCancel: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRemove: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
}) {
  const terminal = isTerminal(job.status)
  const detail = jobDetailLine(job)
  const percent = job.progress.percent
  const showProgress = isProgressStatus(job.status)

  const handleRemove = (): void => {
    if (
      window.confirm(`Remove "${job.title}" from history? Downloaded files will not be deleted.`)
    ) {
      onRemove(job.id)
    }
  }

  return (
    <article
      className={`job-row${compact ? ' job-row--compact' : ''}`}
      aria-label={`${job.title}, ${STATUS_LABELS[job.status]}`}
    >
      <div className="job-main">
        <div className="job-title-line">
          <span className={`badge job-status ${statusTone(job.status)}`}>
            {STATUS_LABELS[job.status]}
          </span>
          <span className="job-engine">YouTube</span>
          {detail ? <span className="job-detail">{detail}</span> : null}
        </div>
        <h3 className="job-title" title={job.title}>
          {job.title}
        </h3>

        {showProgress ? (
          <div
            className={`progress-track${percent === null ? ' progress-track--indeterminate' : ''}`}
            role="progressbar"
            aria-label={`Download progress for ${job.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <span
              className="progress-fill"
              style={percent !== null ? { width: `${percent}%` } : undefined}
            />
          </div>
        ) : null}

        <div className="job-meta">
          {job.status === 'completed' ? (
            <span>{jobSize(job)}</span>
          ) : job.status === 'failed' || job.status === 'cancelled' ? (
            <span>{jobSize(job)}</span>
          ) : (
            <>
              <span>
                {formatBytes(job.progress.downloadedBytes)} / {formatBytes(job.progress.totalBytes)}
              </span>
              <span>{formatSpeed(job.progress.bytesPerSecond)}</span>
              <span>ETA {formatEta(job.progress.etaSeconds)}</span>
            </>
          )}
          {job.output?.files[0] ? (
            <span className="job-output" title={job.output.files[0].path}>
              {job.output.files[0].path.split(/[\\/]/).pop()}
            </span>
          ) : null}
        </div>

        {job.error ? (
          <p className="job-error" role="alert">
            {job.error.message}
            <span className="job-diagnostic"> · {job.error.diagnosticId.slice(0, 8)}</span>
          </p>
        ) : null}
      </div>

      <div className="job-actions">
        {!terminal && job.status !== 'cancelling' ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => onCancel(job.id)}
          >
            Cancel
          </button>
        ) : null}

        {job.status === 'failed' || job.status === 'cancelled' ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => onRetry(job.id)}
          >
            <Icon name="refresh" size={15} />
            Retry
          </button>
        ) : null}

        {job.status === 'completed' && job.output ? (
          <>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => onOpenLocation(job.id, false)}
            >
              <Icon name="folder" size={15} />
              Open folder
            </button>
            {job.output.files[0] && !compact ? (
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => onOpenLocation(job.id, true)}
              >
                Show file
              </button>
            ) : null}
          </>
        ) : null}

        {terminal && !compact ? (
          <button
            type="button"
            className="button button--ghost button--small job-remove"
            onClick={handleRemove}
          >
            Remove
          </button>
        ) : null}
      </div>
    </article>
  )
}

export function JobList({
  jobs,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  onCancel,
  onRetry,
  onRemove,
  onOpenLocation,
}: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div className="card job-empty">
        <div className="empty-icon empty-icon--small">
          <Icon name={emptyIcon} size={24} />
        </div>
        <h3>{emptyTitle}</h3>
        <p>{emptyMessage}</p>
      </div>
    )
  }

  const sorted = [...jobs].sort((a, b) => {
    const aTerminal = isTerminal(a.status)
    const bTerminal = isTerminal(b.status)
    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1
    return b.createdAt.localeCompare(a.createdAt)
  })

  return (
    <div className="job-list" role="list">
      {sorted.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          onCancel={onCancel}
          onRetry={onRetry}
          onRemove={onRemove}
          onOpenLocation={onOpenLocation}
        />
      ))}
    </div>
  )
}
