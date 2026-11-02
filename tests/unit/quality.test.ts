import { describe, expect, it } from 'vitest'
import type { VideoFormat } from '@shared/domain/quality'
import {
  MAX_HEIGHT,
  isEligibleVideoFormat,
  selectBestAudioOnly,
  selectBestUpTo4k,
  selectBestVideo,
} from '@shared/domain/quality'

function format(overrides: Partial<VideoFormat> = {}): VideoFormat {
  return {
    formatId: '137',
    width: 1920,
    height: 1080,
    fps: 30,
    ext: 'mp4',
    videoCodec: 'avc1.640028',
    audioCodec: 'none',
    sizeBytes: 100,
    bitrateKbps: 4_000,
    dynamicRange: 'SDR',
    hasVideo: true,
    hasAudio: false,
    ...overrides,
  }
}

const audioM4a = format({
  formatId: '140',
  width: null,
  height: null,
  fps: null,
  ext: 'm4a',
  videoCodec: 'none',
  audioCodec: 'mp4a.40.2',
  bitrateKbps: 128,
  sizeBytes: 10,
  hasVideo: false,
  hasAudio: true,
})

const audioOpus = format({
  formatId: '251',
  width: null,
  height: null,
  fps: null,
  ext: 'webm',
  videoCodec: 'none',
  audioCodec: 'opus',
  bitrateKbps: 160,
  sizeBytes: 12,
  hasVideo: false,
  hasAudio: true,
})

describe('4K quality policy', () => {
  it('caps eligible video at 2160p and excludes 8K', () => {
    const eightK = format({ formatId: '4320', height: 4320, width: 7680, sizeBytes: 900 })
    const fourK = format({ formatId: '2160', height: 2160, width: 3840, sizeBytes: 500 })

    expect(isEligibleVideoFormat(eightK)).toBe(false)
    expect(isEligibleVideoFormat(fourK)).toBe(true)
    expect(selectBestVideo([eightK, fourK])?.formatId).toBe('2160')
    expect(MAX_HEIGHT).toBe(2160)
  })

  it('prefers higher FPS at the same resolution', () => {
    const thirty = format({ formatId: '30', height: 2160, width: 3840, fps: 30 })
    const sixty = format({ formatId: '60', height: 2160, width: 3840, fps: 60 })
    expect(selectBestVideo([thirty, sixty])?.formatId).toBe('60')
  })

  it('prefers SDR over HDR when resolution and FPS tie', () => {
    const hdr = format({
      formatId: 'hdr',
      height: 2160,
      width: 3840,
      dynamicRange: 'HDR',
      bitrateKbps: 12_000,
    })
    const sdr = format({
      formatId: 'sdr',
      height: 2160,
      width: 3840,
      dynamicRange: 'SDR',
      bitrateKbps: 10_000,
    })
    expect(selectBestVideo([hdr, sdr])?.formatId).toBe('sdr')
  })

  it('does not offer video formats with unknown height', () => {
    const unknown = format({ formatId: 'unknown', height: null, width: null })
    expect(selectBestVideo([unknown])).toBeNull()
  })

  it('pairs 4K video-only with audio and requires FFmpeg', () => {
    const video = format({
      formatId: '313',
      height: 2160,
      width: 3840,
      fps: 60,
      ext: 'webm',
      videoCodec: 'vp9',
      bitrateKbps: 20_000,
      sizeBytes: 500,
    })

    const choice = selectBestUpTo4k([video, audioM4a, audioOpus])
    expect(choice?.video?.formatId).toBe('313')
    expect(choice?.audio?.formatId).toBe('251')
    expect(choice?.requiresFfmpeg).toBe(true)
    expect(choice?.estimatedBytes).toBe(512)
    expect(choice?.predictedContainer).toBe('mkv')
  })

  it('prefers AAC audio for H.264 video to preserve MP4 compatibility', () => {
    const video = format({
      formatId: '137',
      height: 2160,
      width: 3840,
      videoCodec: 'avc1.640033',
      sizeBytes: 500,
    })

    const choice = selectBestUpTo4k([video, audioM4a, audioOpus])
    expect(choice?.audio?.formatId).toBe('140')
    expect(choice?.predictedContainer).toBe('mp4')
  })

  it('falls back to a progressive format when no audio-only stream exists', () => {
    const progressive = format({
      formatId: '22',
      height: 720,
      width: 1280,
      ext: 'mp4',
      videoCodec: 'avc1',
      audioCodec: 'mp4a',
      hasAudio: true,
      sizeBytes: 200,
    })

    const choice = selectBestUpTo4k([progressive])
    expect(choice?.video?.formatId).toBe('22')
    expect(choice?.audio).toBeNull()
    expect(choice?.requiresFfmpeg).toBe(false)
  })

  it('reports unknown combined size when either stream size is unknown', () => {
    const video = format({ height: 2160, width: 3840, sizeBytes: null })
    const audio = format({
      ...audioOpus,
      formatId: '251',
      sizeBytes: null,
    })

    const choice = selectBestUpTo4k([video, audio])
    expect(choice?.estimatedBytes).toBeNull()
  })

  it('selects the best audio-only format', () => {
    const choice = selectBestAudioOnly([audioM4a, audioOpus])
    expect(choice?.mode).toBe('audio')
    expect(choice?.audio?.formatId).toBe('251')
    expect(choice?.video).toBeNull()
  })

  it('prefers original-language audio over a higher-bitrate dub', () => {
    const dubbed = format({
      ...audioOpus,
      formatId: '251-0',
      bitrateKbps: 200,
      sizeBytes: 20,
      languagePreference: -1,
    })
    const original = format({
      ...audioM4a,
      formatId: '140-20',
      bitrateKbps: 128,
      languagePreference: 10,
    })

    expect(selectBestAudioOnly([dubbed, original])?.audio?.formatId).toBe('140-20')
  })

  it('pairs the original-language audio with an H.264 video', () => {
    const video = format({
      formatId: '137',
      height: 2160,
      width: 3840,
      videoCodec: 'avc1.640033',
      sizeBytes: 500,
    })
    const dubbed = format({
      ...audioM4a,
      formatId: '140-0',
      bitrateKbps: 192,
      languagePreference: -1,
    })
    const original = format({
      ...audioM4a,
      formatId: '140-20',
      bitrateKbps: 128,
      languagePreference: 10,
    })

    const choice = selectBestUpTo4k([video, dubbed, original])
    expect(choice?.audio?.formatId).toBe('140-20')
    expect(choice?.predictedContainer).toBe('mp4')
  })

  it('returns null when there is no eligible video', () => {
    const eightK = format({ height: 4320, width: 7680 })
    expect(selectBestUpTo4k([eightK, audioM4a])).toBeNull()
  })
})
