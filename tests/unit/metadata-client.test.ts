import { describe, expect, it } from 'vitest'
import type { EngineContext } from '@shared/domain/engine'
import type { DownloadSource } from '@shared/domain/job'
import { MetadataClient } from '@main/engines/youtube/metadata-client'
import type { ProcessRunResult } from '@main/services/process-runner'

const source: DownloadSource = {
  kind: 'youtube',
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
}

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function context(resolve = true): EngineContext {
  return {
    signal: new AbortController().signal,
    logger,
    dependencies: {
      resolve: () => (resolve ? { path: 'yt-dlp.exe', version: 'test' } : null),
    },
  }
}

function result(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '{}',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  }
}

const baseMetadata = {
  id: 'dQw4w9WgXcQ',
  title: 'Test video',
  channel: 'Test channel',
  duration: 123.4,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  upload_date: '20260102',
  is_live: false,
  formats: [
    {
      format_id: '137',
      ext: 'mp4',
      width: 3840,
      height: 2160,
      fps: 60,
      vcodec: 'avc1',
      acodec: 'none',
    },
  ],
}

describe('YouTube metadata client', () => {
  it('maps validated metadata into app-owned info', async () => {
    const client = new MetadataClient(async () => result({ stdout: JSON.stringify(baseMetadata) }))
    const metadata = await client.fetch(source, context())

    expect(metadata.info).toEqual({
      id: source.videoId,
      title: 'Test video',
      channel: 'Test channel',
      durationSeconds: 123,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      uploadDate: '2026-01-02',
      canonicalUrl: source.canonicalUrl,
    })
    expect(metadata.formats).toHaveLength(1)
  })

  it('falls back for missing title and rejects unsafe thumbnails', async () => {
    const client = new MetadataClient(async () =>
      result({
        stdout: JSON.stringify({
          ...baseMetadata,
          title: '',
          channel: null,
          uploader: 'Uploader',
          thumbnail: 'https://evil.example/image.jpg',
          upload_date: 'not-a-date',
        }),
      }),
    )
    const metadata = await client.fetch(source, context())

    expect(metadata.info.title).toBe(`Video ${source.videoId}`)
    expect(metadata.info.channel).toBe('Uploader')
    expect(metadata.info.thumbnailUrl).toBeNull()
    expect(metadata.info.uploadDate).toBeNull()
  })

  it('rejects live streams', async () => {
    const client = new MetadataClient(async () =>
      result({ stdout: JSON.stringify({ ...baseMetadata, is_live: true }) }),
    )
    await expect(client.fetch(source, context())).rejects.toMatchObject({
      code: 'UNSUPPORTED_SOURCE',
    })
  })

  it('rejects a mismatched extracted video', async () => {
    const client = new MetadataClient(async () =>
      result({ stdout: JSON.stringify({ ...baseMetadata, id: 'different01' }) }),
    )
    await expect(client.fetch(source, context())).rejects.toMatchObject({
      code: 'EXTRACTOR_ERROR',
    })
  })

  it('rejects missing formats', async () => {
    const client = new MetadataClient(async () =>
      result({ stdout: JSON.stringify({ ...baseMetadata, formats: [] }) }),
    )
    await expect(client.fetch(source, context())).rejects.toMatchObject({
      code: 'FORMAT_UNAVAILABLE',
    })
  })

  it('maps access restrictions without exposing raw stderr', async () => {
    const client = new MetadataClient(async () =>
      result({
        exitCode: 1,
        stderr: 'ERROR: Private video. Sign in if you have been granted access.',
      }),
    )
    const error = await client.fetch(source, context()).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'ACCESS_RESTRICTED' })
    expect((error as Error).message).not.toMatch(/ERROR:/)
  })

  it('reports missing dependencies before spawning', async () => {
    const client = new MetadataClient(async () => result())
    await expect(client.fetch(source, context(false))).rejects.toMatchObject({
      code: 'DEPENDENCY_MISSING',
    })
  })

  it('rejects invalid JSON safely', async () => {
    const client = new MetadataClient(async () => result({ stdout: '{invalid' }))
    await expect(client.fetch(source, context())).rejects.toMatchObject({
      code: 'EXTRACTOR_ERROR',
    })
  })
})
