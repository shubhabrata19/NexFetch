import { describe, expect, it } from 'vitest'
import type { YoutubeFormat, YoutubePreview } from '@shared/domain/youtube'
import { resolveYoutubeSelection } from '@main/engines/youtube/selection'

function youtubeFormat(overrides: Partial<YoutubeFormat> = {}): YoutubeFormat {
  return {
    formatId: '313',
    width: 3840,
    height: 2160,
    fps: 60,
    ext: 'webm',
    videoCodec: 'vp9',
    audioCodec: null,
    sizeBytes: 500,
    bitrateKbps: 20_000,
    dynamicRange: 'SDR',
    hasVideo: true,
    hasAudio: false,
    label: '2160p60',
    resolutionLabel: '2160p60',
    note: null,
    protocol: 'https',
    ...overrides,
  }
}

const video4k = youtubeFormat()
const h2644k = youtubeFormat({
  formatId: '137',
  ext: 'mp4',
  videoCodec: 'avc1.640033',
  bitrateKbps: 18_000,
  label: '2160p',
  resolutionLabel: '2160p',
})
const audioM4a = youtubeFormat({
  formatId: '140',
  width: null,
  height: null,
  fps: null,
  ext: 'm4a',
  videoCodec: null,
  audioCodec: 'mp4a.40.2',
  bitrateKbps: 128,
  sizeBytes: 10,
  hasVideo: false,
  hasAudio: true,
  label: 'Audio',
  resolutionLabel: 'Audio',
})
const audioOpus = youtubeFormat({
  formatId: '251',
  width: null,
  height: null,
  fps: null,
  ext: 'webm',
  videoCodec: null,
  audioCodec: 'opus',
  bitrateKbps: 160,
  sizeBytes: 12,
  hasVideo: false,
  hasAudio: true,
  label: 'Audio',
  resolutionLabel: 'Audio',
})
const progressive = youtubeFormat({
  formatId: '22',
  width: 1280,
  height: 720,
  fps: 30,
  ext: 'mp4',
  videoCodec: 'avc1',
  audioCodec: 'mp4a',
  hasAudio: true,
  label: '720p',
  resolutionLabel: '720p',
})

function preview(formats: YoutubeFormat[]): YoutubePreview {
  return {
    video: {
      id: 'dQw4w9WgXcQ',
      title: 'Test video: a very long title / with reserved characters?',
      channel: 'Test channel',
      durationSeconds: 120,
      thumbnailUrl: null,
      uploadDate: '2026-01-01',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    },
    formats,
    bestUpTo4k: null,
    audioOnlyAvailable: true,
  }
}

describe('YouTube selection resolution', () => {
  it('resolves best-up-to-4K to exact 4K video and audio streams', () => {
    const selection = resolveYoutubeSelection(
      preview([video4k, h2644k, audioM4a, audioOpus, progressive]),
      { mode: 'best-up-to-4k' },
    )

    expect(selection.data).toMatchObject({
      mode: 'video',
      videoFormatId: '313',
      audioFormatId: '251',
      expectedVideoHeight: 2160,
      requiresFfmpeg: true,
      container: 'mkv',
      selector: '313+251',
      fragmented: false,
    })
    expect(selection.requiredDependencies).toEqual(['yt-dlp', 'ffmpeg', 'ffprobe'])
    expect(selection.verification).toEqual({
      expectedVideoHeight: 2160,
      requireAudio: true,
    })
    expect(selection.details?.selectedVideo?.label).toBe('2160p60')
    expect(selection.filenameBase).toMatch(/\[dQw4w9WgXcQ\]$/)
    expect(selection.filenameBase).not.toMatch(/[/\\?*]/)
  })

  it('marks single-file HTTPS selections as not fragmented', () => {
    const selection = resolveYoutubeSelection(preview([progressive]), {
      mode: 'video',
      videoFormatId: '22',
    })
    expect(selection.data).toMatchObject({ fragmented: false })
  })

  it('marks DASH selections as fragmented', () => {
    const dashVideo = youtubeFormat({
      formatId: '313',
      protocol: 'http_dash_segments',
    })
    const selection = resolveYoutubeSelection(preview([dashVideo, audioOpus]), {
      mode: 'video',
      videoFormatId: '313',
    })
    expect(selection.data).toMatchObject({ fragmented: true })
  })

  it('marks HLS audio-only selections as fragmented', () => {
    const hlsAudio = youtubeFormat({
      formatId: '251',
      width: null,
      height: null,
      fps: null,
      ext: 'webm',
      videoCodec: null,
      audioCodec: 'opus',
      bitrateKbps: 160,
      sizeBytes: 12,
      hasVideo: false,
      hasAudio: true,
      label: 'Audio',
      resolutionLabel: 'Audio',
      protocol: 'm3u8_native',
    })
    const selection = resolveYoutubeSelection(preview([hlsAudio]), {
      mode: 'audio',
      audioFormatId: '251',
    })
    expect(selection.data).toMatchObject({ fragmented: true })
  })

  it('prefers AAC audio for an H.264 video selection', () => {
    const selection = resolveYoutubeSelection(preview([h2644k, audioM4a, audioOpus]), {
      mode: 'video',
      videoFormatId: '137',
    })
    expect(selection.data).toMatchObject({ audioFormatId: '140', container: 'mp4' })
  })

  it('pairs audio automatically for a manual video-only selection', () => {
    const selection = resolveYoutubeSelection(preview([video4k, audioOpus]), {
      mode: 'video',
      videoFormatId: '313',
    })
    expect(selection.data).toMatchObject({
      audioFormatId: '251',
      requiresFfmpeg: true,
      container: 'mkv',
    })
  })

  it('supports a progressive video without FFmpeg', () => {
    const selection = resolveYoutubeSelection(preview([progressive]), {
      mode: 'video',
      videoFormatId: '22',
    })
    expect(selection.data).toMatchObject({
      requiresFfmpeg: false,
      container: 'mp4',
      selector: '22',
    })
    expect(selection.requiredDependencies).toEqual(['yt-dlp', 'ffprobe'])
  })

  it('resolves audio-only without FFmpeg', () => {
    const selection = resolveYoutubeSelection(preview([audioOpus]), {
      mode: 'audio',
      audioFormatId: '251',
    })
    expect(selection.data).toMatchObject({
      mode: 'audio',
      expectedVideoHeight: null,
      requiresFfmpeg: false,
      container: 'webm',
    })
    expect(selection.requiredDependencies).toEqual(['yt-dlp'])
    expect(selection.details?.selectedVideo).toBeNull()
  })

  it('rejects an unknown format ID', () => {
    expect(() =>
      resolveYoutubeSelection(preview([video4k]), {
        mode: 'video',
        videoFormatId: 'missing',
      }),
    ).toThrow(/no longer available/)
  })

  it('rejects selecting an audio format as video', () => {
    expect(() =>
      resolveYoutubeSelection(preview([audioOpus]), {
        mode: 'video',
        videoFormatId: '251',
      }),
    ).toThrow(/actual video format/)
  })
})
