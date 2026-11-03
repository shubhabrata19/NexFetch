import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { Settings } from '@shared/ipc/contracts'
import type {
  HelperEvent,
  HelperPreview,
  HelperResolveProgress,
  HelperResult,
  HelperTorrentStatus,
} from './helper-types'

export class TorrentHelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TorrentHelperError'
  }
}

interface HelperLogger {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface ResolveWaiter {
  resolve: (value: { preview: HelperPreview; metadataPath: string }) => void
  reject: (error: Error) => void
  onProgress?: (progress: HelperResolveProgress) => void
}

export interface TorrentHelperPaths {
  bundledRoot: string
  isPackaged: boolean
  projectRoot: string
}

function helperExecutableName(): string {
  return process.platform === 'win32' ? 'nexfetch-torrent-helper.exe' : 'nexfetch-torrent-helper'
}

export function resolveTorrentHelperCommand(paths: TorrentHelperPaths): {
  command: string
  args: string[]
} | null {
  if (!paths.isPackaged && process.env.NXF_TORRENT_HELPER_PATH) {
    return { command: process.env.NXF_TORRENT_HELPER_PATH, args: [] }
  }

  const bundled = join(
    paths.bundledRoot,
    'bin',
    `${process.platform}-${process.arch}`,
    helperExecutableName(),
  )
  if (existsSync(bundled)) return { command: bundled, args: [] }

  if (paths.isPackaged) return null

  const python =
    process.platform === 'win32'
      ? join(paths.projectRoot, '.venv-torrent-helper', 'Scripts', 'python.exe')
      : join(paths.projectRoot, '.venv-torrent-helper', 'bin', 'python')
  const script = join(paths.projectRoot, 'tools', 'torrent-helper', 'nexfetch_torrent_helper.py')
  if (existsSync(python) && existsSync(script)) {
    return { command: python, args: [script] }
  }

  return null
}

export class TorrentHelperClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly resolves = new Map<string, ResolveWaiter>()
  private readonly listeners = new Set<(event: HelperEvent) => void>()
  private disposed = false

  constructor(
    private readonly paths: TorrentHelperPaths,
    private readonly logger: HelperLogger,
  ) {}

  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async configure(settings: Settings): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'session.configure',
      {
        connectionProfile: settings.torrentConnectionProfile,
        natMapping: settings.torrentNATMapping,
        downloadLimitBytesPerSecond: 0,
        uploadLimitBytesPerSecond: settings.maxUploadRateBytesPerSecond,
      },
      20_000,
    )
  }

  async inspect(path: string, outputPath: string): Promise<HelperPreview> {
    return this.request<HelperPreview>('torrent.inspect', { path, outputPath }, 60_000)
  }

  async resolveInfoHash(
    infoHash: string,
    hashVersion: 1 | 2,
    metadataPath: string,
    signal: AbortSignal,
    onProgress?: (progress: HelperResolveProgress) => void,
  ): Promise<{ preview: HelperPreview; metadataPath: string }> {
    await this.ensureStarted()
    if (signal.aborted) throw new TorrentHelperError('CANCELLED', 'Torrent lookup cancelled.')
    const requestId = randomUUID()

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.resolves.delete(requestId)
      }
      const onAbort = (): void => {
        cleanup()
        void this.request('torrent.resolve_cancel', { requestId }, 5_000).catch(() => undefined)
        reject(new TorrentHelperError('CANCELLED', 'Torrent lookup cancelled.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })

      this.resolves.set(requestId, {
        resolve: (value) => {
          cleanup()
          resolve(value)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
        onProgress,
      })

      void this.request(
        'torrent.resolve_start',
        {
          requestId,
          infoHash,
          hashVersion,
          metadataPath,
          timeoutSeconds: 180,
        },
        15_000,
      ).catch((error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  async add(params: {
    metadataPath: string
    savePath: string
    fileIndices: number[]
    downloadLimitBytesPerSecond: number | null
    uploadLimitBytesPerSecond: number | null
    seedAfterComplete: boolean
    isPrivate: boolean
  }): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.add', params, 60_000)
  }

  async status(infoHash: string): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.status', { infoHash }, 20_000)
  }

  async pause(infoHash: string): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.pause', { infoHash }, 20_000)
  }

  async resume(infoHash: string): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.resume', { infoHash }, 20_000)
  }

  async stopSeeding(infoHash: string): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.stop_seeding', { infoHash }, 20_000)
  }

  async setSeedPolicy(infoHash: string, seedAfterComplete: boolean): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>(
      'torrent.set_seed_policy',
      { infoHash, seedAfterComplete },
      20_000,
    )
  }

  async setLimits(
    infoHash: string,
    downloadLimitBytesPerSecond: number | null,
    uploadLimitBytesPerSecond: number | null,
  ): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>(
      'torrent.set_limits',
      { infoHash, downloadLimitBytesPerSecond, uploadLimitBytesPerSecond },
      20_000,
    )
  }

  async setFileSelection(infoHash: string, fileIndices: number[]): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>(
      'torrent.set_file_selection',
      { infoHash, fileIndices },
      20_000,
    )
  }

  async findMorePeers(infoHash: string): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.find_more_peers', { infoHash }, 20_000)
  }

  async verify(infoHash: string): Promise<HelperTorrentStatus> {
    return this.request<HelperTorrentStatus>('torrent.verify', { infoHash }, 20_000)
  }

  async remove(infoHash: string, deleteFiles: boolean): Promise<void> {
    await this.request('torrent.remove', { infoHash, deleteFiles }, 30_000)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (!this.process) return
    const child = this.process
    try {
      await this.request('session.shutdown', {}, 4_000)
    } catch {
      // Best effort.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.process = null
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed)
      throw new TorrentHelperError('TORRENT_UNAVAILABLE', 'Torrent engine stopped.')
    if (this.process) return
    if (this.starting) return this.starting

    const command = resolveTorrentHelperCommand(this.paths)
    if (!command) {
      throw new TorrentHelperError(
        'TORRENT_UNAVAILABLE',
        'The torrent engine is not installed. Run the torrent helper build step.',
      )
    }

    this.starting = new Promise<void>((resolve, reject) => {
      let settled = false
      const child = spawn(command.command, command.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      })
      this.process = child as ChildProcessWithoutNullStreams

      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        this.starting = null
        if (error) reject(error)
        else resolve()
      }

      child.once('spawn', () => {
        this.logger.info('torrent_helper_started')
        settle()
      })
      child.once('error', (error) => {
        this.logger.error('torrent_helper_spawn_failed', { error: error.message })
        this.process = null
        settle(new TorrentHelperError('TORRENT_UNAVAILABLE', 'The torrent engine could not start.'))
      })
      child.once('exit', (code, signal) => {
        this.logger.warn('torrent_helper_exited', { code, signal })
        this.process = null
        const error = new TorrentHelperError(
          'TORRENT_UNAVAILABLE',
          'The torrent engine stopped unexpectedly.',
        )
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.reject(error)
        }
        this.pending.clear()
        for (const waiter of this.resolves.values()) waiter.reject(error)
        this.resolves.clear()
        settle(error)
      })

      child.stdout.setEncoding('utf8')
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => this.handleLine(line))

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        const message = chunk.trim()
        if (message.length > 0)
          this.logger.warn('torrent_helper_stderr', { message: message.slice(0, 500) })
      })
    })

    return this.starting
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.logger.warn('torrent_helper_invalid_json')
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return

    if ('event' in parsed && typeof parsed.event === 'string') {
      const event = parsed as HelperEvent
      if (event.event === 'resolve.progress') {
        const data = event.data as HelperResolveProgress
        this.resolves.get(data.requestId)?.onProgress?.(data)
        return
      }
      if (event.event === 'resolve.ready') {
        const data = event.data as {
          requestId: string
          preview: HelperPreview
          metadataPath: string
        }
        const waiter = this.resolves.get(data.requestId)
        if (waiter) {
          this.resolves.delete(data.requestId)
          waiter.resolve({ preview: data.preview, metadataPath: data.metadataPath })
        }
        return
      }
      if (event.event === 'resolve.error' || event.event === 'resolve.cancelled') {
        const data = event.data as { requestId: string; code?: string; message?: string }
        const waiter = this.resolves.get(data.requestId)
        if (waiter) {
          this.resolves.delete(data.requestId)
          waiter.reject(
            new TorrentHelperError(
              data.code ?? 'CANCELLED',
              data.message ?? 'Torrent lookup cancelled.',
            ),
          )
        }
        return
      }
      for (const listener of this.listeners) listener(event)
      return
    }

    const result = parsed as HelperResult<unknown>
    if (typeof result.id !== 'string') return
    const pending = this.pending.get(result.id)
    if (!pending) return
    this.pending.delete(result.id)
    clearTimeout(pending.timer)
    if (result.ok) {
      pending.resolve(result.data)
    } else {
      pending.reject(
        new TorrentHelperError(
          result.error?.code ?? 'TORRENT_HELPER_ERROR',
          result.error?.message ?? 'The torrent engine returned an error.',
        ),
      )
    }
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    await this.ensureStarted()
    const child = this.process
    if (!child)
      throw new TorrentHelperError('TORRENT_UNAVAILABLE', 'The torrent engine is not running.')
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new TorrentHelperError('TORRENT_TIMEOUT', 'The torrent engine did not respond.'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
}
