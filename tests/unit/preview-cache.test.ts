import { describe, expect, it } from 'vitest'
import type { EnginePreviewData } from '@shared/domain/engine'
import { PreviewCache } from '@main/download/preview-cache'

const preview: EnginePreviewData = {
  engineId: 'youtube',
  source: {
    kind: 'youtube',
    videoId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  },
  title: 'Test',
  subtitle: null,
  thumbnailUrl: null,
  durationSeconds: 10,
  data: {},
}

describe('preview cache', () => {
  it('stores and retrieves previews by opaque token', () => {
    const cache = new PreviewCache(60_000, 2)
    const token = cache.put(preview)
    expect(token.token).toHaveLength(36)
    expect(cache.get(token.token)).toBe(preview)
  })

  it('expires previews after the TTL', async () => {
    const cache = new PreviewCache(10, 2)
    const token = cache.put(preview)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(cache.get(token.token)).toBeNull()
  })

  it('evicts old previews when the cache is full', () => {
    const cache = new PreviewCache(60_000, 2)
    const first = cache.put(preview)
    const second = cache.put(preview)
    const third = cache.put(preview)

    expect(cache.get(first.token)).toBeNull()
    expect(cache.get(second.token)).toBe(preview)
    expect(cache.get(third.token)).toBe(preview)
  })
})
