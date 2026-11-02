import { MAX_HEIGHT } from '@shared/domain/quality'
import type { YoutubeFormat } from '@shared/domain/youtube'
import type { RawYtDlpFormat } from './metadata-client'

const FORMAT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null
}

function dynamicRange(value: string | null | undefined): 'SDR' | 'HDR' | null {
  if (!value) return null
  if (value.toUpperCase().includes('HDR')) return 'HDR'
  if (value.toUpperCase().includes('SDR')) return 'SDR'
  return null
}

function resolutionLabel(height: number | null, fps: number | null): string {
  if (height === null) return 'Audio'
  return `${height}p${fps !== null && fps >= 50 ? Math.round(fps) : ''}`
}

function compareFormats(a: YoutubeFormat, b: YoutubeFormat): number {
  if (a.hasVideo !== b.hasVideo) return a.hasVideo ? -1 : 1
  if (a.hasVideo) {
    return (
      (b.height ?? 0) - (a.height ?? 0) ||
      (b.fps ?? 0) - (a.fps ?? 0) ||
      (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0) ||
      a.formatId.localeCompare(b.formatId)
    )
  }
  return (
    (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0) ||
    (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) ||
    a.formatId.localeCompare(b.formatId)
  )
}

export function mapYoutubeFormats(rawFormats: readonly RawYtDlpFormat[]): YoutubeFormat[] {
  const seen = new Set<string>()
  const mapped: YoutubeFormat[] = []

  for (const raw of rawFormats) {
    if (!FORMAT_ID_PATTERN.test(raw.format_id) || seen.has(raw.format_id)) continue

    const ext = (raw.ext ?? 'bin').toLowerCase()
    const note = raw.format_note?.trim() || null
    if (ext === 'mhtml' || note?.toLowerCase().includes('storyboard')) continue

    const hasVideo = raw.vcodec !== null && raw.vcodec !== undefined && raw.vcodec !== 'none'
    const hasAudio = raw.acodec !== null && raw.acodec !== undefined && raw.acodec !== 'none'
    if (!hasVideo && !hasAudio) continue

    const width = positiveOrNull(numberOrNull(raw.width))
    const height = positiveOrNull(numberOrNull(raw.height))
    const fps = positiveOrNull(numberOrNull(raw.fps))

    // Do not offer an unverifiable video resolution above or without a 4K cap.
    if (hasVideo && (height === null || height > MAX_HEIGHT)) continue

    const sizeBytes =
      positiveOrNull(numberOrNull(raw.filesize)) ??
      positiveOrNull(numberOrNull(raw.filesize_approx))
    const bitrateKbps =
      positiveOrNull(numberOrNull(raw.tbr)) ??
      positiveOrNull(numberOrNull(raw.vbr)) ??
      positiveOrNull(numberOrNull(raw.abr))

    const resolution = resolutionLabel(height, fps)
    const format: YoutubeFormat = {
      formatId: raw.format_id,
      width,
      height,
      fps,
      ext,
      videoCodec: raw.vcodec && raw.vcodec !== 'none' ? raw.vcodec : null,
      audioCodec: raw.acodec && raw.acodec !== 'none' ? raw.acodec : null,
      sizeBytes,
      bitrateKbps,
      dynamicRange: dynamicRange(raw.dynamic_range),
      hasVideo,
      hasAudio,
      label: note ?? resolution,
      resolutionLabel: resolution,
      note,
      protocol: raw.protocol ?? null,
    }

    seen.add(raw.format_id)
    mapped.push(format)
  }

  return mapped.sort(compareFormats)
}
