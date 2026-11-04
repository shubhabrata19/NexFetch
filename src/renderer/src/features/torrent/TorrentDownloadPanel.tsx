import { useEffect, useRef, useState } from 'react'
import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  Settings,
  TorrentPreviewEnvelope,
} from '@shared/ipc/contracts'
import { parseTorrentInfoHash } from '@shared/domain/torrent-hash'
import { Icon } from '../../components/Icon'
import { defaultTorrentDestination, torrentFolderName } from '../../lib/paths'
import { formatBytes } from '../../lib/format'

interface TorrentDownloadPanelProps {
  settings: Settings
  dependencies: DependencyStatus | null
  jobs: DownloadJob[]
  lastLookupJobId: string | null
  onCreateTorrent: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onLookupTorrent: (infoHash: string) => Promise<DownloadJob | null>
  onOpenTorrent: (jobId: string) => void
  onCancelJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('The torrent file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function torrentHelperMissing(dependencies: DependencyStatus | null): boolean {
  return dependencies !== null && dependencies.torrentHelper.state !== 'ready'
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function hashFormatLabel(value: string, version: 1 | 2): string {
  if (version === 2) return 'v2 · 64 hex'
  return /^[A-Za-z2-7]{32}$/.test(value.trim().replace(/^urn:btih:/i, ''))
    ? 'v1 · 32 base32'
    : 'v1 · 40 hex'
}

function metadataFailureTitle(job: DownloadJob): string {
  if (job.error?.code === 'TORRENT_UNAVAILABLE') return 'Torrent engine unavailable'
  if (job.error?.code === 'TORRENT_INVALID') return 'Lookup failed'
  return 'Metadata not found'
}

export function TorrentDownloadPanel({
  settings,
  dependencies,
  jobs,
  lastLookupJobId,
  onCreateTorrent,
  onLookupTorrent,
  onOpenTorrent,
  onCancelJob,
  onRetryJob,
}: TorrentDownloadPanelProps) {
  const [infoHash, setInfoHash] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [startingLookup, setStartingLookup] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dismissedLookupId, setDismissedLookupId] = useState<string | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const preparingStartedAt = useRef(0)

  const parsedHash = parseTorrentInfoHash(infoHash)
  const helperMissing = torrentHelperMissing(dependencies)
  const lastLookup = jobs.find((job) => job.id === lastLookupJobId) ?? null
  const lookupDetails = lastLookup?.details?.engineId === 'torrent' ? lastLookup.details : null
  const lookup = lookupDetails?.lookup
  const showLookupStatus =
    lastLookup !== null &&
    lastLookup.id !== dismissedLookupId &&
    (lastLookup.status === 'metadata' ||
      lastLookup.status === 'setup' ||
      (lastLookup.status === 'failed' && lookup !== undefined) ||
      (lastLookup.status === 'cancelled' && lookup !== undefined))

  useEffect(() => {
    setDismissedLookupId(null)
  }, [lastLookupJobId])

  const waitForSpinner = async (): Promise<void> => {
    const elapsed = Date.now() - preparingStartedAt.current
    if (elapsed < 600) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 600 - elapsed)
      })
    }
  }

  const createDraft = async (preview: TorrentPreviewEnvelope): Promise<void> => {
    const existing = jobs.find(
      (job) =>
        job.details?.engineId === 'torrent' &&
        job.details.infoHash === preview.infoHash &&
        job.status !== 'failed' &&
        job.status !== 'cancelled',
    )
    if (existing) {
      setNotice('This torrent is already in your Torrents list. Opening it now.')
      await waitForSpinner()
      onOpenTorrent(existing.id)
      return
    }

    const destination = defaultTorrentDestination(
      settings.downloadDirectory,
      torrentFolderName(preview.title, preview.files),
    )
    const job = await onCreateTorrent({
      previewToken: preview.previewToken,
      selection: {
        fileIndices: preview.files.map((file) => file.index),
        seedAfterComplete: settings.torrentSeedAfterComplete,
      },
      destination,
      deferStart: true,
    })
    if (job) {
      await waitForSpinner()
      onOpenTorrent(job.id)
    }
  }

  const selectFile = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    const result = await window.nexfetch.torrent.chooseFile()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (!result.data) return

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    preparingStartedAt.current = Date.now()
    setBusy(true)
    try {
      const preview = await window.nexfetch.torrent.previewFile(result.data, requestId)
      if (!preview.ok) {
        setError(preview.error.message)
        return
      }
      await createDraft(preview.data)
    } finally {
      await waitForSpinner()
      requestIdRef.current = null
      setBusy(false)
    }
  }

  const previewBytes = async (file: File): Promise<void> => {
    setError(null)
    setNotice(null)
    if (!/\.torrent$/i.test(file.name)) {
      setError('Choose a .torrent file.')
      return
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      setError('The torrent file is empty or larger than 10 MB.')
      return
    }
    preparingStartedAt.current = Date.now()
    setBusy(true)
    try {
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      const dataBase64 = await fileToBase64(file)
      const result = await window.nexfetch.torrent.previewBytes(requestId, file.name, dataBase64)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      await createDraft(result.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The torrent file could not be read.')
    } finally {
      await waitForSpinner()
      requestIdRef.current = null
      setBusy(false)
    }
  }

  const lookUpHash = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setTouched(true)
    if (!parsedHash) {
      setError(null)
      return
    }

    const existing = jobs.find(
      (job) =>
        job.details?.engineId === 'torrent' &&
        job.details.infoHash === parsedHash.infoHash &&
        job.status !== 'failed' &&
        job.status !== 'cancelled',
    )
    if (existing) {
      setNotice('This torrent is already in your Torrents list. Opening it now.')
      onOpenTorrent(existing.id)
      return
    }

    setStartingLookup(true)
    try {
      const job = await onLookupTorrent(parsedHash.infoHash)
      if (job) {
        setInfoHash('')
        setTouched(false)
      }
    } finally {
      setStartingLookup(false)
    }
  }

  const pasteHash = async (): Promise<void> => {
    setError(null)
    const result = await window.nexfetch.system.readClipboardText()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const value = result.data.trim()
    if (/^magnet:/i.test(value)) {
      setError('Magnet links are not supported. Paste the info hash instead.')
      return
    }
    setInfoHash(value)
    setTouched(true)
  }

  const validationMessage =
    touched && infoHash.trim().length > 0 && !parsedHash
      ? /^magnet:/i.test(infoHash.trim())
        ? 'Magnet links are not supported. Paste the info hash instead.'
        : 'Enter a valid v1 (40 hex / 32 base32) or v2 (64 hex) info hash.'
      : null
  const formatLabel = parsedHash ? hashFormatLabel(infoHash, parsedHash.version) : null
  const canLookup = parsedHash !== null && !startingLookup && !helperMissing
  const lookupPhase = lookup?.phase

  return (
    <section className="card download-panel torrent-intake" aria-labelledby="new-torrent-title">
      <div className="download-panel-body">
        <div className="card-heading">
          <div>
            <p className="eyebrow">New download</p>
            <h2 id="new-torrent-title">Torrent</h2>
          </div>
          <span className="badge badge--accent">Files &amp; hashes</span>
        </div>

        {helperMissing ? (
          <div className="notice notice--warning" role="status">
            <Icon name="alert" size={18} />
            <div>
              <strong>The torrent engine is not installed.</strong>
              <p>Build the local torrent helper before adding torrents.</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={18} />
            <p>{error}</p>
          </div>
        ) : null}

        {notice ? (
          <div className="notice notice--info" role="status">
            <Icon name="spark" size={18} />
            <p>{notice}</p>
          </div>
        ) : null}

        <section className="torrent-hash-section" aria-labelledby="torrent-hash-label">
          <div className="torrent-section-heading">
            <h3 id="torrent-hash-label">Add by info hash</h3>
            <span>Public torrents only</span>
          </div>

          <div
            className={`torrent-hash-box${validationMessage ? ' torrent-hash-box--invalid' : ''}`}
          >
            <label className="sr-only" htmlFor="torrent-info-hash">
              Torrent info hash
            </label>
            <input
              id="torrent-info-hash"
              className="torrent-hash-input"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="Paste a v1 or v2 info hash"
              value={infoHash}
              disabled={helperMissing}
              aria-invalid={validationMessage ? true : undefined}
              aria-describedby="torrent-hash-help"
              onChange={(event) => {
                setInfoHash(event.target.value)
                setTouched(true)
                if (error) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void lookUpHash()
                }
              }}
            />
            <button
              type="button"
              className="torrent-hash-paste"
              onClick={() => void pasteHash()}
              disabled={helperMissing}
            >
              Paste
            </button>
            <button
              type="button"
              className="torrent-hash-submit"
              onClick={() => void lookUpHash()}
              disabled={!canLookup}
            >
              {startingLookup ? 'Starting…' : 'Look up'}
            </button>
          </div>

          <p
            id="torrent-hash-help"
            className={`torrent-hash-help${
              validationMessage
                ? ' torrent-hash-help--invalid'
                : formatLabel
                  ? ' torrent-hash-help--valid'
                  : ''
            }`}
          >
            {validationMessage ??
              (formatLabel
                ? `✓ Valid ${formatLabel}`
                : 'v1: 40 hex or 32 base32 · v2: 64 hex · Private torrents need a .torrent file')}
          </p>

          {showLookupStatus && lastLookup ? (
            <div
              className={`torrent-lookup-status torrent-lookup-status--${lastLookup.status}`}
              role="status"
              aria-live="polite"
            >
              <div className="torrent-lookup-status-main">
                {lastLookup.status === 'metadata' ? (
                  <span className="spinner torrent-lookup-spinner" aria-hidden="true" />
                ) : lastLookup.status === 'setup' ? (
                  <span className="torrent-lookup-icon torrent-lookup-icon--success">
                    <Icon name="check" size={16} />
                  </span>
                ) : (
                  <span className="torrent-lookup-icon torrent-lookup-icon--danger">
                    <Icon name="alert" size={16} />
                  </span>
                )}
                <div className="torrent-lookup-status-copy">
                  <strong>
                    {lastLookup.status === 'metadata'
                      ? 'Fetching metadata'
                      : lastLookup.status === 'setup'
                        ? 'Metadata ready'
                        : lastLookup.status === 'cancelled'
                          ? 'Lookup cancelled'
                          : metadataFailureTitle(lastLookup)}
                  </strong>
                  <span className="torrent-lookup-status-meta">
                    {lastLookup.status === 'metadata'
                      ? [
                          lookupPhase === 'queued'
                            ? 'Waiting for another lookup'
                            : formatElapsed(lookup?.elapsedMs ?? 0),
                          `${lookup?.peers ?? 0} peers`,
                          `${lookup?.dhtNodes ?? '—'} DHT nodes`,
                        ].join(' · ')
                      : lastLookup.status === 'setup'
                        ? `${lastLookup.title} · ${formatBytes(lastLookup.progress.totalBytes ?? 0)} · ${
                            lookupDetails?.files.length ?? 0
                          } ${(lookupDetails?.files.length ?? 0) === 1 ? 'file' : 'files'}`
                        : (lookup?.message ??
                          lastLookup.error?.message ??
                          'This lookup did not return metadata.')}
                  </span>
                </div>
              </div>
              <div className="torrent-lookup-status-actions">
                {lastLookup.status === 'metadata' ? (
                  <>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenTorrent(lastLookup.id)}
                    >
                      View in Torrents
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => onCancelJob(lastLookup.id)}
                    >
                      Cancel
                    </button>
                  </>
                ) : lastLookup.status === 'setup' ? (
                  <button
                    type="button"
                    className="button button--primary button--small"
                    onClick={() => onOpenTorrent(lastLookup.id)}
                  >
                    Review setup
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    onClick={() => onRetryJob(lastLookup.id)}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  className="torrent-lookup-dismiss"
                  aria-label="Dismiss metadata lookup status"
                  onClick={() => setDismissedLookupId(lastLookup.id)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <div className="torrent-or-divider">
          <span>or open a .torrent file</span>
        </div>

        <div
          className={`torrent-file-band${dragging ? ' torrent-file-band--active' : ''}${busy ? ' torrent-file-band--busy' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) void previewBytes(file)
          }}
        >
          {busy ? (
            <span className="spinner torrent-file-spinner" aria-hidden="true" />
          ) : (
            <span className="torrent-file-band-icon">
              <Icon name="download" size={22} />
            </span>
          )}
          <div className="torrent-file-band-copy">
            <h3>{busy ? 'Preparing torrent…' : 'Drop a .torrent file'}</h3>
            <p>
              {busy
                ? 'Reading the file list, trackers, and metadata before opening setup.'
                : 'Or choose one from your computer. Parsed locally; nothing is uploaded.'}
            </p>
          </div>
          <div className="torrent-file-band-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void selectFile()}
              disabled={busy || helperMissing}
            >
              <Icon name="folder" size={17} />
              Choose file…
            </button>
            <span>Up to 10 MB</span>
          </div>
        </div>

        <p className="quality-note">
          Only download and share content you have the rights to. Magnet links are not supported.
        </p>
      </div>
    </section>
  )
}
