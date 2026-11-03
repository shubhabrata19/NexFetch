import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  CreateJobRequest,
  DownloadJob,
  HttpPreviewEnvelope,
  Settings,
} from '@shared/ipc/contracts'
import { Icon } from '../../components/Icon'
import { formatReportedSize } from '../../lib/format'

interface HttpDownloadPanelProps {
  settings: Settings
  onCreateJob: (request: CreateJobRequest) => Promise<DownloadJob | null>
}

function isChecksumValid(value: string): boolean {
  return value.length === 0 || /^[0-9a-fA-F]{64}$/.test(value.trim())
}

export function HttpDownloadPanel({ settings, onCreateJob }: HttpDownloadPanelProps) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<HttpPreviewEnvelope | null>(null)
  const [fetching, setFetching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checksum, setChecksum] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const requestId = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (requestId.current) {
        void window.nexfetch.preview.cancel(requestId.current)
      }
    }
  }, [])

  const canFetch = url.trim().length > 0 && !fetching

  const handleFetch = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canFetch) return

    if (requestId.current) {
      void window.nexfetch.preview.cancel(requestId.current)
    }
    const nextRequestId = crypto.randomUUID()
    requestId.current = nextRequestId
    setFetching(true)
    setError(null)
    setPreview(null)

    const result = await window.nexfetch.preview.request(url.trim(), nextRequestId)
    if (!mounted.current || requestId.current !== nextRequestId) return
    requestId.current = null
    setFetching(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    if (result.data.engineId !== 'http') {
      setError('That link is a YouTube video. Switch to the YouTube tab to inspect it.')
      return
    }
    setPreview(result.data)
  }

  const scheduleDate = scheduledAt ? new Date(scheduledAt) : null
  const scheduleValid =
    !scheduledAt || (scheduleDate !== null && scheduleDate.getTime() > Date.now())
  const checksumValid = isChecksumValid(checksum)
  const canDownload = preview !== null && !creating && scheduleValid && checksumValid

  const handleCreate = async (): Promise<void> => {
    if (!preview || !canDownload) return
    setCreating(true)
    setError(null)

    const request: CreateJobRequest = {
      previewToken: preview.previewToken,
      selection: checksum.trim()
        ? { checksum: { algorithm: 'sha256', expectedHex: checksum.trim().toLowerCase() } }
        : {},
      destination: settings.downloadDirectory,
      scheduledAt: scheduleDate ? scheduleDate.toISOString() : undefined,
    }

    const job = await onCreateJob(request)
    setCreating(false)
    if (!job) return
    setPreview(null)
    setUrl('')
    setChecksum('')
    setScheduledAt('')
  }

  return (
    <section className="card download-panel" aria-labelledby="http-download-title">
      <div className="download-panel-body">
        <div className="card-heading">
          <div>
            <p className="eyebrow">New download</p>
            <h2 id="http-download-title">Direct file</h2>
          </div>
          <span className="badge badge--accent">HTTP / HTTPS</span>
        </div>

        <form className="url-form" onSubmit={(event) => void handleFetch(event)}>
          <label className="sr-only" htmlFor="http-url">
            Direct file URL
          </label>
          <div className="url-input-wrap">
            <Icon name="download" size={18} />
            <input
              id="http-url"
              className="text-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a direct file link"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                if (preview) setPreview(null)
                if (error) setError(null)
              }}
            />
          </div>
          <button type="submit" className="button button--primary" disabled={!canFetch}>
            {fetching ? 'Inspecting…' : 'Inspect link'}
          </button>
          {preview || fetching ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                if (requestId.current) void window.nexfetch.preview.cancel(requestId.current)
                requestId.current = null
                setFetching(false)
                setPreview(null)
                setError(null)
              }}
            >
              Clear
            </button>
          ) : null}
        </form>

        {fetching ? (
          <div className="loading-panel" role="status">
            <div className="spinner" aria-hidden="true" />
            <div>
              <strong>Inspecting the link…</strong>
              <p>Checking the final address, file type, size, and resume support.</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={18} />
            <div>
              <strong>Could not inspect this link.</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="http-preview">
            <div className="http-preview-file">
              <div className="empty-icon empty-icon--small">
                <Icon name="file" size={22} />
              </div>
              <div className="http-preview-copy">
                <span className="eyebrow">{preview.host}</span>
                <h3 title={preview.filename}>{preview.filename}</h3>
                <p className="http-preview-url" title={preview.displayUrl}>
                  {preview.displayUrl}
                </p>
              </div>
            </div>

            <div className="http-preview-badges">
              <span className="badge badge--neutral">
                {preview.contentType ?? 'Unknown file type'}
              </span>
              <span className="badge badge--neutral">
                {formatReportedSize(preview.contentLength)}
              </span>
              <span className={`badge ${preview.resumable ? 'badge--success' : 'badge--neutral'}`}>
                {preview.resumable ? 'Resumable' : 'Restart on retry'}
              </span>
            </div>

            <div className="http-options">
              <label className="field">
                <span className="field-label">SHA-256 checksum (optional)</span>
                <input
                  className="text-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="64 hexadecimal characters"
                  value={checksum}
                  onChange={(event) => setChecksum(event.target.value)}
                  aria-invalid={!checksumValid}
                />
                {!checksumValid ? (
                  <span className="field-hint field-hint--warning">
                    A SHA-256 checksum must contain exactly 64 hexadecimal characters.
                  </span>
                ) : (
                  <span className="field-hint">
                    NexFetch verifies the file after download when a checksum is provided.
                  </span>
                )}
              </label>

              <label className="field">
                <span className="field-label">Start time</span>
                <input
                  className="text-input"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  aria-invalid={!scheduleValid}
                />
                {!scheduleValid ? (
                  <span className="field-hint field-hint--warning">
                    Choose a time in the future, or leave this empty to start now.
                  </span>
                ) : (
                  <span className="field-hint">Leave empty to start immediately.</span>
                )}
              </label>
            </div>

            <p className="quality-note">
              NexFetch downloads direct links with your connection. It does not bypass sign-ins,
              paywalls, DRM, or other access controls.
            </p>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="download-action-bar">
          <div className="download-action-summary">
            <span className="eyebrow">Ready to download</span>
            <span className="download-action-title">{preview.filename}</span>
            <span className="download-action-note">
              {preview.resumable ? 'Resumable download' : 'Restarts safely if interrupted'}
              {checksum.trim() ? ' · SHA-256 verification' : ''}
            </span>
            <span className="download-action-destination" title={settings.downloadDirectory}>
              To {settings.downloadDirectory}
            </span>
          </div>
          <button
            type="button"
            className="button button--primary button--download"
            onClick={() => void handleCreate()}
            disabled={!canDownload}
          >
            <Icon name="download" size={19} />
            {creating ? 'Starting…' : scheduleDate ? 'Schedule download' : 'Download file'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
