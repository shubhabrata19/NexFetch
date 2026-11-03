import { z } from 'zod'
import { DomainError } from '@shared/domain/errors'
import type { EngineContext } from '@shared/domain/engine'
import type { DownloadSource } from '@shared/domain/job'
import type { YoutubeVideoInfo } from '@shared/domain/youtube'
import { mapYtDlpFailure } from './error-mapper'
import { ProcessError, runProcess } from '../../services/process-runner'

type Runner = typeof runProcess

const numberish = z.union([z.number(), z.string()]).nullish()

export const rawYtDlpFormatSchema = z
  .object({
    format_id: z.string(),
    ext: z.string().nullish(),
    width: numberish,
    height: numberish,
    fps: numberish,
    vcodec: z.string().nullish(),
    acodec: z.string().nullish(),
    filesize: numberish,
    filesize_approx: numberish,
    tbr: numberish,
    abr: numberish,
    vbr: numberish,
    dynamic_range: z.string().nullish(),
    format_note: z.string().nullish(),
    protocol: z.string().nullish(),
    language: z.string().nullish(),
    language_preference: numberish,
  })
  .passthrough()

export type RawYtDlpFormat = z.infer<typeof rawYtDlpFormatSchema>

const rawYtDlpMetadataSchema = z
  .object({
    id: z.string(),
    title: z.string().nullish(),
    channel: z.string().nullish(),
    uploader: z.string().nullish(),
    duration: numberish,
    thumbnail: z.string().nullish(),
    upload_date: z.string().nullish(),
    is_live: z.boolean().nullish(),
    formats: z.array(rawYtDlpFormatSchema).optional(),
  })
  .passthrough()

export interface RawYoutubeMetadata {
  info: YoutubeVideoInfo
  formats: RawYtDlpFormat[]
}

const THUMBNAIL_HOSTS = new Set([
  'i.ytimg.com',
  'img.youtube.com',
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
])

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function safeThumbnail(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.startsWith('//') ? `https:${value}` : value
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !THUMBNAIL_HOSTS.has(url.hostname.toLowerCase())) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

function safeUploadDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  const cleaned = value.trim()
  return cleaned.length > 0 ? cleaned.slice(0, maxLength) : null
}

export class MetadataClient {
  constructor(private readonly runner: Runner = runProcess) {}

  async fetch(source: DownloadSource, ctx: EngineContext): Promise<RawYoutubeMetadata> {
    if (source.kind !== 'youtube') {
      throw new DomainError('INVALID_REQUEST', 'The source is not a YouTube video.')
    }

    const ytDlp = ctx.dependencies.resolve('yt-dlp')
    if (!ytDlp) {
      throw new DomainError(
        'DEPENDENCY_MISSING',
        'yt-dlp was not found. Install it or use a release build with bundled tools.',
      )
    }

    let result
    try {
      result = await this.runner({
        executable: ytDlp.path,
        args: [
          '--ignore-config',
          '--no-playlist',
          '--dump-single-json',
          '--skip-download',
          '--no-progress',
          '--socket-timeout',
          '15',
          '--extractor-retries',
          '2',
          '--retries',
          '2',
          '--no-colors',
          source.canonicalUrl,
        ],
        timeoutMs: 30_000,
        idleTimeoutMs: 20_000,
        maxStdoutBytes: 12 * 1024 * 1024,
        maxStderrBytes: 64 * 1024,
        signal: ctx.signal,
      })
    } catch (error) {
      if (error instanceof ProcessError && error.failure === 'ABORTED') {
        throw new DomainError('CANCELLED', 'Metadata request cancelled.')
      }
      throw new DomainError(
        'NETWORK_ERROR',
        'The video details could not be loaded. Check your connection and try again.',
        true,
      )
    }

    if (result.exitCode !== 0) {
      throw mapYtDlpFailure(result.stderr, result.exitCode)
    }
    if (result.stdoutTruncated) {
      throw new DomainError(
        'EXTRACTOR_ERROR',
        'The video metadata was too large to process safely.',
      )
    }

    let json: unknown
    try {
      json = JSON.parse(result.stdout)
    } catch {
      throw new DomainError('EXTRACTOR_ERROR', 'The video metadata could not be understood.')
    }

    const parsed = rawYtDlpMetadataSchema.safeParse(json)
    if (!parsed.success) {
      throw new DomainError(
        'EXTRACTOR_ERROR',
        'The video metadata did not have the expected shape.',
      )
    }

    const raw = parsed.data
    if (raw.id !== source.videoId) {
      throw new DomainError('EXTRACTOR_ERROR', 'The extracted video did not match the request.')
    }
    if (raw.is_live === true) {
      throw new DomainError('UNSUPPORTED_SOURCE', 'Live streams are not supported yet.')
    }

    const formats = raw.formats ?? []
    if (formats.length === 0) {
      throw new DomainError(
        'FORMAT_UNAVAILABLE',
        'No downloadable formats were reported for this video.',
      )
    }

    const title = cleanText(raw.title, 500) ?? `Video ${source.videoId}`
    const channel = cleanText(raw.channel ?? raw.uploader, 200)
    const duration = finiteNumber(raw.duration)
    const info: YoutubeVideoInfo = {
      id: source.videoId,
      title,
      channel,
      durationSeconds: duration !== null && duration >= 0 ? Math.round(duration) : null,
      thumbnailUrl: safeThumbnail(raw.thumbnail),
      uploadDate: safeUploadDate(raw.upload_date),
      canonicalUrl: source.canonicalUrl,
    }

    return { info, formats }
  }
}
