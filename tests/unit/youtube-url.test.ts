import { describe, expect, it } from 'vitest'
import { classifyYoutubeInput, parseYoutubeUrl } from '@shared/domain/youtube-url'

const VIDEO_ID = 'dQw4w9WgXcQ'
const CANONICAL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

describe('YouTube URL validation', () => {
  it.each([
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`,
    `https://music.youtube.com/watch?v=${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PL123`,
  ])('normalizes supported form %s', (input) => {
    expect(parseYoutubeUrl(input)).toEqual({
      kind: 'youtube',
      videoId: VIDEO_ID,
      canonicalUrl: CANONICAL,
    })
  })

  it('upgrades http links to the canonical https URL', () => {
    expect(parseYoutubeUrl(`http://youtu.be/${VIDEO_ID}`)?.canonicalUrl).toBe(CANONICAL)
  })

  it('rejects playlist-only URLs with an explicit reason', () => {
    const result = classifyYoutubeInput('https://www.youtube.com/playlist?list=PL123')
    expect(result?.kind).toBe('unsupported')
    if (result?.kind === 'unsupported') {
      expect(result.reason).toMatch(/Playlists/)
    }
  })

  it('rejects channel, search, and invalid IDs', () => {
    expect(classifyYoutubeInput('https://www.youtube.com/@somechannel')?.kind).toBe('unsupported')
    expect(classifyYoutubeInput('https://www.youtube.com/results?search_query=test')?.kind).toBe(
      'unsupported',
    )
    expect(classifyYoutubeInput('https://youtu.be/not-an-id')?.kind).toBe('unsupported')
  })

  it('rejects credentials in a YouTube URL', () => {
    const result = classifyYoutubeInput(`https://user:pass@www.youtube.com/watch?v=${VIDEO_ID}`)
    expect(result?.kind).toBe('unsupported')
  })

  it('returns null for non-YouTube URLs', () => {
    expect(classifyYoutubeInput('https://example.com/file.zip')).toBeNull()
    expect(classifyYoutubeInput('not a url')).toBeNull()
  })
})
