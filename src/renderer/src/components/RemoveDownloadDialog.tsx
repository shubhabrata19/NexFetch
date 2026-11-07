import { useEffect, useState } from 'react'
import type { DownloadJob } from '@shared/ipc/contracts'
import { formatBytes } from '../lib/format'
import { Icon } from './Icon'

export type RemovalAction = 'remove' | 'close'

interface RemoveDownloadDialogProps {
  job: DownloadJob
  action: RemovalAction
  busy: boolean
  onCancel: () => void
  onConfirm: (deleteFiles: boolean) => void
}

function isActiveStatus(job: DownloadJob): boolean {
  return !['completed', 'failed', 'cancelled', 'paused'].includes(job.status)
}

function dialogTitle(job: DownloadJob, action: RemovalAction): string {
  if (job.engineId === 'torrent') {
    if (job.status === 'setup') return 'Discard this torrent setup?'
    if (job.status === 'metadata') return 'Cancel this metadata lookup?'
    if (action === 'close' && isActiveStatus(job)) return 'Stop and remove this torrent?'
    return 'Remove this torrent?'
  }
  return 'Remove this download?'
}

function dialogCopy(job: DownloadJob, isTorrent: boolean): string {
  const quoted = `“${job.title}”`
  if (!isTorrent) {
    if (job.status === 'paused') {
      return `${quoted} will be removed from NexFetch. Its incomplete progress will be discarded.`
    }
    return `${quoted} will be removed from NexFetch. The downloaded file stays on disk.`
  }

  switch (job.status) {
    case 'setup':
      return 'This torrent has not started downloading. It will be removed from your list and nothing will be written to disk.'
    case 'metadata':
      return 'NexFetch will stop searching for peers and remove this torrent from your list. No files have been downloaded yet.'
    case 'completed':
      return `${quoted} will be removed from NexFetch. The downloaded files stay on disk unless you choose to delete them below.`
    case 'seeding':
      return `${quoted} is still seeding. Removing it stops seeding and removes it from NexFetch. The downloaded files stay on disk unless you choose to delete them below.`
    case 'paused':
      return 'This paused torrent will be removed from NexFetch. Its partial download stays on disk unless you choose to delete it below.'
    case 'failed':
      return 'This failed torrent will be removed from NexFetch. Any files it wrote stay on disk unless you choose to delete them below.'
    case 'cancelled':
      return 'This cancelled torrent will be removed from NexFetch. Any files it wrote stay on disk unless you choose to delete them below.'
    default:
      return `${quoted} will be stopped and removed from NexFetch. Its partial download stays on disk unless you choose to delete it below.`
  }
}

function payloadSummary(job: DownloadJob): { files: number; bytes: number } {
  const outputFiles = job.output?.files ?? []
  if (outputFiles.length > 0) {
    return {
      files: outputFiles.length,
      bytes: outputFiles.reduce((total, file) => total + (file.bytes ?? 0), 0),
    }
  }

  const details = job.details?.engineId === 'torrent' ? job.details : null
  const selected = details?.files.filter((file) => file.selected).length ?? 0
  const bytes =
    job.status === 'completed' || job.status === 'seeding'
      ? (job.progress.totalBytes ?? 0)
      : (job.progress.downloadedBytes ?? 0)
  return { files: selected, bytes }
}

export function RemoveDownloadDialog({
  job,
  action,
  busy,
  onCancel,
  onConfirm,
}: RemoveDownloadDialogProps) {
  const [deleteFiles, setDeleteFiles] = useState(false)
  const isTorrent = job.engineId === 'torrent'
  const hasPayload = isTorrent && job.status !== 'setup' && job.status !== 'metadata'
  const complete = job.status === 'completed' || job.status === 'seeding'
  const summary = payloadSummary(job)
  const sizeLabel = summary.bytes > 0 ? ` (${formatBytes(summary.bytes)})` : ''
  const fileLabel = `${summary.files} ${summary.files === 1 ? 'file' : 'files'}`
  const location = job.output?.directory ?? job.destination

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const confirmLabel = (() => {
    if (busy) return 'Removing…'
    if (job.status === 'setup') return 'Discard setup'
    if (job.status === 'metadata') return 'Stop and remove'
    if (deleteFiles) return 'Remove and delete files'
    if (action === 'close' && isActiveStatus(job)) return 'Stop and remove'
    return 'Remove'
  })()

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || busy) return
        onCancel()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-dialog-title"
        aria-describedby="remove-dialog-copy"
      >
        <header className="dialog-head">
          <span className={`dialog-icon${deleteFiles ? ' dialog-icon--danger' : ''}`}>
            <Icon name="trash" size={18} />
          </span>
          <div className="dialog-heading">
            <h2 id="remove-dialog-title">{dialogTitle(job, action)}</h2>
            <p id="remove-dialog-copy" className="dialog-copy">
              {dialogCopy(job, isTorrent)}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel removal"
            onClick={onCancel}
            disabled={busy}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        {hasPayload ? (
          <p className="dialog-path" title={location}>
            <Icon name="folder" size={13} />
            <span>{location}</span>
          </p>
        ) : null}

        {hasPayload ? (
          <label className={`dialog-option${deleteFiles ? ' dialog-option--checked' : ''}`}>
            <input
              type="checkbox"
              checked={deleteFiles}
              disabled={busy}
              onChange={(event) => setDeleteFiles(event.target.checked)}
            />
            <span className="dialog-option-copy">
              <strong>
                {complete
                  ? `Also delete the downloaded files from disk${sizeLabel}`
                  : `Also delete the partially downloaded files from disk${sizeLabel}`}
              </strong>
              <small>
                {complete
                  ? `Permanently deletes ${fileLabel} from this folder. This cannot be undone.`
                  : `Permanently deletes ${fileLabel}. Anything already downloaded will not be kept. This cannot be undone.`}
              </small>
            </span>
          </label>
        ) : null}

        <footer className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className={`button ${deleteFiles ? 'button--danger' : 'button--primary'}`}
            onClick={() => onConfirm(deleteFiles)}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
