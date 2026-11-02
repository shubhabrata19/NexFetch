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

const source: DownloadSource = {
  kind: 'youtube',
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
}

const capabilities: EngineCapabilities = {
  preview: true,
  selectableFormats: true,
  audioOnly: false,
  pauseResume: false,
  resumeAfterRestart: false,
  checksumVerification: false,
  seeding: false,
  liveSpeed: true,
  eta: true,
  peerStats: false,
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

  it('rejects duplicate engine IDs', () => {
    const registry = new EngineRegistry()
    registry.register(fakeEngine('one', () => null))
    expect(() => registry.register(fakeEngine('one', () => null))).toThrow(/already registered/)
  })
})
