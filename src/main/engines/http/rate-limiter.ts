import { Transform, type TransformCallback } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Token bucket used for per-download bandwidth limits. The bucket allows a
 * small burst, then waits while preserving stream backpressure.
 */
export class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number

  constructor(private readonly bytesPerSecond: number) {
    this.capacity = Math.max(4096, bytesPerSecond)
    this.tokens = this.capacity
    this.lastRefill = Date.now()
  }

  async take(bytes: number, signal?: AbortSignal): Promise<void> {
    if (this.bytesPerSecond <= 0 || bytes <= 0) return

    let remaining = bytes
    while (remaining > 0) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('Aborted')
      }

      this.refill()
      const available = Math.min(remaining, this.tokens)
      if (available > 0) {
        this.tokens -= available
        remaining -= available
        continue
      }

      const waitMs = Math.max(
        1,
        Math.ceil(((remaining - this.tokens) / this.bytesPerSecond) * 1000),
      )
      await delay(Math.min(waitMs, 250), undefined, { signal })
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.bytesPerSecond)
    this.lastRefill = now
  }
}

export function createThrottle(bytesPerSecond: number, signal: AbortSignal): Transform | null {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null

  const bucket = new TokenBucket(bytesPerSecond)
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      void bucket
        .take(chunk.length, signal)
        .then(() => callback(null, chunk))
        .catch((error: unknown) => callback(error instanceof Error ? error : new Error('Aborted')))
    },
  })
}
