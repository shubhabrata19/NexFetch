import { useEffect, useRef, useState } from 'react'
import type { DownloadJob, JobStatus } from '@shared/domain/job'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { isTerminalStatus } from '../lib/jobs'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'

interface JobListProps {
  jobs: DownloadJob[]
  emptyTitle: string
  emptyMessage: string
  emptyIcon: 'download' | 'history'
  pausableEngineIds?: ReadonlySet<string>
  onCancel: (jobId: string) => void
  onPause?: (jobId: string) => void
  onResume?: (jobId: string) => void
  onStopSeeding?: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRemove: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
}

function scheduledLabel(job: DownloadJob): string | null {
  if (!job.scheduledAt) return null
  const date = new Date(job.scheduledAt)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : null
}

const STATUS_LABELS: Record<JobStatus, string> = {
  setup: 'Setup',
  metadata: 'Fetching metadata',
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

function statusTone(status: JobStatus): string {
  if (status === 'completed' || status === 'seeding') return 'badge--success'
  if (status === 'failed') return 'badge--danger'
  if (status === 'cancelled') return 'badge--neutral'
  if (status === 'cancelling') return 'badge--warning'
  return 'badge--accent'
}

function isProgressStatus(status: JobStatus): boolean {
  return (
    status === 'metadata' ||
    status === 'downloading' ||
    status === 'processing' ||
    status === 'verifying'
  )
}

function jobDetailLine(job: DownloadJob): string | null {
  if (job.details?.engineId === 'http') {
    const parts = [
      job.details.contentType,
      job.details.resumable ? 'Resumable' : null,
      job.details.checksum
        ? job.details.checksum.verified === true
          ? 'SHA-256 verified'
          : job.details.checksum.verified === false
            ? 'Checksum failed'
            : 'SHA-256'
        : null,
    ].filter((value): value is string => Boolean(value))
    return parts.length > 0 ? parts.join(' · ') : null
  }

  if (job.details?.engineId === 'torrent') {
    if (job.details.lookup) {
      return [
        `v${job.details.hashVersion}`,
        `${job.details.lookup.peers ?? 0} peers`,
        `${job.details.lookup.dhtNodes ?? '—'} DHT nodes`,
      ].join(' · ')
    }
    return [
      job.details.isPrivate ? 'Private' : 'Public',
      `Seeds ${job.details.seedsConnected ?? '—'} (${job.details.seedsAvailable ?? '—'})`,
      `Peers ${job.details.peersConnected ?? '—'} (${job.details.peersAvailable ?? '—'})`,
    ].join(' · ')
  }

  if (job.details?.engineId !== 'youtube') return null
  const parts = [
    job.details.selectedVideo?.label,
    job.details.selectedAudio?.label ? `Audio ${job.details.selectedAudio.label}` : null,
    job.details.container ? job.details.container.toUpperCase() : null,
  ].filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join(' · ') : null
}

function jobSize(job: DownloadJob): string | null {
  if (job.details?.engineId === 'torrent' && job.progress.totalBytes !== null) {
    return formatBytes(job.progress.totalBytes)
  }
  if (job.output?.files[0]?.bytes != null) return formatBytes(job.output.files[0].bytes)
  if (job.progress.totalBytes !== null) return formatBytes(job.progress.totalBytes)
  return null
}

function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'neutral',
}: {
  icon: IconName
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'stop' | 'danger' | 'confirm'
}) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${tone}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} size={15} />
    </button>
  )
}

function JobActions({
  job,
  compact,
  confirmingClear,
  canPauseResume,
  onCancel,
  onPause,
  onResume,
  onStopSeeding,
  onRetry,
  onOpenLocation,
  onClear,
  onConfirmClear,
  onCancelClear,
}: {
  job: DownloadJob
  compact: boolean
  confirmingClear: boolean
  canPauseResume: boolean
  onCancel: (jobId: string) => void
  onPause?: (jobId: string) => void
  onResume?: (jobId: string) => void
  onStopSeeding?: (jobId: string) => void
  onRetry: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
  onClear: () => void
  onConfirmClear: () => void
  onCancelClear: () => void
}) {
  const terminal = isTerminalStatus(job.status)
  const isTorrent = job.engineId === 'torrent'
  const canPause =
    canPauseResume &&
    (job.status === 'queued' || job.status === 'resolving' || job.status === 'downloading') &&
    onPause !== undefined
  const canResume = canPauseResume && job.status === 'paused' && onResume !== undefined

  if (confirmingClear) {
    return (
      <div className="job-actions">
        <IconButton
          icon="check"
          label="Confirm clear from history"
          onClick={onConfirmClear}
          tone="confirm"
        />
        <IconButton icon="x" label="Keep download in history" onClick={onCancelClear} />
      </div>
    )
  }

  return (
    <div className="job-actions">
      {canResume ? (
        <IconButton icon="play" label={`Resume ${job.title}`} onClick={() => onResume?.(job.id)} />
      ) : null}

      {canPause ? (
        <IconButton icon="pause" label={`Pause ${job.title}`} onClick={() => onPause?.(job.id)} />
      ) : null}

      {job.status === 'seeding' && onStopSeeding ? (
        <IconButton
          icon="stop"
          label={`Stop seeding ${job.title}`}
          onClick={() => onStopSeeding(job.id)}
          tone="stop"
        />
      ) : null}

      {job.status === 'metadata' ? (
        <IconButton
          icon="x"
          label={`Cancel metadata lookup for ${job.title}`}
          onClick={() => onCancel(job.id)}
          tone="stop"
        />
      ) : null}

      {!terminal && job.status !== 'seeding' && !isTorrent ? (
        <IconButton
          icon="stop"
          label={job.status === 'cancelling' ? 'Stopping download' : `Stop ${job.title}`}
          onClick={() => onCancel(job.id)}
          disabled={job.status === 'cancelling'}
          tone="stop"
        />
      ) : null}

      {job.status === 'failed' || job.status === 'cancelled' ? (
        <IconButton icon="refresh" label={`Restart ${job.title}`} onClick={() => onRetry(job.id)} />
      ) : null}

      {(job.status === 'completed' || job.status === 'seeding') && job.output ? (
        <>
          <IconButton
            icon="folder"
            label="Open download folder"
            onClick={() => onOpenLocation(job.id, false)}
          />
          {!compact && job.output.files.length === 1 ? (
            <IconButton
              icon="file"
              label="Show downloaded file"
              onClick={() => onOpenLocation(job.id, true)}
            />
          ) : null}
        </>
      ) : null}

      {terminal ? (
        <IconButton
          icon="x"
          label={job.status === 'completed' ? 'Clear from history' : 'Clear from list'}
          onClick={onClear}
          tone="danger"
        />
      ) : null}
    </div>
  )
}

function CompactJobDetails({ job }: { job: DownloadJob }) {
  const percent = job.progress.percent
  const terminal = isTerminalStatus(job.status)
  const size = jobSize(job)
  const state = (
    <span className={`job-state job-state--${job.status}`}>
      <span className="job-state-dot" aria-hidden="true" />
      {STATUS_LABELS[job.status]}
    </span>
  )

  if (terminal) {
    return (
      <div className="job-meta job-meta--compact">
        {state}
        {size ? <span className="job-size">{size}</span> : null}
      </div>
    )
  }

  if (job.status === 'metadata') {
    const lookup = job.details?.engineId === 'torrent' ? job.details.lookup : undefined
    return (
      <div className="job-meta job-meta--compact">
        {state}
        <span className="job-size">
          {lookup?.phase === 'queued'
            ? 'Waiting for a lookup slot'
            : `${lookup?.peers ?? 0} peers · ${lookup?.dhtNodes ?? '—'} DHT nodes`}
        </span>
      </div>
    )
  }

  if (job.status === 'queued') {
    const scheduled = scheduledLabel(job)
    return (
      <div className="job-meta job-meta--compact">
        {state}
        <span className="job-size">
          {scheduled ? `Scheduled ${scheduled}` : 'Waiting for a slot'}
        </span>
      </div>
    )
  }

  if (job.status === 'resolving') {
    return (
      <div className="job-meta job-meta--compact">
        {state}
        <span className="job-size">Reading video info</span>
      </div>
    )
  }

  if (job.status === 'cancelling') {
    return (
      <div className="job-meta job-meta--compact">
        {state}
        <span className="job-size">Stopping…</span>
      </div>
    )
  }

  const sizeLabel =
    job.progress.downloadedBytes === null
      ? null
      : job.progress.totalBytes !== null
        ? `${formatBytes(job.progress.downloadedBytes)} / ${formatBytes(job.progress.totalBytes)}`
        : formatBytes(job.progress.downloadedBytes)

  return (
    <div className="job-progress-block">
      <div className="job-progress-head">
        {state}
        <span className="job-percent">{percent === null ? '—' : `${Math.round(percent)}%`}</span>
        {job.progress.bytesPerSecond !== null ? (
          <span className="job-speed">{formatSpeed(job.progress.bytesPerSecond)}</span>
        ) : null}
        {job.details?.engineId === 'torrent' &&
        job.details.uploadRateBytesPerSecond !== null &&
        job.details.uploadRateBytesPerSecond > 0 ? (
          <span className="job-speed">↑ {formatSpeed(job.details.uploadRateBytesPerSecond)}</span>
        ) : null}
      </div>

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

      <div className="job-progress-foot">
        <span className="job-size">{sizeLabel ?? 'Starting…'}</span>
        {job.details?.engineId === 'torrent' ? (
          <span className="job-torrent-stats">
            S {job.details.seedsConnected ?? '—'} ({job.details.seedsAvailable ?? '—'}) · P{' '}
            {job.details.peersConnected ?? '—'} ({job.details.peersAvailable ?? '—'})
          </span>
        ) : null}
        {job.progress.etaSeconds !== null ? (
          <span className="job-eta">ETA {formatEta(job.progress.etaSeconds)}</span>
        ) : null}
      </div>
    </div>
  )
}

export function JobRow({
  job,
  compact = false,
  pausableEngineIds,
  onCancel,
  onPause,
  onResume,
  onStopSeeding,
  onRetry,
  onRemove,
  onOpenLocation,
}: {
  job: DownloadJob
  compact?: boolean
  pausableEngineIds?: ReadonlySet<string>
  onCancel: (jobId: string) => void
  onPause?: (jobId: string) => void
  onResume?: (jobId: string) => void
  onStopSeeding?: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRemove: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
}) {
  const detail = jobDetailLine(job)
  const percent = job.progress.percent
  const showProgress = isProgressStatus(job.status)
  const size = jobSize(job)
  const terminal = isTerminalStatus(job.status)
  const canPauseResume = pausableEngineIds?.has(job.engineId) ?? false
  const scheduled = scheduledLabel(job)
  const [completionFlash, setCompletionFlash] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [removing, setRemoving] = useState(false)
  const previousStatus = useRef(job.status)

  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = job.status
    if (job.status !== 'completed' || previous === 'completed') return

    setCompletionFlash(true)
    const timer = window.setTimeout(() => setCompletionFlash(false), 900)
    return () => window.clearTimeout(timer)
  }, [job.status])

  useEffect(() => {
    if (!removing) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const delay = reducedMotion ? 0 : 220
    const removeTimer = window.setTimeout(() => onRemove(job.id), delay)
    const restoreTimer = window.setTimeout(() => setRemoving(false), delay + 1200)
    return () => {
      window.clearTimeout(removeTimer)
      window.clearTimeout(restoreTimer)
    }
  }, [job.id, onRemove, removing])

  const beginRemove = (): void => {
    setConfirmingClear(false)
    setRemoving(true)
  }

  const beginClear = (): void => {
    if (job.status === 'completed') {
      setConfirmingClear(true)
      return
    }
    beginRemove()
  }

  return (
    <article
      className={`job-row job-row--${job.status}${compact ? ' job-row--compact' : ''}${
        compact && terminal ? ' job-row--compact-terminal' : ''
      }${completionFlash ? ' job-row--just-completed' : ''}${removing ? ' job-row--removing' : ''}`}
      aria-label={`${job.title}, ${STATUS_LABELS[job.status]}`}
    >
      <div className="job-row-content">
        <div className="job-thumb">
          {job.details?.engineId === 'youtube' && job.details.thumbnailUrl ? (
            <img
              src={job.details.thumbnailUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Icon name="download" size={compact ? 15 : 20} />
          )}
        </div>
        <div className="job-main">
          {!compact ? (
            <div className="job-title-line">
              <span className={`badge job-status ${statusTone(job.status)}`}>
                {STATUS_LABELS[job.status]}
              </span>
              <span className="job-engine">
                {job.engineId === 'http'
                  ? 'Direct file'
                  : job.engineId === 'youtube'
                    ? 'YouTube'
                    : job.engineId}
              </span>
              {detail ? <span className="job-detail">{detail}</span> : null}
            </div>
          ) : null}
          <h3 className="job-title" title={job.title}>
            {job.title}
          </h3>

          {compact ? (
            <CompactJobDetails job={job} />
          ) : (
            <>
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
                {terminal ? (
                  size ? (
                    <span>{size}</span>
                  ) : null
                ) : job.status === 'metadata' ? (
                  <span>
                    {job.details?.engineId === 'torrent' && job.details.lookup
                      ? `${job.details.lookup.message} · ${job.details.lookup.peers ?? 0} peers`
                      : 'Searching the DHT for metadata…'}
                  </span>
                ) : job.status === 'queued' ? (
                  <span>{scheduled ? `Scheduled ${scheduled}` : 'Waiting for a slot'}</span>
                ) : job.status === 'resolving' ? (
                  <span>Reading video info</span>
                ) : job.status === 'cancelling' ? (
                  <span>Stopping…</span>
                ) : (
                  <>
                    <span className="job-percent">
                      {percent === null ? '—' : `${Math.round(percent)}%`}
                    </span>
                    {job.progress.downloadedBytes === null ? (
                      <span>Starting…</span>
                    ) : (
                      <span>
                        {formatBytes(job.progress.downloadedBytes)}
                        {job.progress.totalBytes !== null
                          ? ` / ${formatBytes(job.progress.totalBytes)}`
                          : ' downloaded'}
                      </span>
                    )}
                    {job.progress.bytesPerSecond !== null ? (
                      <span>{formatSpeed(job.progress.bytesPerSecond)}</span>
                    ) : null}
                    {job.details?.engineId === 'torrent' &&
                    job.details.uploadRateBytesPerSecond !== null &&
                    job.details.uploadRateBytesPerSecond > 0 ? (
                      <span>↑ {formatSpeed(job.details.uploadRateBytesPerSecond)}</span>
                    ) : null}
                    {job.progress.etaSeconds !== null ? (
                      <span className="job-eta">ETA {formatEta(job.progress.etaSeconds)}</span>
                    ) : null}
                  </>
                )}

                {job.output?.files[0] ? (
                  <span className="job-output" title={job.output.files[0].path}>
                    {job.output.files[0].path.split(/[\\/]/).pop()}
                  </span>
                ) : null}
              </div>
            </>
          )}

          {job.status === 'completed' ? (
            <div
              className={`job-clear-confirm${confirmingClear ? ' job-clear-confirm--open' : ''}`}
              aria-hidden={confirmingClear ? undefined : true}
              role={confirmingClear ? 'alert' : undefined}
            >
              <div className="job-clear-confirm-inner">
                <Icon name="alert" size={13} />
                <span>
                  Remove from history?{' '}
                  <span className="job-clear-confirm-note">The file stays on disk.</span>
                </span>
              </div>
            </div>
          ) : null}

          {job.error ? (
            <p className="job-error" role="alert">
              {job.error.message}
              <span className="job-diagnostic"> · {job.error.diagnosticId.slice(0, 8)}</span>
            </p>
          ) : null}
        </div>
      </div>

      <JobActions
        job={job}
        compact={compact}
        confirmingClear={confirmingClear}
        canPauseResume={canPauseResume}
        onCancel={onCancel}
        onPause={onPause}
        onResume={onResume}
        onStopSeeding={onStopSeeding}
        onRetry={onRetry}
        onOpenLocation={onOpenLocation}
        onClear={beginClear}
        onConfirmClear={beginRemove}
        onCancelClear={() => setConfirmingClear(false)}
      />
    </article>
  )
}

export function JobList({
  jobs,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  pausableEngineIds,
  onCancel,
  onPause,
  onResume,
  onStopSeeding,
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
    const aTerminal = isTerminalStatus(a.status)
    const bTerminal = isTerminalStatus(b.status)
    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1
    return b.createdAt.localeCompare(a.createdAt)
  })

  return (
    <div className="job-list" role="list">
      {sorted.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          pausableEngineIds={pausableEngineIds}
          onCancel={onCancel}
          onPause={onPause}
          onResume={onResume}
          onStopSeeding={onStopSeeding}
          onRetry={onRetry}
          onRemove={onRemove}
          onOpenLocation={onOpenLocation}
        />
      ))}
    </div>
  )
}
