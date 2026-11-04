import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DomainError } from '@shared/domain/errors'
import type { EnginePreviewData } from '@shared/domain/engine'
import type { TorrentPreview, TorrentPreviewEnvelope } from '@shared/domain/torrent'
import type { PreviewCache } from '../../download/preview-cache'
import type { Logger } from '../../services/logger'
import { torrentEnginePreview } from './torrent-engine'
import type { TorrentEngine, TorrentPreviewData } from './torrent-engine'

const MAX_TORRENT_BYTES = 10 * 1024 * 1024

function isTorrentFilename(name: string): boolean {
  return /\.torrent$/i.test(name)
}

export class TorrentPreviewService {
  constructor(
    private readonly engine: TorrentEngine,
    private readonly cache: PreviewCache,
    private readonly cacheDirectory: string,
    private readonly logger: Logger,
  ) {}

  async previewFile(path: string, signal: AbortSignal): Promise<TorrentPreviewEnvelope> {
    if (!isTorrentFilename(path)) {
      throw new DomainError('TORRENT_INVALID', 'Choose a .torrent file.')
    }
    try {
      const info = await stat(path)
      if (!info.isFile() || info.size <= 0 || info.size > MAX_TORRENT_BYTES) {
        throw new DomainError('TORRENT_INVALID', 'The torrent file is empty or too large.')
      }
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('TORRENT_INVALID', 'The torrent file could not be read.')
    }

    if (signal.aborted) throw new DomainError('CANCELLED', 'Torrent preview cancelled.')
    await mkdir(this.cacheDirectory, { recursive: true })
    const sanitizedPath = join(this.cacheDirectory, `incoming-${randomUUID()}.torrent`)
    try {
      const preview = await this.engine.inspectFile(path, sanitizedPath)
      return await this.storePreview(preview, sanitizedPath, signal)
    } finally {
      await rm(sanitizedPath, { force: true }).catch(() => undefined)
    }
  }

  async previewBytes(
    name: string,
    dataBase64: string,
    signal: AbortSignal,
  ): Promise<TorrentPreviewEnvelope> {
    if (!isTorrentFilename(name)) {
      throw new DomainError('TORRENT_INVALID', 'Choose a .torrent file.')
    }
    let data: Buffer
    try {
      data = Buffer.from(dataBase64, 'base64')
    } catch {
      throw new DomainError('TORRENT_INVALID', 'The torrent file data is invalid.')
    }
    if (data.length <= 0 || data.length > MAX_TORRENT_BYTES) {
      throw new DomainError('TORRENT_INVALID', 'The torrent file is empty or too large.')
    }

    await mkdir(this.cacheDirectory, { recursive: true })
    const temporaryPath = join(this.cacheDirectory, `incoming-${randomUUID()}.torrent`)
    const sanitizedPath = join(this.cacheDirectory, `sanitized-${randomUUID()}.torrent`)
    try {
      await writeFile(temporaryPath, data, { flag: 'wx' })
      if (signal.aborted) throw new DomainError('CANCELLED', 'Torrent preview cancelled.')
      const preview = await this.engine.inspectFile(temporaryPath, sanitizedPath)
      return await this.storePreview(preview, sanitizedPath, signal)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      await rm(sanitizedPath, { force: true }).catch(() => undefined)
    }
  }

  async resolveInfoHashMetadata(
    infoHash: string,
    hashVersion: 1 | 2,
    signal: AbortSignal,
    onProgress?: (progress: {
      requestId: string
      dhtNodes: number | null
      peers: number | null
      elapsedMs: number
      message: string
    }) => void,
  ): Promise<{ preview: TorrentPreview; metadataPath: string }> {
    await mkdir(this.cacheDirectory, { recursive: true })
    const metadataPath = join(this.cacheDirectory, `${infoHash}.torrent`)
    return this.engine.resolveInfoHash(infoHash, hashVersion, metadataPath, signal, onProgress)
  }

  private async storePreview(
    preview: TorrentPreview,
    metadataSource: string,
    signal: AbortSignal,
  ): Promise<TorrentPreviewEnvelope> {
    if (signal.aborted) throw new DomainError('CANCELLED', 'Torrent preview cancelled.')
    await mkdir(this.cacheDirectory, { recursive: true })
    const metadataPath = join(this.cacheDirectory, `${preview.infoHash}.torrent`)
    if (metadataSource !== metadataPath) {
      await copyFile(metadataSource, metadataPath)
    }

    const enginePreview = torrentEnginePreview(preview, metadataPath)

    this.logger.info('torrent_preview_ready', {
      infoHash: preview.infoHash.slice(0, 12),
      fileCount: preview.fileCount,
      sourceKind: preview.sourceKind,
    })
    return this.toEnvelope(enginePreview)
  }

  private toEnvelope(data: EnginePreviewData): TorrentPreviewEnvelope {
    const token = this.cache.put(data)
    const preview = data.data as TorrentPreviewData
    const { metadataPath: _metadataPath, ...safe } = preview
    void _metadataPath
    return {
      ...safe,
      engineId: 'torrent',
      previewToken: token.token,
      expiresAt: token.expiresAt,
    }
  }
}
