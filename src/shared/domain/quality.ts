/**
 * Quality-first format policy.
 *
 * This module is intentionally protocol-neutral. It consumes normalized format
 * metadata and returns the exact streams NexFetch will request, so the UI and
 * engine cannot silently disagree about what "best up to 4K" means.
 */

export const MAX_HEIGHT = 2160

export interface VideoFormat {
  formatId: string
  width: number | null
  height: number | null
  fps: number | null
  ext: string
  videoCodec: string | null
  audioCodec: string | null
  sizeBytes: number | null
  bitrateKbps: number | null
  dynamicRange: 'SDR' | 'HDR' | null
  hasVideo: boolean
  hasAudio: boolean
}

export interface QualityPolicyOptions {
  /**
   * When two otherwise equal 4K streams exist, prefer SDR for broad playback
   * compatibility. HDR is still selected when it is the only 4K option.
   */
  preferSdr?: boolean
}

export interface QualityChoice<TFormat extends VideoFormat = VideoFormat> {
  mode: 'video' | 'audio'
  video: TFormat | null
  audio: TFormat | null
  requiresFfmpeg: boolean
  estimatedBytes: number | null
  predictedContainer: string
}

function normalizedFps(format: VideoFormat): number {
  return format.fps ?? 0
}

function normalizedBitrate(format: VideoFormat): number {
  return format.bitrateKbps ?? 0
}

function normalizedHeight(format: VideoFormat): number {
  return format.height ?? 0
}

function isH264(format: VideoFormat): boolean {
  const codec = format.videoCodec?.toLowerCase() ?? ''
  return codec.includes('avc') || codec.includes('h264')
}

function rankSdr(format: VideoFormat, preferSdr: boolean): number {
  if (!preferSdr || format.dynamicRange !== 'HDR') return 0
  return 1
}

function compareVideo(a: VideoFormat, b: VideoFormat, preferSdr: boolean): number {
  return (
    normalizedHeight(b) - normalizedHeight(a) ||
    normalizedFps(b) - normalizedFps(a) ||
    rankSdr(a, preferSdr) - rankSdr(b, preferSdr) ||
    normalizedBitrate(b) - normalizedBitrate(a) ||
    a.formatId.localeCompare(b.formatId)
  )
}

function compareAudio(
  a: VideoFormat,
  b: VideoFormat,
  preferredExtensions: readonly string[],
): number {
  const aPreferred = preferredExtensions.includes(a.ext) ? 1 : 0
  const bPreferred = preferredExtensions.includes(b.ext) ? 1 : 0
  return (
    bPreferred - aPreferred ||
    normalizedBitrate(b) - normalizedBitrate(a) ||
    (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) ||
    a.formatId.localeCompare(b.formatId)
  )
}

export function isEligibleVideoFormat(format: VideoFormat): boolean {
  return (
    format.hasVideo && format.height !== null && format.height > 0 && format.height <= MAX_HEIGHT
  )
}

export function isAudioOnlyFormat(format: VideoFormat): boolean {
  return format.hasAudio && !format.hasVideo
}

export function selectBestVideo<TFormat extends VideoFormat>(
  formats: readonly TFormat[],
  options: QualityPolicyOptions = {},
): TFormat | null {
  const preferSdr = options.preferSdr ?? true
  const candidates = formats.filter(isEligibleVideoFormat)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => compareVideo(a, b, preferSdr))[0] ?? null
}

export function selectBestProgressive<TFormat extends VideoFormat>(
  formats: readonly TFormat[],
  options: QualityPolicyOptions = {},
): TFormat | null {
  const preferSdr = options.preferSdr ?? true
  const candidates = formats.filter((format) => isEligibleVideoFormat(format) && format.hasAudio)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => compareVideo(a, b, preferSdr))[0] ?? null
}

export function selectBestAudio<TFormat extends VideoFormat>(
  formats: readonly TFormat[],
  preferredExtensions: readonly string[] = [],
): TFormat | null {
  const candidates = formats.filter(isAudioOnlyFormat)
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => compareAudio(a, b, preferredExtensions))[0] ?? null
}

function sumKnown(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return a + b
}

function predictContainer(video: VideoFormat, audio: VideoFormat | null): string {
  if (!audio || video.hasAudio) return video.ext

  // MP4 is chosen only when both streams are broadly MP4-compatible. Quality
  // is unaffected by remuxing; MKV is the honest default for VP9/AV1/Opus.
  const videoCodec = video.videoCodec?.toLowerCase() ?? ''
  const videosAreH264 = videoCodec.includes('avc') || videoCodec.includes('h264')
  const audioIsMp4Compatible = ['m4a', 'mp4', 'aac'].includes(audio.ext)
  return videosAreH264 && audioIsMp4Compatible ? 'mp4' : 'mkv'
}

export function selectBestUpTo4k<TFormat extends VideoFormat>(
  formats: readonly TFormat[],
  options: QualityPolicyOptions = {},
): QualityChoice<TFormat> | null {
  const video = selectBestVideo(formats, options)
  if (!video) return null

  if (video.hasAudio) {
    return {
      mode: 'video',
      video,
      audio: null,
      requiresFfmpeg: false,
      estimatedBytes: video.sizeBytes,
      predictedContainer: video.ext,
    }
  }

  const audio = isH264(video)
    ? selectBestAudio(formats, ['m4a', 'mp4', 'aac'])
    : selectBestAudio(formats)

  if (audio) {
    return {
      mode: 'video',
      video,
      audio,
      requiresFfmpeg: true,
      estimatedBytes: sumKnown(video.sizeBytes, audio.sizeBytes),
      predictedContainer: predictContainer(video, audio),
    }
  }

  const progressive = selectBestProgressive(formats, options)
  if (!progressive) return null

  return {
    mode: 'video',
    video: progressive,
    audio: null,
    requiresFfmpeg: false,
    estimatedBytes: progressive.sizeBytes,
    predictedContainer: progressive.ext,
  }
}

export function selectBestAudioOnly<TFormat extends VideoFormat>(
  formats: readonly TFormat[],
): QualityChoice<TFormat> | null {
  const audio = selectBestAudio(formats)
  if (!audio) return null
  return {
    mode: 'audio',
    video: null,
    audio,
    requiresFfmpeg: false,
    estimatedBytes: audio.sizeBytes,
    predictedContainer: audio.ext,
  }
}
