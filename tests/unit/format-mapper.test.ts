import { describe, expect, it } from 'vitest'
import { mapYoutubeFormats } from '@main/engines/youtube/format-mapper'
import type { RawYtDlpFormat } from '@main/engines/youtube/metadata-client'

function raw(overrides: Partial<RawYtDlpFormat> = {}): RawYtDlpFormat {
  return {
    format_id: '137',
    ext: 'mp4',
    width: 3840,
    height: 2160,
    fps: 60,
    vcodec: 'avc1.640033',
    acodec: 'none',
    filesize: 500,
    filesize_approx: null,
    tbr: 20_000,
    abr: null,
    vbr: null,
    dynamic_range: 'SDR',
    format_note: null,
    protocol: 'https',
    ...overrides,
  }
}

describe('YouTube format mapper', () => {
  it('drops formats above 2160p and keeps actual 4K formats', () => {
    const formats = mapYoutubeFormats([
      raw({ format_id: '4320', height: 4320, width: 7680 }),
      raw({ format_id: '2160', height: 2160, width: 3840 }),
      raw({ format_id: '1440', height: 1440, width: 2560 }),
      raw({ format_id: '1080', height: 1080, width: 1920 }),
    ])

    expect(formats.map((format) => format.formatId)).toEqual(['2160', '1440', '1080'])
    expect(formats[0]?.height).toBe(2160)
  })

  it('keeps audio-only formats and sorts video before audio', () => {
    const formats = mapYoutubeFormats([
      raw({
        format_id: '251',
        ext: 'webm',
        width: null,
        height: null,
        fps: null,
        vcodec: 'none',
        acodec: 'opus',
        tbr: null,
        abr: 160,
        filesize: 12,
      }),
      raw({ format_id: '137', height: 2160, width: 3840 }),
    ])

    expect(formats[0]?.formatId).toBe('137')
    expect(formats[1]?.formatId).toBe('251')
    expect(formats[1]?.hasVideo).toBe(false)
    expect(formats[1]?.hasAudio).toBe(true)
    expect(formats[1]?.resolutionLabel).toBe('Audio')
  })

  it('drops storyboards, image formats, invalid IDs, and unknown-height video', () => {
    const formats = mapYoutubeFormats([
      raw({ format_id: 'sb0', ext: 'mhtml', format_note: 'storyboard' }),
      raw({ format_id: 'bad.id', height: 1080, width: 1920 }),
      raw({ format_id: 'unknown-height', height: null, width: null }),
      raw({ format_id: 'valid', height: 1080, width: 1920 }),
    ])

    expect(formats.map((format) => format.formatId)).toEqual(['valid'])
  })

  it('marks HDR and preserves size/bitrate estimates', () => {
    const [format] = mapYoutubeFormats([
      raw({ dynamic_range: 'HDR', filesize: null, filesize_approx: 1234, tbr: null, vbr: 5000 }),
    ])

    expect(format?.dynamicRange).toBe('HDR')
    expect(format?.sizeBytes).toBe(1234)
    expect(format?.bitrateKbps).toBe(5000)
  })

  it('deduplicates repeated format IDs', () => {
    const formats = mapYoutubeFormats([
      raw({ format_id: '137' }),
      raw({ format_id: '137', height: 1080 }),
    ])
    expect(formats).toHaveLength(1)
    expect(formats[0]?.height).toBe(2160)
  })

  it('keeps audio-track language and language preference', () => {
    const formats = mapYoutubeFormats([
      raw({
        format_id: '251-20',
        ext: 'webm',
        width: null,
        height: null,
        fps: null,
        vcodec: 'none',
        acodec: 'opus',
        tbr: null,
        abr: 160,
        language: 'en',
        language_preference: 10,
        format_note: 'English original (default), medium',
      }),
      raw({
        format_id: '251-0',
        ext: 'webm',
        width: null,
        height: null,
        fps: null,
        vcodec: 'none',
        acodec: 'opus',
        tbr: null,
        abr: 160,
        language: 'hi',
        language_preference: -1,
        format_note: 'Hindi, medium',
      }),
    ])

    const original = formats.find((format) => format.formatId === '251-20')
    const dubbed = formats.find((format) => format.formatId === '251-0')

    expect(original?.language).toBe('en')
    expect(original?.languagePreference).toBe(10)
    expect(dubbed?.language).toBe('hi')
    expect(dubbed?.languagePreference).toBe(-1)
  })

  it('ignores malformed language codes', () => {
    const [format] = mapYoutubeFormats([
      raw({
        format_id: '140',
        ext: 'm4a',
        width: null,
        height: null,
        fps: null,
        vcodec: 'none',
        acodec: 'mp4a.40.2',
        tbr: null,
        abr: 128,
        language: 'not a code',
      }),
    ])
    expect(format?.language).toBeNull()
  })
})
