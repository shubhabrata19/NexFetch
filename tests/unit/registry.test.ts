import { describe, expect, it } from 'vitest'
import type {
  DownloadEngine,
  EngineCapabilities,
  EngineMatch,
  SourceInput,
} from '@shared/domain/engine'
import type { DownloadSource } from '@shared/domain/job'
import {
  AmbiguousEngineError,
  EngineRegistry,
  NoEngineError,
  UnsupportedSourceError,
} from '@main/engines/registry'
import { HttpEngine } from '@main/engines/http/http-engine'
import { YoutubeEngine } from '@main/engines/youtube/youtube-engine'

const source: DownloadSource = {
  kind: 'youtube',
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
}

const capabilities: EngineCapabilities = {
  preview: true,
  selectableFormats: true,
  fileSelection: false,
  audioOnly: false,
  directOutput: false,
  pauseResume: false,
  resumeAfterRestart: false,
  checksumVerification: false,
  seeding: false,
  liveSpeed: true,
  eta: true,
  peerStats: false,
  parallelFragmentDownloads: false,
}

function fakeEngine(id: string, match: (input: SourceInput) => EngineMatch | null): DownloadEngine {
  return {
    id,
    displayName: id,
    capabilities,
    match,
    resolveSelection: () => ({
      engineId: id,
      data: null,
      requiredDependencies: [],
      filenameBase: 'test',
      details: null,
      verification: null,
    }),
    start: async () => ({
      output: { kind: 'file', path: '/tmp/test' },
      totalBytes: null,
    }),
  }
}

function supported(priority: number): EngineMatch {
  return { kind: 'supported', source, priority }
}

describe('engine registry', () => {
  it('selects the highest-priority supported engine', () => {
    const registry = new EngineRegistry()
    registry.register(fakeEngine('generic', () => supported(10)))
    registry.register(fakeEngine('specific', () => supported(100)))

    expect(registry.resolve({ kind: 'text', value: 'anything' }).engine.id).toBe('specific')
  })

  it('lets a specific engine block a generic fallback with an unsupported claim', () => {
    const registry = new EngineRegistry()
    registry.register(fakeEngine('generic', () => supported(10)))
    registry.register(
      fakeEngine('specific', () => ({
        kind: 'unsupported',
        reason: 'Playlists are not supported yet.',
        priority: 100,
      })),
    )

    expect(() => registry.resolve({ kind: 'text', value: 'playlist' })).toThrow(
      UnsupportedSourceError,
    )
  })

  it('rejects equal-priority ambiguity', () => {
    const registry = new EngineRegistry()
    registry.register(fakeEngine('one', () => supported(100)))
    registry.register(fakeEngine('two', () => supported(100)))

    expect(() => registry.resolve({ kind: 'text', value: 'anything' })).toThrow(
      AmbiguousEngineError,
    )
  })

  it('rejects unsupported sources when no engine matches', () => {
    const registry = new EngineRegistry()
    registry.register(fakeEngine('one', () => null))
    expect(() => registry.resolve({ kind: 'text', value: 'anything' })).toThrow(NoEngineError)
  })

  it('routes YouTube before the generic HTTP engine and blocks HTTP fallbacks for playlists', () => {
    const registry = new EngineRegistry()
    registry.register(new HttpEngine())
    registry.register(new YoutubeEngine())

    expect(
      registry.resolve({
        kind: 'text',
        value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      }).engine.id,
    ).toBe('youtube')
    expect(
      registry.resolve({ kind: 'text', value: 'https://example.com/files/report.pdf' }).engine.id,
    ).toBe('http')
    expect(() =>
      registry.resolve({
        kind: 'text',
        value: 'https://www.youtube.com/playlist?list=PL123',
      }),
    ).toThrow(UnsupportedSourceError)
  })

  it('rejects duplicate engine IDs', () => {
    const registry = new EngineRegistry()
    registry.register(fakeEngine('one', () => null))
    expect(() => registry.register(fakeEngine('one', () => null))).toThrow(/already registered/)
  })
})
