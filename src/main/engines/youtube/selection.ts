import { DomainError } from '@shared/domain/errors'
import type { EngineSelection } from '@shared/domain/engine'
import type { FormatSummary, YoutubeJobDetails } from '@shared/domain/job'
import { MAX_HEIGHT, selectBestAudio, selectBestUpTo4k } from '@shared/domain/quality'
import type {
  YoutubeFormat,
  YoutubePreview,
  YoutubeResolvedSelection,
  YoutubeSelection,
} from '@shared/domain/youtube'
import { sanitizeFilenameBase } from '@shared/security/filename'

function summary(format: YoutubeFormat): FormatSummary {
  return {
    formatId: format.formatId,
    label: format.resolutionLabel,
    ext: format.ext,
    sizeBytes: format.sizeBytes,
  }
}

function isH264(format: YoutubeFormat): boolean {
  const codec = format.videoCodec?.toLowerCase() ?? ''
  return codec.includes('avc') || codec.includes('h264')
}

function findFormat(preview: YoutubePreview, formatId: string): YoutubeFormat {
  const format = preview.formats.find((candidate) => candidate.formatId === formatId)
  if (!format) {
    throw new DomainError(
      'FORMAT_UNAVAILABLE',
      'The selected format is no longer available. Fetch the video details again.',
    )
  }
  return format
}

function pairAudio(
  preview: YoutubePreview,
  video: YoutubeFormat,
  requestedAudioId?: string,
): YoutubeFormat {
  if (requestedAudioId) {
    const requested = findFormat(preview, requestedAudioId)
    if (!requested.hasAudio || requested.hasVideo) {
      throw new DomainError('INVALID_REQUEST', 'The selected audio format is not audio-only.')
    }
    return requested
  }

  const audio = isH264(video)
    ? selectBestAudio(preview.formats, ['m4a', 'mp4', 'aac'])
    : selectBestAudio(preview.formats)

  if (!audio) {
    throw new DomainError(
      'FORMAT_UNAVAILABLE',
      'No compatible audio stream was available for the selected video.',
    )
  }
  return audio
}

function containerFor(video: YoutubeFormat, audio: YoutubeFormat | null): string {
  if (!audio) return video.ext

  const compatible = isH264(video) && ['m4a', 'mp4', 'aac'].includes(audio.ext.toLowerCase())
  return compatible ? 'mp4' : 'mkv'
}

function buildSelection(
  preview: YoutubePreview,
  mode: 'video' | 'audio',
  video: YoutubeFormat | null,
  audio: YoutubeFormat | null,
  requiresFfmpeg: boolean,
  container: string,
): EngineSelection {
  const formatIds = [video?.formatId, audio?.formatId].filter(
    (value): value is string => typeof value === 'string',
  )
  const resolved: YoutubeResolvedSelection = {
    mode,
    videoFormatId: video?.formatId ?? null,
    audioFormatId: audio?.formatId ?? null,
    expectedVideoHeight: video?.height ?? null,
    requiresFfmpeg,
    container,
    selector: formatIds.join('+'),
    formatIds,
  }

  const details: YoutubeJobDetails = {
    engineId: 'youtube',
    videoId: preview.video.id,
    channel: preview.video.channel,
    selectedVideo: video ? summary(video) : null,
    selectedAudio: audio ? summary(audio) : null,
    container,
  }

  return {
    engineId: 'youtube',
    data: resolved,
    requiredDependencies: [
      'yt-dlp',
      ...(requiresFfmpeg ? (['ffmpeg'] as const) : []),
      ...(mode === 'video' ? (['ffprobe'] as const) : []),
    ],
    filenameBase: `${sanitizeFilenameBase(preview.video.title)} [${preview.video.id}]`,
    details,
    verification: {
      expectedVideoHeight: video?.height ?? null,
      requireAudio: true,
    },
  }
}

export function resolveYoutubeSelection(
  preview: YoutubePreview,
  selection: YoutubeSelection,
): EngineSelection {
  if (selection.mode === 'best-up-to-4k') {
    const choice = selectBestUpTo4k(preview.formats)
    if (!choice?.video) {
      throw new DomainError(
        'FORMAT_UNAVAILABLE',
        'No video format at or below 2160p is available for this video.',
      )
    }
    return buildSelection(
      preview,
      'video',
      choice.video,
      choice.audio,
      choice.requiresFfmpeg,
      choice.predictedContainer,
    )
  }

  if (selection.mode === 'audio') {
    const audio = findFormat(preview, selection.audioFormatId)
    if (!audio.hasAudio || audio.hasVideo) {
      throw new DomainError('INVALID_REQUEST', 'The selected format is not audio-only.')
    }
    return buildSelection(preview, 'audio', null, audio, false, audio.ext)
  }

  const video = findFormat(preview, selection.videoFormatId)
  if (!video.hasVideo || video.height === null || video.height > MAX_HEIGHT) {
    throw new DomainError('INVALID_REQUEST', 'Select an actual video format at or below 2160p.')
  }

  if (video.hasAudio) {
    return buildSelection(preview, 'video', video, null, false, video.ext)
  }

  const audio = pairAudio(preview, video, selection.audioFormatId)
  return buildSelection(preview, 'video', video, audio, true, containerFor(video, audio))
}
