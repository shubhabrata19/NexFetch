import { useEffect, useRef, useState } from 'react'
import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  Settings,
} from '@shared/ipc/contracts'
import type {
  YoutubeFormat,
  YoutubePreviewEnvelope,
  YoutubeSelection,
} from '@shared/domain/youtube'
import { classifyYoutubeInput } from '@shared/domain/youtube-url'
import { Icon } from '../../components/Icon'
import {
  formatBytes,
  formatCodec,
  formatDuration,
  formatReportedSize,
  formatResolution,
  formatUploadDate,
} from '../../lib/format'

interface YoutubeDownloadPanelProps {
  settings: Settings
  dependencies: DependencyStatus | null
  onCreateJob: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onOpenSettings: () => void
}

function isReady(
  dependencies: DependencyStatus | null,
  id: 'ytDlp' | 'ffmpeg' | 'ffprobe',
): boolean {
  return dependencies?.[id].state === 'ready'
}

function requiredMissingDependencies(
  preview: YoutubePreviewEnvelope,
  selection: YoutubeSelection,
  dependencies: DependencyStatus | null,
): string[] {
  if (!dependencies) return []
  const missing: string[] = []
  if (!isReady(dependencies, 'ytDlp')) missing.push('yt-dlp')

  if (selection.mode === 'best-up-to-4k') {
    if (!preview.bestUpTo4k) return missing
    if (preview.bestUpTo4k.requiresFfmpeg && !isReady(dependencies, 'ffmpeg')) {
      missing.push('FFmpeg')
    }
    if (!isReady(dependencies, 'ffprobe')) missing.push('ffprobe')
    return missing
  }

  if (selection.mode === 'audio') {
    return missing
  }

  const format = preview.formats.find((candidate) => candidate.formatId === selection.videoFormatId)
  if (!format) return missing
  if (!format.hasAudio && !isReady(dependencies, 'ffmpeg')) missing.push('FFmpeg')
  if (!isReady(dependencies, 'ffprobe')) missing.push('ffprobe')
  return missing
}

function formatDetail(format: YoutubeFormat): string {
  const codecs = [
    format.videoCodec ? formatCodec(format.videoCodec) : null,
    format.audioCodec ? formatCodec(format.audioCodec) : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' + ')
  return codecs.length > 0 ? codecs : '—'
}

function joinMetaParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

function FormatBadges({ format }: { format: YoutubeFormat }) {
  return (
    <span className="format-badges">
      {format.dynamicRange === 'HDR' ? <span className="badge badge--accent">HDR</span> : null}
      {!format.hasAudio ? (
        <span
          className="badge badge--neutral"
          title="NexFetch adds the best compatible audio automatically."
        >
          Adaptive video
        </span>
      ) : null}
      {format.hasAudio && !format.hasVideo ? (
        <span className="badge badge--neutral">Audio only</span>
      ) : null}
      {format.fps !== null && format.fps >= 50 ? (
        <span className="badge badge--neutral">{Math.round(format.fps)} FPS</span>
      ) : null}
    </span>
  )
}

export function YoutubeDownloadPanel({
  settings,
  dependencies,
  onCreateJob,
  onOpenSettings,
}: YoutubeDownloadPanelProps) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<YoutubePreviewEnvelope | null>(null)
  const [selection, setSelection] = useState<YoutubeSelection>({ mode: 'best-up-to-4k' })
  const [fetching, setFetching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      const requestId = activeRequest.current
      if (requestId) void window.nexfetch.youtube.cancelPreview(requestId)
    }
  }, [])

  const trimmedUrl = url.trim()
  const classification = trimmedUrl ? classifyYoutubeInput(trimmedUrl) : null
  const urlError =
    trimmedUrl && (!classification || classification.kind === 'unsupported')
      ? (classification?.reason ?? 'Paste a YouTube video link.')
      : null
  const ytDlpReady = isReady(dependencies, 'ytDlp')
  const canFetch = Boolean(trimmedUrl) && !urlError && !fetching && ytDlpReady

  const handleFetch = async (): Promise<void> => {
    if (!canFetch) return

    const previousRequest = activeRequest.current
    if (previousRequest) void window.nexfetch.youtube.cancelPreview(previousRequest)

    const requestId = crypto.randomUUID()
    activeRequest.current = requestId
    setFetching(true)
    setError(null)
    setPreview(null)
    setSelection({ mode: 'best-up-to-4k' })

    const result = await window.nexfetch.youtube.preview(trimmedUrl, requestId)
    if (activeRequest.current !== requestId) return

    activeRequest.current = null
    setFetching(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setPreview(result.data)
  }

  const handleCancelFetch = (): void => {
    const requestId = activeRequest.current
    if (requestId) void window.nexfetch.youtube.cancelPreview(requestId)
    activeRequest.current = null
    setFetching(false)
  }

  const handleClear = (): void => {
    handleCancelFetch()
    setUrl('')
    setPreview(null)
    setSelection({ mode: 'best-up-to-4k' })
    setError(null)
  }

  const handleCreate = async (): Promise<void> => {
    if (!preview || creating) return
    setCreating(true)
    await onCreateJob({
      previewToken: preview.previewToken,
      selection,
      destination: settings.downloadDirectory,
    })
    setCreating(false)
  }

  const missingDependencies = preview
    ? requiredMissingDependencies(preview, selection, dependencies)
    : []
  const dependenciesChecking = dependencies === null
  const selectionValid =
    preview !== null &&
    (selection.mode !== 'best-up-to-4k' || preview.bestUpTo4k !== null) &&
    (selection.mode !== 'video' ||
      preview.formats.some(
        (format) => format.formatId === selection.videoFormatId && format.hasVideo,
      )) &&
    (selection.mode !== 'audio' ||
      preview.formats.some(
        (format) => format.formatId === selection.audioFormatId && !format.hasVideo,
      ))
  const canDownload =
    Boolean(preview) &&
    !creating &&
    !dependenciesChecking &&
    selectionValid &&
    missingDependencies.length === 0

  const videoFormats = preview?.formats.filter((format) => format.hasVideo) ?? []
  const audioFormats =
    preview?.formats.filter((format) => format.hasAudio && !format.hasVideo) ?? []
  const maxVideoHeight = videoFormats.reduce(
    (maximum, format) => Math.max(maximum, format.height ?? 0),
    0,
  )
  const has4k = maxVideoHeight === 2160

  const selectedVideoFormat = (() => {
    if (!preview || selection.mode === 'audio') return null
    if (selection.mode === 'video') {
      return videoFormats.find((format) => format.formatId === selection.videoFormatId) ?? null
    }
    if (!preview.bestUpTo4k) return null
    return (
      videoFormats.find((format) => format.formatId === preview.bestUpTo4k?.videoFormatId) ?? null
    )
  })()

  const selectedAdaptive =
    selection.mode !== 'audio' &&
    selectedVideoFormat !== null &&
    (!selectedVideoFormat.hasAudio ||
      (selection.mode === 'best-up-to-4k' && preview?.bestUpTo4k?.requiresFfmpeg === true))

  const selectedSummary = (() => {
    if (!preview) return null
    if (selection.mode === 'best-up-to-4k') {
      if (!preview.bestUpTo4k) return 'No eligible format'
      return joinMetaParts([
        preview.bestUpTo4k.resolutionLabel,
        preview.bestUpTo4k.predictedContainer.toUpperCase(),
        formatReportedSize(preview.bestUpTo4k.estimatedBytes),
      ])
    }
    if (selection.mode === 'audio') {
      const format = audioFormats.find(
        (candidate) => candidate.formatId === selection.audioFormatId,
      )
      return format
        ? joinMetaParts([
            format.resolutionLabel,
            format.ext.toUpperCase(),
            formatReportedSize(format.sizeBytes),
          ])
        : 'Audio selection unavailable'
    }
    const format = videoFormats.find((candidate) => candidate.formatId === selection.videoFormatId)
    return format
      ? joinMetaParts([
          format.resolutionLabel,
          format.ext.toUpperCase(),
          formatReportedSize(format.sizeBytes),
        ])
      : 'Video selection unavailable'
  })()

  const downloadButtonLabel =
    selection.mode === 'audio'
      ? 'Download audio'
      : selectedVideoFormat?.height === 2160
        ? 'Download 4K'
        : selectedVideoFormat?.height
          ? `Download ${selectedVideoFormat.height}p`
          : 'Download'

  return (
    <section className="card download-panel" aria-labelledby="new-download-title">
      <div className="download-panel-body">
        <div className="card-heading">
          <div>
            <p className="eyebrow">New download</p>
            <h2 id="new-download-title">YouTube</h2>
          </div>
          <span className="badge badge--accent">Up to 4K</span>
        </div>

        {dependencies === null ? (
          <div className="notice notice--warning" role="status">
            <Icon name="refresh" size={18} />
            <div>
              <strong>Checking runtime dependencies…</strong>
              <p>yt-dlp, FFmpeg, and ffprobe must be available before downloading.</p>
            </div>
          </div>
        ) : !ytDlpReady ? (
          <div className="notice notice--warning" role="status">
            <Icon name="alert" size={18} />
            <div>
              <strong>yt-dlp is not detected.</strong>
              <p>
                Metadata and downloads are disabled until it is available. Development builds can
                use PATH or <code>NXF_YTDLP_PATH</code>; release builds will bundle verified tools.
              </p>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={onOpenSettings}
              >
                Open diagnostics
              </button>
            </div>
          </div>
        ) : null}

        <form
          className="url-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleFetch()
          }}
        >
          <label className="sr-only" htmlFor="youtube-url">
            YouTube video URL
          </label>
          <div className="url-input-wrap">
            <Icon name="download" size={18} />
            <input
              id="youtube-url"
              className="text-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a YouTube video link"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                if (preview) setPreview(null)
                if (error) setError(null)
              }}
              aria-invalid={Boolean(urlError)}
              aria-describedby={urlError ? 'youtube-url-error' : undefined}
            />
          </div>
          <button type="submit" className="button button--primary" disabled={!canFetch}>
            {fetching ? 'Fetching…' : 'Fetch details'}
          </button>
          {preview || fetching ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={preview ? handleClear : handleCancelFetch}
            >
              {preview ? 'Clear' : 'Cancel'}
            </button>
          ) : null}
        </form>

        {urlError ? (
          <p className="inline-error" id="youtube-url-error" role="alert">
            {urlError}
          </p>
        ) : null}

        {error ? (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" size={18} />
            <div>
              <strong>Could not load video details.</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {fetching ? (
          <div className="loading-panel" role="status">
            <div className="spinner" aria-hidden="true" />
            <div>
              <strong>Fetching video details…</strong>
              <p>Checking the actual formats available for this video.</p>
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="preview-layout">
            <div className="preview-card">
              <div className="preview-thumb">
                {preview.video.thumbnailUrl ? (
                  <img
                    src={preview.video.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Icon name="download" size={28} />
                )}
              </div>
              <div className="preview-copy">
                <div className="preview-badges">
                  <span className="badge badge--accent">YouTube</span>
                  {has4k ? <span className="badge badge--success">4K available</span> : null}
                </div>
                <h3>{preview.video.title}</h3>
                <p className="preview-meta">
                  {preview.video.channel ?? 'Unknown channel'} ·{' '}
                  {formatDuration(preview.video.durationSeconds)} ·{' '}
                  {formatUploadDate(preview.video.uploadDate)}
                </p>
                <p className="preview-source" title={preview.video.canonicalUrl}>
                  {preview.video.canonicalUrl}
                </p>
              </div>
            </div>

            <div className="format-panel">
              <div className="format-panel-heading">
                <div>
                  <h3>Choose quality</h3>
                  <p>Quality-first: actual formats only, capped at 2160p.</p>
                </div>
                <span className={`badge ${has4k ? 'badge--success' : 'badge--neutral'}`}>
                  {has4k
                    ? '4K available'
                    : maxVideoHeight > 0
                      ? `Max ${maxVideoHeight}p`
                      : 'No video'}
                </span>
              </div>

              {maxVideoHeight > 0 && !has4k ? (
                <p className="format-availability-note">
                  4K was not reported for this video. Showing the actual formats up to{' '}
                  {maxVideoHeight}p.
                </p>
              ) : null}

              {preview.bestUpTo4k ? (
                <label
                  className={`best-choice${selection.mode === 'best-up-to-4k' ? ' best-choice--selected' : ''}`}
                >
                  <input
                    className="radio-input"
                    type="radio"
                    name="youtube-format"
                    checked={selection.mode === 'best-up-to-4k'}
                    onChange={() => setSelection({ mode: 'best-up-to-4k' })}
                  />
                  <span className="best-choice-body">
                    <span className="best-choice-title">
                      Best available up to 4K
                      <span className="badge badge--accent">Recommended</span>
                    </span>
                    <span className="best-choice-meta">
                      {joinMetaParts([
                        preview.bestUpTo4k.resolutionLabel,
                        preview.bestUpTo4k.predictedContainer.toUpperCase(),
                        formatReportedSize(preview.bestUpTo4k.estimatedBytes),
                      ])}
                    </span>
                    {preview.bestUpTo4k.requiresFfmpeg ? (
                      <span className="best-choice-note">
                        Adaptive video · audio added automatically
                      </span>
                    ) : null}
                  </span>
                </label>
              ) : null}

              <div className="format-list" role="radiogroup" aria-label="Video formats">
                {videoFormats.map((format) => {
                  const selected =
                    selection.mode === 'video' && selection.videoFormatId === format.formatId
                  return (
                    <label
                      className={`format-row${selected ? ' format-row--selected' : ''}`}
                      key={format.formatId}
                    >
                      <input
                        className="radio-input"
                        type="radio"
                        name="youtube-format"
                        checked={selected}
                        onChange={() =>
                          setSelection({ mode: 'video', videoFormatId: format.formatId })
                        }
                      />
                      <span className="format-resolution">
                        {formatResolution(format.width, format.height)}
                      </span>
                      <span className="format-main">
                        <span className="format-title">{format.resolutionLabel}</span>
                        <span className="format-sub">
                          {format.ext.toUpperCase()} · {formatDetail(format)}
                        </span>
                      </span>
                      <FormatBadges format={format} />
                      <span className="format-size">
                        {format.sizeBytes === null ? null : formatBytes(format.sizeBytes)}
                      </span>
                    </label>
                  )
                })}
              </div>

              <p className="format-note">
                Adaptive video · audio added automatically. Sizes appear when YouTube reports them;
                the actual size is confirmed after download.
              </p>

              {preview.audioOnlyAvailable && audioFormats.length > 0 ? (
                <div className="audio-section">
                  <h4>Audio only</h4>
                  <div className="format-list" role="radiogroup" aria-label="Audio formats">
                    {audioFormats.map((format) => {
                      const selected =
                        selection.mode === 'audio' && selection.audioFormatId === format.formatId
                      return (
                        <label
                          className={`format-row${selected ? ' format-row--selected' : ''}`}
                          key={format.formatId}
                        >
                          <input
                            className="radio-input"
                            type="radio"
                            name="youtube-format"
                            checked={selected}
                            onChange={() =>
                              setSelection({ mode: 'audio', audioFormatId: format.formatId })
                            }
                          />
                          <span className="format-resolution">Audio</span>
                          <span className="format-main">
                            <span className="format-title">
                              {formatCodec(format.audioCodec)} · {format.ext.toUpperCase()}
                            </span>
                            <span className="format-sub">
                              {format.bitrateKbps !== null
                                ? `${Math.round(format.bitrateKbps)} kbps`
                                : 'Bitrate unknown'}
                            </span>
                          </span>
                          <FormatBadges format={format} />
                          <span className="format-size">
                            {format.sizeBytes === null ? null : formatBytes(format.sizeBytes)}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="format-note">
                  No separate audio-only format was reported for this video.
                </p>
              )}

              {!preview.bestUpTo4k && videoFormats.length === 0 ? (
                <div className="notice notice--warning">
                  <Icon name="alert" size={18} />
                  <p>No eligible video format at or below 2160p is available.</p>
                </div>
              ) : null}

              <p className="quality-note">
                Quality wins over container compatibility. True 4K may produce MKV/WebM; manual MP4
                selections remain available when the codecs support them.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div className="download-action-bar">
          <div className="download-action-summary">
            <span className="eyebrow">Ready to download</span>
            <span className="download-action-title">{selectedSummary}</span>
            <span className="download-action-note">
              {selectedAdaptive
                ? 'Adaptive video · audio added automatically'
                : selection.mode === 'audio'
                  ? 'Native audio download'
                  : 'Video and audio included'}
            </span>
            <span className="download-action-destination" title={settings.downloadDirectory}>
              To {settings.downloadDirectory}
            </span>
            {dependenciesChecking ? (
              <span className="dependency-warning">Checking runtime dependencies…</span>
            ) : missingDependencies.length > 0 ? (
              <span className="dependency-warning" role="status">
                Missing {missingDependencies.join(', ')}.{' '}
                <button type="button" className="link-button" onClick={onOpenSettings}>
                  Open settings
                </button>
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="button button--primary button--download"
            onClick={() => void handleCreate()}
            disabled={!canDownload}
          >
            {creating ? (
              <span className="button-spinner" aria-hidden="true" />
            ) : (
              <Icon name="download" size={19} />
            )}
            {creating ? 'Starting…' : downloadButtonLabel}
          </button>
        </div>
      ) : null}
    </section>
  )
}
