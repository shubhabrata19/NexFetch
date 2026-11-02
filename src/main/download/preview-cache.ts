import { randomUUID } from 'node:crypto'
import type { EnginePreviewData } from '@shared/domain/engine'

interface PreviewEntry {
  preview: EnginePreviewData
  expiresAt: number
}

export interface CachedPreviewToken {
  token: string
  expiresAt: string
}

export class PreviewCache {
  private readonly entries = new Map<string, PreviewEntry>()

  constructor(
    private readonly ttlMs = 15 * 60 * 1000,
    private readonly maxEntries = 20,
  ) {}

  put(preview: EnginePreviewData): CachedPreviewToken {
    this.cleanup()
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (typeof oldest !== 'string') break
      this.entries.delete(oldest)
    }

    const token = randomUUID()
    const expiresAt = Date.now() + this.ttlMs
    this.entries.set(token, { preview, expiresAt })
    return { token, expiresAt: new Date(expiresAt).toISOString() }
  }

  get(token: string): EnginePreviewData | null {
    this.cleanup()
    const entry = this.entries.get(token)
    return entry?.preview ?? null
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token)
    }
  }
}
