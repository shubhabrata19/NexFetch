import { dirname, join } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import type {
  DownloadEngine,
  EngineCapabilities,
  EngineMatch,
  EnginePreviewData,
  EngineResult,
  EngineRunContext,
  EngineSelection,
  SourceInput,
} from '@shared/domain/engine'
import type { DownloadJob, DownloadSource, JobOutput } from '@shared/domain/job'
import type {
  TorrentDiscovery,
  TorrentFileEntry,
  TorrentJobDetails,
  TorrentPreview,
  TorrentResolvedSelection,
} from '@shared/domain/torrent'
import { parseTorrentSource } from '@shared/domain/torrent-magnet'
import { sanitizeFilenameBase } from '@shared/security/filename'
import { torrentSelectionSchema, torrentSetupUpdateSchema } from '@shared/validation/jobs'
import type { SettingsService } from '../../services/settings-service'
import type { Logger } from '../../services/logger'
import type { HelperTorrentStatus } from './helper-types'
import type { TorrentHelperClient } from './helper-client'
import { TorrentHelperError } from './helper-client'

export type TorrentPreviewData = TorrentPreview & { metadataPath: string }

const CAPABILITIES: EngineCapabilities = {
  preview: false,
  selectableFormats: false,
  fileSelection: true,
  audioOnly: false,
  pauseResume: true,
  resumeAfterRestart: true,
  directOutput: true,
  checksumVerification: false,
  seeding: true,
  liveSpeed: true,
  eta: true,
  peerStats: true,
  parallelFragmentDownloads: false,
}

interface ActiveTorrent {
  infoHash: string
  listener: () => void
  lastStatus: HelperTorrentStatus | null
}

function discoveryFor(isPrivate: boolean): TorrentDiscovery {
  return {
    dht: !isPrivate,
    pex: !isPrivate,
    lsd: !isPrivate,
    natMapping: true,
    natStatus: null,
    listenPort: null,
    incomingConnections: false,
    dhtNodes: null,
    webSeeds: 'disabled',
  }
}

function updateFilesSelected(files: TorrentFileEntry[], indices: number[]): TorrentFileEntry[] {
  const selected = new Set(indices)
  return files.map((file) => ({ ...file, selected: selected.has(file.index) }))
}

function selectedFiles(files: TorrentFileEntry[]): TorrentFileEntry[] {
  return files.filter((file) => file.selected)
}

function mapStatus(status: HelperTorrentStatus): TorrentJobDetails {
  return {
    engineId: 'torrent',
    infoHash: status.infoHash,
    hashVersion: status.hashVersion,
    isPrivate: status.isPrivate,
    files: status.files,
    trackers: status.trackers,
    peers: status.peers,
    seedsConnected: status.seedsConnected,
    seedsAvailable: status.seedsAvailable,
    peersConnected: status.peersConnected,
    peersAvailable: status.peersAvailable,
    downloadRateBytesPerSecond: status.downloadRateBytesPerSecond,
    uploadRateBytesPerSecond: status.uploadRateBytesPerSecond,
    uploadedBytes: status.uploadedBytes,
    ratio: status.ratio,
    downloadLimitBytesPerSecond: status.downloadLimitBytesPerSecond,
    uploadLimitBytesPerSecond: status.uploadLimitBytesPerSecond,
    maxConnections: status.maxConnections,
    seedAfterComplete: status.seedAfterComplete,
    discovery: status.discovery,
  }
}

function outputFor(
  job: DownloadJob,
  status: HelperTorrentStatus,
  savePath: string,
  multiFile: boolean,
): JobOutput {
  const selected = selectedFiles(status.files)
  const files = selected.map((file) => ({
    path: join(savePath, file.path),
    bytes: file.sizeBytes,
  }))
  const rootFolder = selected[0]?.path.split('/')[0]
  return {
    directory: multiFile && rootFolder ? join(savePath, rootFolder) : job.destination,
    files,
  }
}

function selectedBytes(status: HelperTorrentStatus): number {
  return selectedFiles(status.files).reduce((total, file) => total + file.sizeBytes, 0)
}

function isTorrentSource(source: DownloadSource | EnginePreviewData['source']): boolean {
  return source.kind === 'torrent'
}

export function torrentEnginePreview(
  preview: TorrentPreview,
  metadataPath: string,
): EnginePreviewData {
  const data: TorrentPreviewData = { ...preview, metadataPath }
  return {
    engineId: 'torrent',
    source: {
      kind: 'torrent',
      infoHash: preview.infoHash,
      hashVersion: preview.hashVersion,
      sourceKind: preview.sourceKind,
      displayName: preview.title,
    },
    title: preview.title,
    subtitle: null,
    thumbnailUrl: null,
    durationSeconds: null,
    data,
  }
}

export class TorrentEngine implements DownloadEngine {
  readonly id = 'torrent'
  readonly displayName = 'Torrent'
  readonly capabilities = CAPABILITIES
  private readonly active = new Map<string, ActiveTorrent>()

  constructor(
    private readonly helper: TorrentHelperClient,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  match(input: SourceInput): EngineMatch | null {
    if (input.kind === 'file') {
      if (!/\.torrent$/i.test(input.path)) return null
      return {
        kind: 'supported',
        source: {
          kind: 'torrent',
          infoHash: '',
          hashVersion: 1,
          sourceKind: 'file',
          displayName: input.path.split(/[\\/]/).pop() ?? 'Torrent',
        },
        priority: 30,
      }
    }

    const parsed = parseTorrentSource(input.value)
    if (!parsed) return null
    return {
      kind: 'supported',
      source: {
        kind: 'torrent',
        infoHash: parsed.infoHash,
        hashVersion: parsed.version,
        sourceKind: parsed.kind === 'magnet' ? 'magnet' : 'infohash',
        displayName: parsed.displayName ?? `${parsed.infoHash.slice(0, 12)}…`,
      },
      priority: 30,
    }
  }

  async inspectFile(path: string, outputPath: string): Promise<TorrentPreview> {
    try {
      return await this.helper.inspect(path, outputPath)
    } catch (error) {
      throw this.toDomainError(error)
    }
  }

  async resolveInfoHash(
    infoHash: string,
    version: 1 | 2,
    metadataPath: string,
    signal: AbortSignal,
    onProgress?: (progress: {
      requestId: string
      dhtNodes: number | null
      peers: number | null
      elapsedMs: number
      message: string
    }) => void,
    options?: { trackers?: string[]; sourceKind?: 'infohash' | 'magnet' },
  ): Promise<{ preview: TorrentPreview; metadataPath: string }> {
    try {
      await this.helper.configure(this.settings.get())
      const result = await this.helper.resolveInfoHash(
        infoHash,
        version,
        metadataPath,
        signal,
        onProgress,
        options,
      )
      return { preview: result.preview, metadataPath: result.metadataPath }
    } catch (error) {
      throw this.toDomainError(error)
    }
  }

  createSetup(preview: TorrentPreview, metadataPath: string): EngineSelection {
    const enginePreview = torrentEnginePreview(preview, metadataPath)
    return this.resolveSelection(enginePreview, {
      fileIndices: preview.files.map((file) => file.index),
      seedAfterComplete: this.settings.get().torrentSeedAfterComplete,
    })
  }

  resolveSelection(preview: EnginePreviewData, selection: unknown): EngineSelection {
    const data = preview.data as TorrentPreviewData
    const parsed = torrentSelectionSchema.safeParse(selection ?? {})
    if (!parsed.success) {
      throw new DomainError('INVALID_REQUEST', 'The torrent file selection is invalid.')
    }

    const validIndices = [...new Set(parsed.data.fileIndices)].filter(
      (index) => index >= 0 && index < data.files.length,
    )
    if (validIndices.length === 0) {
      throw new DomainError('INVALID_REQUEST', 'Select at least one file to download.')
    }

    const settings = this.settings.get()
    const seedAfterComplete = parsed.data.seedAfterComplete ?? settings.torrentSeedAfterComplete
    const resolved: TorrentResolvedSelection = {
      metadataPath: data.metadataPath,
      infoHash: data.infoHash,
      hashVersion: data.hashVersion,
      title: data.title,
      isPrivate: data.isPrivate,
      fileCount: data.fileCount,
      fileIndices: validIndices,
      downloadLimitBytesPerSecond: parsed.data.downloadLimitBytesPerSecond ?? null,
      uploadLimitBytesPerSecond: parsed.data.uploadLimitBytesPerSecond ?? null,
      maxConnections: parsed.data.maxConnections ?? null,
      seedAfterComplete,
    }

    const details: TorrentJobDetails = {
      engineId: 'torrent',
      infoHash: data.infoHash,
      hashVersion: data.hashVersion,
      isPrivate: data.isPrivate,
      files: updateFilesSelected(data.files, validIndices),
      trackers: data.trackers,
      peers: [],
      seedsConnected: null,
      seedsAvailable: null,
      peersConnected: null,
      peersAvailable: null,
      downloadRateBytesPerSecond: null,
      uploadRateBytesPerSecond: null,
      uploadedBytes: null,
      ratio: null,
      downloadLimitBytesPerSecond: resolved.downloadLimitBytesPerSecond,
      uploadLimitBytesPerSecond: resolved.uploadLimitBytesPerSecond,
      maxConnections: resolved.maxConnections,
      seedAfterComplete,
      discovery: discoveryFor(data.isPrivate),
    }

    return {
      engineId: this.id,
      data: resolved,
      requiredDependencies: [],
      filenameBase: sanitizeFilenameBase(data.title, 'torrent'),
      details,
      verification: null,
    }
  }

  updateSelection(job: DownloadJob, selection: EngineSelection, update: unknown): EngineSelection {
    const parsed = torrentSetupUpdateSchema.safeParse(update)
    if (!parsed.success) {
      throw new DomainError('INVALID_REQUEST', 'The torrent setup options are invalid.')
    }
    const current = selection.data as TorrentResolvedSelection
    const details = selection.details
    if (!details || details.engineId !== 'torrent') {
      throw new DomainError('INTERNAL_ERROR', 'The torrent job is missing its setup details.')
    }

    const validIndices = [...new Set(parsed.data.fileIndices)].filter(
      (index) => index >= 0 && index < details.files.length,
    )
    if (validIndices.length === 0) {
      throw new DomainError('INVALID_REQUEST', 'Select at least one file to download.')
    }

    const resolved: TorrentResolvedSelection = {
      ...current,
      fileIndices: validIndices,
      downloadLimitBytesPerSecond: parsed.data.downloadLimitBytesPerSecond,
      uploadLimitBytesPerSecond: parsed.data.uploadLimitBytesPerSecond,
      maxConnections: parsed.data.maxConnections,
      seedAfterComplete: parsed.data.seedAfterComplete,
    }

    return {
      ...selection,
      data: resolved,
      details: {
        ...details,
        files: updateFilesSelected(details.files, validIndices),
        downloadLimitBytesPerSecond: resolved.downloadLimitBytesPerSecond,
        uploadLimitBytesPerSecond: resolved.uploadLimitBytesPerSecond,
        maxConnections: resolved.maxConnections,
        seedAfterComplete: resolved.seedAfterComplete,
      },
      filenameBase: sanitizeFilenameBase(current.title, 'torrent'),
    }
  }

  async start(job: DownloadJob, ctx: EngineRunContext): Promise<EngineResult> {
    const selection = ctx.selection.data as TorrentResolvedSelection
    if (!selection?.metadataPath || !selection.infoHash) {
      throw new DomainError('INVALID_REQUEST', 'The torrent selection is incomplete.')
    }

    const settings = this.settings.get()
    try {
      await this.helper.configure(settings)
    } catch (error) {
      throw this.toDomainError(error)
    }

    const downloadLimit =
      selection.downloadLimitBytesPerSecond ?? settings.maxDownloadRateBytesPerSecond
    const uploadLimit = selection.uploadLimitBytesPerSecond ?? settings.maxUploadRateBytesPerSecond
    const multiFile = selection.fileCount > 1
    const savePath = multiFile ? dirname(job.destination) : job.destination

    return new Promise<EngineResult>((resolve, reject) => {
      let settled = false
      let announcedDownloading = false
      let listener: () => void = () => undefined

      const cleanup = (): void => {
        listener()
        ctx.signal.removeEventListener('abort', abortHandler)
        this.active.delete(job.id)
      }

      const finish = (result: EngineResult): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const applyStatus = (status: HelperTorrentStatus): void => {
        if (
          !announcedDownloading &&
          (status.state === 'downloading' ||
            status.state === 'checking' ||
            status.state === 'allocating')
        ) {
          announcedDownloading = true
          ctx.emit({ type: 'phase', phase: 'downloading' })
        }
        ctx.emit({
          type: 'progress',
          downloadedBytes: status.downloadedBytes,
          totalBytes: status.totalBytes,
          bytesPerSecond: status.downloadRateBytesPerSecond,
          etaSeconds: status.etaSeconds,
        })
        ctx.emit({ type: 'details', patch: mapStatus(status) })
        if (status.state === 'seeding') {
          ctx.emit({ type: 'phase', phase: 'seeding' })
          ctx.emit({
            type: 'output',
            output: outputFor(job, status, savePath, multiFile),
          })
        }
      }

      const complete = (status: HelperTorrentStatus, seeding: boolean): void => {
        const output = outputFor(job, status, savePath, multiFile)
        const totalBytes = selectedBytes(status) || status.totalBytes
        ctx.emit({ type: 'output', output })
        if (seeding) {
          ctx.emit({ type: 'phase', phase: 'seeding' })
          return
        }
        finish({
          output: { kind: 'directory', path: output.directory },
          totalBytes,
          files: output.files,
        })
      }

      const abortHandler = (): void => {
        const reason = ctx.signal.reason
        if (reason === 'cancel') {
          void this.helper.remove(selection.infoHash, false).catch(() => undefined)
        } else {
          void this.helper.pause(selection.infoHash).catch(() => undefined)
        }
        fail(new DomainError('CANCELLED', 'Torrent download cancelled.'))
      }

      listener = this.helper.onEvent((event) => {
        if (event.event === 'torrent.update') {
          const status = event.data as HelperTorrentStatus
          if (status.infoHash !== selection.infoHash) return
          const active = this.active.get(job.id)
          if (active) active.lastStatus = status
          applyStatus(status)
          return
        }

        if (event.event === 'torrent.completed') {
          const data = event.data as {
            id: string
            seeding: boolean
            stopped: boolean
            status: HelperTorrentStatus
          }
          if (data.id !== selection.infoHash) return
          const active = this.active.get(job.id)
          if (active) active.lastStatus = data.status
          complete(data.status, data.seeding)
          return
        }

        if (event.event === 'torrent.error') {
          const data = event.data as { id: string; message: string }
          if (data.id !== selection.infoHash) return
          fail(new DomainError('NETWORK_ERROR', data.message, true))
        }
      })

      ctx.signal.addEventListener('abort', abortHandler, { once: true })

      this.active.set(job.id, {
        infoHash: selection.infoHash,
        listener,
        lastStatus: null,
      })

      void this.helper
        .add({
          metadataPath: selection.metadataPath,
          savePath,
          fileIndices: selection.fileIndices,
          downloadLimitBytesPerSecond: downloadLimit,
          uploadLimitBytesPerSecond: uploadLimit,
          maxConnections: selection.maxConnections ?? null,
          seedAfterComplete: selection.seedAfterComplete,
          isPrivate: selection.isPrivate,
        })
        .then((status) => {
          const active = this.active.get(job.id)
          if (active) active.lastStatus = status
          applyStatus(status)
          if (status.state === 'completed') {
            complete(status, false)
          } else if (status.state === 'seeding') {
            complete(status, true)
          }
        })
        .catch((error: unknown) => {
          fail(this.toDomainError(error))
        })
    })
  }

  async stopSeeding(jobId: string): Promise<void> {
    const active = this.active.get(jobId)
    if (!active) return
    await this.helper.stopSeeding(active.infoHash)
  }

  async setLimits(
    job: DownloadJob,
    downloadLimitBytesPerSecond: number | null,
    uploadLimitBytesPerSecond: number | null,
    maxConnections: number | null,
  ): Promise<void> {
    const infoHash = (job.details as TorrentJobDetails | null)?.infoHash
    if (!infoHash) return
    await this.helper.setLimits(
      infoHash,
      downloadLimitBytesPerSecond,
      uploadLimitBytesPerSecond,
      maxConnections,
    )
  }

  async findMorePeers(job: DownloadJob): Promise<void> {
    const infoHash = (job.details as TorrentJobDetails | null)?.infoHash
    if (!infoHash) return
    await this.helper.findMorePeers(infoHash)
  }

  async verify(job: DownloadJob): Promise<void> {
    const infoHash = (job.details as TorrentJobDetails | null)?.infoHash
    if (!infoHash) return
    await this.helper.verify(infoHash)
  }

  async removeJob(job: DownloadJob): Promise<void> {
    const infoHash = (job.details as TorrentJobDetails | null)?.infoHash
    if (!infoHash) return
    try {
      await this.helper.remove(infoHash, false)
    } catch {
      // The helper may have restarted or already forgotten this torrent.
    }
  }

  async dispose(): Promise<void> {
    for (const active of this.active.values()) active.listener()
    this.active.clear()
    await this.helper.dispose()
  }

  private toDomainError(error: unknown): DomainError {
    if (error instanceof DomainError) return error
    if (error instanceof TorrentHelperError) {
      const code =
        error.code === 'TORRENT_INVALID' ||
        error.code === 'TORRENT_UNSAFE' ||
        error.code === 'TORRENT_NO_PEERS' ||
        error.code === 'TORRENT_DUPLICATE' ||
        error.code === 'TORRENT_UNAVAILABLE'
          ? error.code
          : error.code === 'CANCELLED'
            ? 'CANCELLED'
            : error.code === 'TORRENT_TIMEOUT'
              ? 'NETWORK_ERROR'
              : 'NETWORK_ERROR'
      return new DomainError(code, error.message, code === 'NETWORK_ERROR')
    }
    this.logger.error('torrent_engine_error', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new DomainError('INTERNAL_ERROR', 'The torrent engine failed unexpectedly.', true)
  }
}

export function isTorrentJob(job: DownloadJob): boolean {
  return job.engineId === 'torrent'
}

export { isTorrentSource }
