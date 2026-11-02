import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import type {
  DownloadEngine,
  EngineCapabilities,
  EngineContext,
  EngineMatch,
  EnginePreviewData,
  EngineResult,
  EngineRunContext,
  EngineSelection,
  SourceInput,
} from '@shared/domain/engine'
import type {
  YoutubeBestChoice,
  YoutubePreview,
  YoutubeResolvedSelection,
} from '@shared/domain/youtube'
import { classifyYoutubeInput } from '@shared/domain/youtube-url'
import type { DownloadJob, DownloadSource } from '@shared/domain/job'
import { isAudioOnlyFormat, selectBestUpTo4k } from '@shared/domain/quality'
import { youtubeSelectionSchema } from '@shared/validation/jobs'
import { isPathInside } from '../../services/file-service'
import { ProcessError, runProcess } from '../../services/process-runner'
import { mapYtDlpFailure } from './error-mapper'
import { mapYoutubeFormats } from './format-mapper'
import { MetadataClient } from './metadata-client'
import { resolveYoutubeSelection } from './selection'

type Runner = typeof runProcess

const CAPABILITIES: EngineCapabilities = {
  preview: true,
  selectableFormats: true,
  audioOnly: true,
  pauseResume: false,
  resumeAfterRestart: false,
  checksumVerification: false,
  seeding: false,
  liveSpeed: true,
  eta: true,
  peerStats: false,
  parallelFragmentDownloads: true,
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function nonNegative(value: unknown): number | null {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? number : null
}

function positive(value: unknown): number | null {
  const number = finiteNumber(value)
  return number !== null && number > 0 ? number : null
}

async function findLargestOutput(workspace: string): Promise<string> {
  const entries = await readdir(workspace, { withFileTypes: true })
  let best: { path: string; size: number } | null = null

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (
      lower.endsWith('.part') ||
      lower.endsWith('.ytdl') ||
      lower.endsWith('.temp') ||
      lower.endsWith('.json') ||
      lower.endsWith('.vtt') ||
      lower.endsWith('.srt') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp')
    ) {
      continue
    }

    const path = join(workspace, entry.name)
    const info = await stat(path)
    if (info.size > 0 && (!best || info.size > best.size)) {
      best = { path, size: info.size }
    }
  }

  if (!best) {
    throw new DomainError(
      'PROCESSING_FAILED',
      'The download finished but no output file was found.',
      true,
    )
  }
  return best.path
}

interface StreamProgress {
  downloadedBytes: number
  totalBytes: number | null
  finished: boolean
}

/**
 * yt-dlp reports progress per output stream, so a video+audio download would
 * otherwise reset the percentage when the second stream starts. Seed the known
 * selected streams (and their sizes when reported) so progress can be summed
 * from the first byte.
 */
function seedStreamProgress(details: EngineSelection['details']): Map<string, StreamProgress> {
  const streams = new Map<string, StreamProgress>()
  if (!details) return streams

  for (const summary of [details.selectedVideo, details.selectedAudio]) {
    if (!summary) continue
    streams.set(summary.formatId, {
      downloadedBytes: 0,
      totalBytes: summary.sizeBytes,
      finished: false,
    })
  }
  return streams
}

export class YoutubeEngine implements DownloadEngine {
  readonly id = 'youtube'
  readonly displayName = 'YouTube'
  readonly capabilities = CAPABILITIES

  private readonly metadataClient: MetadataClient

  constructor(private readonly runner: Runner = runProcess) {
    this.metadataClient = new MetadataClient(runner)
  }

  match(input: SourceInput): EngineMatch | null {
    if (input.kind !== 'text') return null
    const classification = classifyYoutubeInput(input.value)
    if (!classification) return null
    if (classification.kind === 'unsupported') {
      return { kind: 'unsupported', reason: classification.reason, priority: 100 }
    }
    return { kind: 'supported', source: classification.source, priority: 100 }
  }

  async preview(source: DownloadSource, ctx: EngineContext): Promise<EnginePreviewData> {
    const raw = await this.metadataClient.fetch(source, ctx)
    const formats = mapYoutubeFormats(raw.formats)
    if (formats.length === 0) {
      throw new DomainError(
        'FORMAT_UNAVAILABLE',
        'No downloadable formats at or below 2160p were found for this video.',
      )
    }

    const choice = selectBestUpTo4k(formats)
    let bestUpTo4k: YoutubeBestChoice | null = null
    if (choice?.video) {
      bestUpTo4k = {
        videoFormatId: choice.video.formatId,
        audioFormatId: choice.audio?.formatId ?? null,
        requiresFfmpeg: choice.requiresFfmpeg,
        estimatedBytes: choice.estimatedBytes,
        predictedContainer: choice.predictedContainer,
        resolutionLabel: choice.video.resolutionLabel,
      }
    }

    const preview: YoutubePreview = {
      video: raw.info,
      formats,
      bestUpTo4k,
      audioOnlyAvailable: formats.some(isAudioOnlyFormat),
    }

    return {
      engineId: this.id,
      source,
      title: raw.info.title,
      subtitle: raw.info.channel,
      thumbnailUrl: raw.info.thumbnailUrl,
      durationSeconds: raw.info.durationSeconds,
      data: preview,
    }
  }

  resolveSelection(preview: EnginePreviewData, selection: unknown): EngineSelection {
    const parsedSelection = youtubeSelectionSchema.safeParse(selection)
    if (!parsedSelection.success) {
      throw new DomainError('INVALID_REQUEST', 'The selected download format is invalid.')
    }
    const youtubePreview = preview.data as YoutubePreview
    return resolveYoutubeSelection(youtubePreview, parsedSelection.data)
  }

  async start(job: DownloadJob, ctx: EngineRunContext): Promise<EngineResult> {
    const selection = ctx.selection.data as YoutubeResolvedSelection
    if (!selection?.selector || selection.formatIds.length === 0) {
      throw new DomainError('INVALID_REQUEST', 'The download selection is invalid.')
    }

    const ytDlp = ctx.dependencies.resolve('yt-dlp')
    if (!ytDlp) {
      throw new DomainError(
        'DEPENDENCY_MISSING',
        'yt-dlp was not found. Install it or use a release build with bundled tools.',
      )
    }

    const ffmpeg = selection.requiresFfmpeg ? ctx.dependencies.resolve('ffmpeg') : null
    if (selection.requiresFfmpeg && !ffmpeg) {
      throw new DomainError(
        'DEPENDENCY_MISSING',
        'FFmpeg is required to merge the selected video and audio streams.',
      )
    }

    let finalPath: string | null = null
    let sawProcessing = false

    const emitProcessing = (): void => {
      if (sawProcessing) return
      sawProcessing = true
      ctx.emit({ type: 'phase', phase: 'processing' })
    }

    const streams = seedStreamProgress(ctx.selection.details)
    const selectedFormatIds = new Set(selection.formatIds)

    const handleProgress = (formatId: string | null, progress: Record<string, unknown>): void => {
      const finished = progress.status === 'finished'

      if (formatId) {
        const previous = streams.get(formatId)
        const reportedDownloaded = nonNegative(progress.downloaded_bytes) ?? 0
        // A retried fragment may report a lower byte count; keep the bar stable.
        const downloadedBytes = Math.max(previous?.downloadedBytes ?? 0, reportedDownloaded)
        const totalBytes =
          nonNegative(progress.total_bytes) ??
          nonNegative(progress.total_bytes_estimate) ??
          previous?.totalBytes ??
          null

        streams.set(formatId, {
          downloadedBytes: finished && totalBytes !== null ? totalBytes : downloadedBytes,
          totalBytes,
          finished: finished || previous?.finished === true,
        })
      }

      let downloadedBytes = 0
      let totalBytes: number | null = 0
      for (const stream of streams.values()) {
        downloadedBytes += stream.downloadedBytes
        if (totalBytes !== null) {
          totalBytes = stream.totalBytes === null ? null : totalBytes + stream.totalBytes
        }
      }

      ctx.emit({
        type: 'progress',
        downloadedBytes,
        totalBytes: totalBytes !== null && totalBytes > 0 ? totalBytes : null,
        bytesPerSecond: positive(progress.speed),
        etaSeconds: nonNegative(progress.eta),
      })

      if (
        finished &&
        selectedFormatIds.size > 0 &&
        [...selectedFormatIds].every((id) => streams.get(id)?.finished === true)
      ) {
        emitProcessing()
      }
    }

    const handleStdout = (line: string): void => {
      if (line.startsWith('NXF_PROGRESS ')) {
        try {
          const parsed = JSON.parse(line.slice('NXF_PROGRESS '.length)) as unknown
          if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>
            const progress = record.progress
            if (progress && typeof progress === 'object') {
              handleProgress(
                typeof record.formatId === 'string' && record.formatId.length > 0
                  ? record.formatId
                  : null,
                progress as Record<string, unknown>,
              )
            }
          }
        } catch {
          // Ignore malformed progress output; another progress line may arrive.
        }
        return
      }

      if (line.startsWith('NXF_POSTPROCESS ')) {
        emitProcessing()
        return
      }

      if (line.startsWith('NXF_FILE ')) {
        try {
          const parsed = JSON.parse(line.slice('NXF_FILE '.length)) as unknown
          if (typeof parsed === 'string') finalPath = parsed
        } catch {
          // Fall back to scanning the dedicated workspace.
        }
      }
    }

    const handleStderr = (line: string): void => {
      if (/\[(Merger|VideoConvertor|Fixup)/i.test(line)) emitProcessing()
    }

    const perConnectionRateLimit =
      ctx.maxDownloadRateBytesPerSecond > 0
        ? Math.max(
            1,
            Math.ceil(ctx.maxDownloadRateBytesPerSecond / Math.max(1, ctx.concurrentFragments)),
          )
        : null

    const args = [
      '--ignore-config',
      '--no-playlist',
      '--newline',
      '--progress',
      '--progress-delta',
      '0.5',
      '--progress-template',
      'download:NXF_PROGRESS {"formatId":%(info.format_id)j,"progress":%(progress)j}',
      '--progress-template',
      'postprocess:NXF_POSTPROCESS %(progress)j',
      '--print',
      'after_move:NXF_FILE %(filepath)j',
      '--no-colors',
      '--concurrent-fragments',
      String(ctx.concurrentFragments),
      // yt-dlp applies --limit-rate per fragment connection, so split the
      // per-download cap across the configured connections.
      ...(perConnectionRateLimit !== null ? ['--limit-rate', String(perConnectionRateLimit)] : []),
      '-f',
      selection.selector,
      '--no-overwrites',
      ...(ctx.resume ? ['--continue'] : []),
      ...(selection.requiresFfmpeg
        ? ['--merge-output-format', selection.container === 'mp4' ? 'mp4' : 'mkv']
        : []),
      ...(ffmpeg ? ['--ffmpeg-location', dirname(ffmpeg.path)] : []),
      '-P',
      `home:${ctx.workspaceDir}`,
      '-P',
      `temp:${ctx.workspaceDir}`,
      '-o',
      '%(id)s.%(ext)s',
      '--socket-timeout',
      '30',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      job.source.kind === 'youtube' ? job.source.canonicalUrl : '',
    ]

    ctx.emit({ type: 'phase', phase: 'downloading' })

    let result
    try {
      result = await this.runner({
        executable: ytDlp.path,
        args,
        timeoutMs: undefined,
        idleTimeoutMs: 90_000,
        maxStdoutBytes: 4 * 1024 * 1024,
        maxStderrBytes: 256 * 1024,
        signal: ctx.signal,
        onStdoutLine: handleStdout,
        onStderrLine: handleStderr,
      })
    } catch (error) {
      if (error instanceof ProcessError) {
        if (error.failure === 'ABORTED') {
          throw new DomainError('CANCELLED', 'Download cancelled.')
        }
        if (error.failure === 'SPAWN') {
          throw new DomainError('DEPENDENCY_MISSING', 'yt-dlp could not be started.')
        }
        throw new DomainError(
          'NETWORK_ERROR',
          'The download timed out or stopped responding. Try again.',
          true,
        )
      }
      throw error
    }

    if (ctx.signal.aborted) {
      throw new DomainError('CANCELLED', 'Download cancelled.')
    }

    if (result.exitCode !== 0) {
      throw mapYtDlpFailure(result.stderr, result.exitCode)
    }

    const candidate = finalPath
      ? isAbsolute(finalPath)
        ? finalPath
        : join(ctx.workspaceDir, finalPath)
      : null
    const outputPath =
      candidate && existsSync(candidate) && isPathInside(ctx.workspaceDir, candidate)
        ? candidate
        : await findLargestOutput(ctx.workspaceDir)

    if (!isPathInside(ctx.workspaceDir, outputPath)) {
      throw new DomainError('FINALIZE_FAILED', 'The output was outside its workspace.')
    }

    const info = await stat(outputPath)
    if (!info.isFile() || info.size === 0) {
      throw new DomainError('PROCESSING_FAILED', 'The downloaded file is empty.', true)
    }

    return {
      output: { kind: 'file', path: outputPath },
      totalBytes: info.size,
    }
  }
}
