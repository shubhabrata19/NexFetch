import { DomainError } from '@shared/domain/errors'
import type { DownloadSource } from '@shared/domain/job'
import type { DownloadEngine, EngineMatch, SourceInput } from '@shared/domain/engine'

export interface ResolvedEngine {
  engine: DownloadEngine
  source: DownloadSource
}

export class AmbiguousEngineError extends DomainError {
  constructor(engineIds: string[]) {
    super(
      'INTERNAL_ERROR',
      `More than one download engine claimed this source: ${engineIds.join(', ')}.`,
    )
    this.name = 'AmbiguousEngineError'
  }
}

export class UnsupportedSourceError extends DomainError {
  constructor(reason: string) {
    super('UNSUPPORTED_SOURCE', reason)
    this.name = 'UnsupportedSourceError'
  }
}

export class NoEngineError extends DomainError {
  constructor() {
    super('UNSUPPORTED_SOURCE', 'This source is not supported yet.')
    this.name = 'NoEngineError'
  }
}

/**
 * Deterministic engine selection. Higher priority wins; an explicit
 * "unsupported" claim from a more specific engine blocks a generic fallback.
 */
export class EngineRegistry {
  private readonly engines = new Map<string, DownloadEngine>()

  register(engine: DownloadEngine): void {
    if (engine.id.trim().length === 0) {
      throw new Error('An engine must have a non-empty ID.')
    }
    if (this.engines.has(engine.id)) {
      throw new Error(`An engine with ID "${engine.id}" is already registered.`)
    }
    this.engines.set(engine.id, engine)
  }

  get(id: string): DownloadEngine {
    const engine = this.engines.get(id)
    if (!engine) throw new Error(`No engine registered with ID "${id}".`)
    return engine
  }

  list(): DownloadEngine[] {
    return [...this.engines.values()]
  }

  resolve(input: SourceInput): ResolvedEngine {
    const candidates: Array<{ engine: DownloadEngine; match: EngineMatch }> = []

    for (const engine of this.engines.values()) {
      const match = engine.match(input)
      if (match) candidates.push({ engine, match })
    }

    if (candidates.length === 0) throw new NoEngineError()

    candidates.sort(
      (a, b) => b.match.priority - a.match.priority || a.engine.id.localeCompare(b.engine.id),
    )

    const topPriority = candidates[0]?.match.priority
    const topCandidates = candidates.filter((candidate) => candidate.match.priority === topPriority)

    if (topCandidates.length !== 1) {
      throw new AmbiguousEngineError(topCandidates.map((candidate) => candidate.engine.id))
    }

    const winner = topCandidates[0]
    if (!winner) throw new NoEngineError()

    if (winner.match.kind === 'unsupported') {
      throw new UnsupportedSourceError(winner.match.reason)
    }

    return { engine: winner.engine, source: winner.match.source }
  }
}
