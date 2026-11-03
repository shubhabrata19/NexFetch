import { useEffect, useRef, useState } from 'react'
import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  Settings,
  TorrentPreviewEnvelope,
} from '@shared/ipc/contracts'
import type { TorrentPreviewProgressEvent } from '@shared/ipc/contracts'
import { parseTorrentInfoHash } from '@shared/domain/torrent-hash'
import { Icon } from '../../components/Icon'
import { defaultTorrentDestination, torrentFolderName } from '../../lib/paths'

interface TorrentDownloadPanelProps {
  settings: Settings
  dependencies: DependencyStatus | null
  jobs: DownloadJob[]
  onCreateTorrent: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onOpenTorrent: (jobId: string) => void
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

export function TorrentDownloadPanel({
  settings,
  dependencies,
  jobs,
  onCreateTorrent,
  onOpenTorrent,
}: TorrentDownloadPanelProps) {
  const [infoHash, setInfoHash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState<TorrentPreviewProgressEvent | null>(null)
  const [dragging, setDragging] = useState(false)
  const requestIdRef = useRef<string | null>(null)
  const parsedHash = parseTorrentInfoHash(infoHash)
  const helperMissing = torrentHelperMissing(dependencies)

  useEffect(() => {
    const unsubscribe = window.nexfetch.torrent.onPreviewProgress((event) => {
      if (event.requestId === requestIdRef.current) setProgress(event)
    })
    return unsubscribe
  }, [])

  const existingJob = (preview: TorrentPreviewEnvelope): DownloadJob | undefined =>
    jobs.find(
      (job) =>
        job.details?.engineId === 'torrent' &&
        job.details.infoHash === preview.infoHash &&
        job.status !== 'failed' &&
        job.status !== 'cancelled',
    )

  const createDraft = async (preview: TorrentPreviewEnvelope): Promise<void> => {
    const existing = existingJob(preview)
    if (existing) {
      setNotice('This torrent is already in your Torrents list. Opening it now.')
      onOpenTorrent(existing.id)
      return
    }

    setBusy(true)
    try {
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
      if (job) onOpenTorrent(job.id)
    } finally {
      setBusy(false)
    }
  }

  const selectFile = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const result = await window.nexfetch.torrent.chooseFile()
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      if (result.data) await createDraft(result.data)
    } finally {
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
      requestIdRef.current = null
      setBusy(false)
    }
  }

  const lookUpHash = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    if (!parsedHash) {
      setError(
        /^magnet:/i.test(infoHash.trim())
          ? 'Magnet links are not supported. Paste the info hash or open the .torrent file instead.'
          : 'Enter a valid v1 (40 hex / 32 base32) or v2 (64 hex) info hash.',
      )
      return
    }

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    setResolving(true)
    setProgress(null)
    try {
      const result = await window.nexfetch.torrent.previewInfoHash(requestId, parsedHash.infoHash)
      if (!result.ok) {
        if (result.error.code !== 'CANCELLED') setError(result.error.message)
        return
      }
      await createDraft(result.data)
    } finally {
      requestIdRef.current = null
      setResolving(false)
      setProgress(null)
    }
  }

  const cancelResolve = (): void => {
    if (requestIdRef.current) {
      void window.nexfetch.torrent.cancelPreview(requestIdRef.current)
      requestIdRef.current = null
    }
    setResolving(false)
    setProgress(null)
  }

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

        {resolving ? (
          <div className="torrent-resolve-panel" role="status" aria-live="polite">
            <div className="torrent-resolve-heading">
              <div>
                <p className="eyebrow">Info hash</p>
                <h3>Finding peers…</h3>
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={cancelResolve}
              >
                Cancel
              </button>
            </div>
            <div className="torrent-resolve-metrics">
              <span>DHT {progress?.dhtNodes ?? '—'} nodes</span>
              <span>{progress?.peers ?? 0} peers</span>
              <span>{Math.round((progress?.elapsedMs ?? 0) / 1000)}s</span>
            </div>
            <p className="torrent-resolve-copy">
              {progress?.message ??
                'Info hashes resolve through DHT. Private torrents require the .torrent file.'}
            </p>
            <div className="progress-track progress-track--indeterminate">
              <span className="progress-fill" />
            </div>
          </div>
        ) : (
          <div className="torrent-intake-grid">
            <div
              className={`torrent-dropzone${dragging ? ' torrent-dropzone--active' : ''}`}
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
              <div className="empty-icon">
                <Icon name="download" size={26} />
              </div>
              <h3>Drop a .torrent file</h3>
              <p>or choose one from your computer. Parsed locally.</p>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => void selectFile()}
                disabled={busy || helperMissing}
              >
                <Icon name="folder" size={17} />
                Choose file…
              </button>
              <span className="torrent-dropzone-note">Up to 10 MB</span>
            </div>

            <div className="torrent-hash-card">
              <div className="torrent-hash-heading">
                <Icon name="file" size={18} />
                <h3>Paste an info hash</h3>
              </div>
              <label className="sr-only" htmlFor="torrent-info-hash">
                Torrent info hash
              </label>
              <textarea
                id="torrent-info-hash"
                className="text-input torrent-hash-input"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                placeholder="v1 40 hex / 32 base32, or v2 64 hex"
                value={infoHash}
                onChange={(event) => {
                  setInfoHash(event.target.value)
                  if (error) setError(null)
                }}
              />
              <div className="torrent-hash-actions">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => {
                    void navigator.clipboard
                      .readText()
                      .then((value) => setInfoHash(value.trim()))
                      .catch(() => setError('The clipboard could not be read.'))
                  }}
                >
                  Paste
                </button>
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void lookUpHash()}
                  disabled={!parsedHash || busy || helperMissing}
                >
                  Look up
                </button>
              </div>
              <p className="torrent-hash-note">
                Info hashes use DHT and work for public torrents. Private torrents need the .torrent
                file.
              </p>
            </div>
          </div>
        )}

        <p className="quality-note">
          Only download and share content you have the rights to. Magnet links are not supported.
        </p>
      </div>
    </section>
  )
}
