import { randomUUID } from 'node:crypto'
import { DomainError } from '@shared/domain/errors'
import type { AppError } from '@shared/domain/errors'
import type {
  DownloadEngine,
  EngineEvent,
  EngineRunContext,
  EngineSelection,
} from '@shared/domain/engine'
import type { DownloadJob, JobStatus } from '@shared/domain/job'
import { emptyProgress } from '@shared/domain/job'
import type {
  TorrentJobDetails,
  TorrentPreview,
  TorrentResolvedSelection,
  TorrentResolveProgress,
} from '@shared/domain/torrent'
import { parseTorrentSource } from '@shared/domain/torrent-magnet'
import { defaultTorrentDestination, torrentFolderName } from '@shared/domain/torrent-paths'
import type { CreateJobRequest, TorrentSetupUpdateRequest } from '@shared/ipc/contracts'
import type { EngineRegistry } from '../engines/registry'
import type { DependencyService } from '../services/dependency-service'
import type { FileService } from '../services/file-service'
import type { Logger } from '../services/logger'
import type { MediaVerifier } from '../services/media-verifier'
import type { SettingsService } from '../services/settings-service'
import type { JobRepository, PersistedJobRecord } from './job-repository'
import { toJobView } from './job-repository'
import type { PreviewCache } from './preview-cache'

interface JobRuntime {
  job: PersistedJobRecord
  controller: AbortController
  completion: Promise<void>
  lastPersistAt: number
  pauseRequested: boolean
}

function isPausableStatus(status: JobStatus): boolean {
  return (
    status === 'queued' ||
    status === 'resolving' ||
    status === 'downloading' ||
    status === 'seeding'
  )
}

function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function scheduledTime(job: PersistedJobRecord): number | null {
  if (!job.scheduledAt) return null
  const parsed = Date.parse(job.scheduledAt)
  return Number.isFinite(parsed) ? parsed : null
}

export interface TorrentMetadataProvider {
  resolve(
    infoHash: string,
    hashVersion: 1 | 2,
    signal: AbortSignal,
    onProgress: (progress: TorrentResolveProgress) => void,
    options?: { trackers?: string[]; sourceKind?: 'infohash' | 'magnet' },
  ): Promise<{ preview: TorrentPreview; metadataPath: string }>
  createSelection(preview: TorrentPreview, metadataPath: string): EngineSelection
}

export interface DownloadManagerOptions {
  registry: EngineRegistry
  jobs: JobRepository
  settings: SettingsService
  files: FileService
  verifier: MediaVerifier
  dependencies: DependencyService
  previews: PreviewCache
  logger: Logger
  torrentMetadata?: TorrentMetadataProvider
  onJobChanged: (job: DownloadJob) => void
  onJobRemoved: (jobId: string) => void
}

const MAX_METADATA_LOOKUPS = 3
const METADATA_TIMEOUT_MS = 200_000

function nonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function interruptedError(): AppError {
  return {
    code: 'INTERRUPTED',
    message: 'NexFetch closed before this download finished. Retry to start again.',
    retryable: true,
    diagnosticId: randomUUID(),
  }
}

function toAppError(error: unknown): AppError {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      diagnosticId: randomUUID(),
    }
  }

  return {
    code: 'UNKNOWN',
    message: 'The download failed unexpectedly. Check the local logs for details.',
    retryable: true,
    diagnosticId: randomUUID(),
  }
}

export class DownloadManager {
  private readonly runtimes = new Map<string, JobRuntime>()
  private readonly lookupRuntimes = new Map<string, AbortController>()
  private lookupQueue: string[] = []
  private scheduleTimer: NodeJS.Timeout | null = null
  private shuttingDown = false

  constructor(private readonly options: DownloadManagerOptions) {}

  refreshQueue(): void {
    this.pump()
  }

  listJobs(): DownloadJob[] {
    return this.options.jobs
      .list()
      .map(toJobView)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getJob(jobId: string): DownloadJob | null {
    const job = this.options.jobs.get(jobId)
    return job ? toJobView(job) : null
  }

  async startMetadataLookup(rawSource: string): Promise<DownloadJob> {
    const parsed = parseTorrentSource(rawSource)
    if (!parsed) {
      throw new DomainError(
        'TORRENT_INVALID',
        'Enter a valid v1 (40 hex / 32 base32) or v2 (64 hex) info hash or a magnet link.',
      )
    }
    if (!this.options.torrentMetadata) {
      throw new DomainError(
        'UNSUPPORTED_SOURCE',
        'Torrent metadata lookup is unavailable in this build.',
      )
    }

    const duplicate = this.options.jobs
      .list()
      .find(
        (job) =>
          job.engineId === 'torrent' &&
          job.details?.engineId === 'torrent' &&
          job.details.infoHash === parsed.infoHash &&
          job.status !== 'failed' &&
          job.status !== 'cancelled',
      )
    if (duplicate) {
      throw new DomainError(
        'TORRENT_DUPLICATE',
        'This torrent is already in your Torrents list. Open it there instead.',
      )
    }

    const settings = this.options.settings.get()
    const now = new Date().toISOString()
    const sourceKind = parsed.kind === 'magnet' ? 'magnet' : 'infohash'
    const title = parsed.displayName ?? `${parsed.infoHash.slice(0, 12)}…`
    const details: TorrentJobDetails = {
      engineId: 'torrent',
      infoHash: parsed.infoHash,
      hashVersion: parsed.version,
      isPrivate: false,
      files: [],
      trackers: [],
      peers: [],
      seedsConnected: null,
      seedsAvailable: null,
      peersConnected: null,
      peersAvailable: null,
      downloadRateBytesPerSecond: null,
      uploadRateBytesPerSecond: null,
      uploadedBytes: null,
      ratio: null,
      downloadLimitBytesPerSecond: null,
      uploadLimitBytesPerSecond: null,
      maxConnections: null,
      seedAfterComplete: settings.torrentSeedAfterComplete,
      discovery: {
        dht: true,
        pex: true,
        lsd: true,
        natMapping: settings.torrentNATMapping,
        natStatus: null,
        listenPort: null,
        incomingConnections: false,
        dhtNodes: null,
        webSeeds: 'disabled',
      },
      lookup: {
        phase: 'queued',
        startedAt: now,
        elapsedMs: 0,
        peers: 0,
        dhtNodes: null,
        message: 'Waiting to search the DHT…',
      },
    }
    const job: PersistedJobRecord = {
      id: randomUUID(),
      revision: 1,
      engineId: 'torrent',
      source: {
        kind: 'torrent',
        infoHash: parsed.infoHash,
        hashVersion: parsed.version,
        sourceKind,
        displayName: title,
      },
      title,
      status: 'metadata',
      progress: emptyProgress(),
      destination: settings.downloadDirectory,
      output: null,
      details,
      error: null,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      scheduledAt: null,
      selection: null,
      workspaceDirectory: null,
      lookupTrackers: parsed.trackers.length > 0 ? parsed.trackers : null,
    }

    this.options.jobs.save(job)
    this.emit(job)
    this.options.logger.info('torrent_metadata_queued', {
      jobId: job.id,
      infoHash: parsed.infoHash.slice(0, 12),
      hashVersion: parsed.version,
    })
    this.queueMetadataLookup(job)
    return toJobView(job)
  }

  async createJob(request: CreateJobRequest): Promise<DownloadJob> {
    const preview = this.options.previews.get(request.previewToken)
    if (!preview) {
      throw new DomainError(
        'PREVIEW_EXPIRED',
        'The video details expired. Fetch the video again before downloading.',
      )
    }

    const engine = this.options.registry.get(preview.engineId)

    if (preview.engineId === 'torrent') {
      const infoHash = (preview.data as { infoHash?: unknown }).infoHash
      if (typeof infoHash === 'string') {
        const duplicate = this.options.jobs
          .list()
          .find(
            (job) =>
              job.engineId === 'torrent' &&
              job.details?.engineId === 'torrent' &&
              job.details.infoHash === infoHash &&
              job.status !== 'failed' &&
              job.status !== 'cancelled',
          )
        if (duplicate) {
          throw new DomainError(
            'TORRENT_DUPLICATE',
            'This torrent is already in your Torrents list. Open it there instead.',
          )
        }
      }
    }

    const destination = await this.options.files.validateDestination(request.destination)
    const selection = engine.resolveSelection(preview, request.selection)

    for (const dependency of selection.requiredDependencies) {
      if (!this.options.dependencies.resolveExecutable(dependency)) {
        throw new DomainError(
          'DEPENDENCY_MISSING',
          dependency === 'ffprobe'
            ? 'ffprobe is required to verify the downloaded video.'
            : `${dependency} is required for this download but was not found.`,
        )
      }
    }

    const scheduled = request.scheduledAt ? Date.parse(request.scheduledAt) : Number.NaN
    const scheduledAt =
      Number.isFinite(scheduled) && scheduled > Date.now()
        ? new Date(scheduled).toISOString()
        : null
    const now = new Date().toISOString()
    const deferred = request.deferStart === true && preview.engineId === 'torrent'
    const job: PersistedJobRecord = {
      id: randomUUID(),
      revision: 1,
      engineId: preview.engineId,
      source: preview.source,
      title: preview.title,
      status: deferred ? 'setup' : 'queued',
      progress: emptyProgress(),
      destination,
      output: null,
      details: selection.details,
      error: null,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      scheduledAt,
      selection,
      workspaceDirectory: null,
    }

    this.options.jobs.save(job)
    this.emit(job)
    this.options.logger.info('job_created', {
      jobId: job.id,
      engineId: job.engineId,
      title: job.title.slice(0, 120),
      deferred,
    })
    if (!deferred) this.pump()
    return toJobView(job)
  }

  async startSetup(request: TorrentSetupUpdateRequest): Promise<DownloadJob> {
    const job = this.getOrThrow(request.jobId)
    if (job.status !== 'setup') {
      throw new DomainError('INVALID_REQUEST', 'This torrent is not waiting for setup.')
    }
    if (!job.selection) {
      throw new DomainError('INTERNAL_ERROR', 'This torrent has no saved setup details.')
    }

    const engine = this.options.registry.get(job.engineId)
    if (!engine.updateSelection) {
      throw new DomainError('INVALID_REQUEST', 'This download cannot be configured.')
    }

    const destination = await this.options.files.validateDestination(request.destination)
    const selection = engine.updateSelection(toJobView(job), job.selection, request)
    job.selection = selection
    job.destination = destination
    job.details = selection.details
    job.status = 'queued'
    job.error = null
    job.completedAt = null
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)
    this.options.logger.info('torrent_setup_started', { jobId: job.id })
    this.pump()
    return toJobView(job)
  }

  async cancelJob(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (isTerminal(job.status)) return toJobView(job)

    if (job.status === 'metadata') {
      this.lookupQueue = this.lookupQueue.filter((id) => id !== jobId)
      this.lookupRuntimes.get(jobId)?.abort('cancel')
      if (job.details?.engineId === 'torrent' && job.details.lookup) {
        job.details.lookup = {
          ...job.details.lookup,
          phase: 'cancelled',
          message: 'Metadata lookup cancelled.',
        }
      }
      this.setTerminal(job, 'cancelled', null)
      this.pumpLookupQueue()
      return toJobView(job)
    }

    if (job.status === 'setup') {
      this.setTerminal(job, 'cancelled', null)
      return toJobView(job)
    }

    if (job.status === 'queued') {
      this.setTerminal(job, 'cancelled', null)
      return toJobView(job)
    }

    if (job.status === 'paused') {
      await this.cleanupWorkspace(job, job.workspaceDirectory)
      this.setTerminal(job, 'cancelled', null)
      return toJobView(job)
    }

    const runtime = this.runtimes.get(jobId)
    if (!runtime) {
      this.setTerminal(job, 'cancelled', null)
      return toJobView(job)
    }

    if (job.status !== 'cancelling') {
      job.status = 'cancelling'
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
    }
    runtime.controller.abort('cancel')
    await runtime.completion
    return this.getJob(jobId) ?? toJobView(job)
  }

  async pauseJob(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (job.status === 'paused') return toJobView(job)
    if (job.status === 'queued') {
      const engine = this.options.registry.get(job.engineId)
      if (!engine.capabilities.pauseResume) {
        throw new DomainError('INVALID_REQUEST', 'This download cannot be paused.')
      }
      job.status = 'paused'
      job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
      this.pump()
      return toJobView(job)
    }
    if (!isPausableStatus(job.status)) {
      throw new DomainError(
        'INVALID_REQUEST',
        'This download cannot be paused while it is being processed or verified.',
      )
    }

    const engine = this.options.registry.get(job.engineId)
    if (!engine.capabilities.pauseResume) {
      throw new DomainError('INVALID_REQUEST', 'This download cannot be paused.')
    }

    const runtime = this.runtimes.get(jobId)
    if (!runtime) {
      job.status = 'paused'
      job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
      this.pump()
      return toJobView(job)
    }

    runtime.pauseRequested = true
    runtime.controller.abort('pause')
    await runtime.completion
    return this.getJob(jobId) ?? toJobView(job)
  }

  async resumeJob(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (job.status !== 'paused') {
      throw new DomainError('INVALID_REQUEST', 'Only a paused download can be resumed.')
    }

    const engine = this.options.registry.get(job.engineId)
    if (!engine.capabilities.pauseResume) {
      throw new DomainError('INVALID_REQUEST', 'This download cannot be resumed.')
    }

    job.status = 'queued'
    job.error = null
    job.scheduledAt = null
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)
    this.pump()
    return toJobView(job)
  }

  async startSeeding(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (job.engineId !== 'torrent' || job.status !== 'completed') {
      throw new DomainError('INVALID_REQUEST', 'Only a completed torrent can start seeding.')
    }
    if (!job.selection || job.details?.engineId !== 'torrent') {
      throw new DomainError('INVALID_REQUEST', 'This torrent has no saved seeding details.')
    }
    const engine = this.options.registry.get(job.engineId)
    if (!engine.updateSelection) {
      throw new DomainError('INVALID_REQUEST', 'This torrent cannot start seeding.')
    }

    const details = job.details
    const selection = engine.updateSelection(toJobView(job), job.selection, {
      jobId: job.id,
      destination: job.destination,
      fileIndices: details.files.filter((file) => file.selected).map((file) => file.index),
      downloadLimitBytesPerSecond: details.downloadLimitBytesPerSecond,
      uploadLimitBytesPerSecond: details.uploadLimitBytesPerSecond,
      maxConnections: details.maxConnections ?? null,
      seedAfterComplete: true,
    })
    job.selection = selection
    job.details = selection.details
    job.status = 'queued'
    job.completedAt = null
    job.error = null
    job.scheduledAt = null
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)
    this.pump()
    return toJobView(job)
  }

  async stopSeeding(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (job.status !== 'seeding') {
      throw new DomainError('INVALID_REQUEST', 'This torrent is not currently seeding.')
    }
    const engine = this.options.registry.get(job.engineId)
    if (!engine.stopSeeding) {
      throw new DomainError('INVALID_REQUEST', 'This download cannot stop seeding.')
    }
    await engine.stopSeeding(jobId)
    return this.getJob(jobId) ?? toJobView(job)
  }

  async setTorrentLimits(
    jobId: string,
    downloadLimitBytesPerSecond: number | null,
    uploadLimitBytesPerSecond: number | null,
    maxConnections: number | null,
  ): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    const engine = this.options.registry.get(job.engineId)
    if (!engine.setLimits) {
      throw new DomainError('INVALID_REQUEST', 'This download does not support transfer limits.')
    }
    const target = this.runtimes.get(jobId)?.job ?? job
    await engine.setLimits(
      toJobView(target),
      downloadLimitBytesPerSecond,
      uploadLimitBytesPerSecond,
      maxConnections,
    )

    if (target.details?.engineId === 'torrent') {
      target.details = {
        ...target.details,
        downloadLimitBytesPerSecond,
        uploadLimitBytesPerSecond,
        maxConnections,
      }
      if (target.selection?.engineId === 'torrent') {
        const data = target.selection.data as TorrentResolvedSelection
        target.selection = {
          ...target.selection,
          data: {
            ...data,
            downloadLimitBytesPerSecond,
            uploadLimitBytesPerSecond,
            maxConnections,
          },
          details: target.details,
        }
      }
      this.touch(target)
      this.options.jobs.save(target)
      this.emit(target)
    }

    return toJobView(target)
  }

  async findMorePeers(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    const engine = this.options.registry.get(job.engineId)
    if (!engine.findMorePeers) {
      throw new DomainError('INVALID_REQUEST', 'This download does not support peer discovery.')
    }
    await engine.findMorePeers(job)
    return this.getJob(jobId) ?? toJobView(job)
  }

  async verifyTorrent(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    const engine = this.options.registry.get(job.engineId)
    if (!engine.verify) {
      throw new DomainError('INVALID_REQUEST', 'This download does not support verification.')
    }
    await engine.verify(job)
    return this.getJob(jobId) ?? toJobView(job)
  }

  async retryJob(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (!isTerminal(job.status) || job.status === 'completed') {
      throw new DomainError('INVALID_REQUEST', 'Only failed or cancelled jobs can be retried.')
    }

    if (
      job.engineId === 'torrent' &&
      job.source.kind === 'torrent' &&
      job.source.sourceKind === 'infohash' &&
      !job.selection
    ) {
      job.status = 'metadata'
      job.progress = emptyProgress()
      job.error = null
      job.output = null
      job.startedAt = new Date().toISOString()
      job.completedAt = null
      job.scheduledAt = null
      job.attempt += 1
      if (job.details?.engineId === 'torrent') {
        job.details.lookup = {
          phase: 'queued',
          startedAt: job.startedAt,
          elapsedMs: 0,
          peers: 0,
          dhtNodes: null,
          message: 'Waiting to search the DHT…',
        }
      }
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
      this.queueMetadataLookup(job)
      return toJobView(job)
    }

    if (!job.selection) {
      throw new DomainError('INVALID_REQUEST', 'This job has no saved format selection.')
    }

    job.status = 'queued'
    job.progress = emptyProgress()
    job.error = null
    job.output = null
    job.startedAt = null
    job.completedAt = null
    job.scheduledAt = null
    job.attempt += 1
    job.workspaceDirectory = null
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)
    this.pump()
    return toJobView(job)
  }

  async removeJob(jobId: string, options: { deleteFiles?: boolean } = {}): Promise<void> {
    const job = this.getOrThrow(jobId)
    if (
      job.status !== 'setup' &&
      job.status !== 'metadata' &&
      job.status !== 'paused' &&
      !isTerminal(job.status)
    ) {
      throw new DomainError('INVALID_REQUEST', 'Cancel an active download before removing it.')
    }

    if (job.status === 'metadata') {
      this.lookupQueue = this.lookupQueue.filter((id) => id !== jobId)
      this.lookupRuntimes.get(jobId)?.abort('cancel')
    }

    const workspace = job.workspaceDirectory
    try {
      if (job.status !== 'setup' && job.status !== 'metadata') {
        await this.options.registry.get(job.engineId).removeJob?.(toJobView(job))
      }
    } catch (error) {
      this.options.logger.warn('job_engine_cleanup_failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (options.deleteFiles && job.engineId === 'torrent') {
      const deletion = await this.options.files.deleteTorrentFiles(toJobView(job))
      if (deletion.failures.length > 0) {
        this.options.logger.warn('job_files_delete_failed', {
          jobId,
          deletedFiles: deletion.deletedFiles,
          failedFiles: deletion.failures.length,
        })
        throw new DomainError(
          'PERMISSION_DENIED',
          deletion.deletedFiles > 0
            ? 'Some downloaded files could not be deleted. Close any app using them, then try removing again.'
            : 'The downloaded files could not be deleted. Close any app using them, then try again.',
        )
      }
      this.options.logger.info('job_files_deleted', {
        jobId,
        deletedFiles: deletion.deletedFiles,
        deletedBytes: deletion.deletedBytes,
      })
    }

    this.options.jobs.remove(jobId)
    this.options.onJobRemoved(jobId)
    if (workspace) {
      try {
        await this.options.files.removeWorkspace(workspace, job.destination)
      } catch (error) {
        this.options.logger.warn('job_workspace_cleanup_failed', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  recoverInterruptedJobs(): void {
    const now = new Date().toISOString()
    for (const job of this.options.jobs.list()) {
      if (isTerminal(job.status)) continue
      if (job.status === 'setup' || job.status === 'queued' || job.status === 'paused') continue

      if (job.status === 'metadata') {
        if (job.details?.engineId === 'torrent') {
          job.details.lookup = {
            phase: 'queued',
            startedAt: now,
            elapsedMs: 0,
            peers: 0,
            dhtNodes: null,
            message: 'Resuming metadata lookup…',
          }
        }
        job.error = null
        this.touch(job)
        this.options.jobs.save(job)
        this.queueMetadataLookup(job)
        continue
      }

      if (job.status === 'seeding') {
        // Seeding never resumes automatically after a close.
        job.status = 'completed'
        job.completedAt = now
        job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
        this.touch(job)
        this.options.jobs.save(job)
        this.emit(job)
        continue
      }

      if (job.status === 'cancelling') {
        job.status = 'cancelled'
        job.completedAt = now
        job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
        this.touch(job)
        const workspace = job.workspaceDirectory
        job.workspaceDirectory = null
        this.options.jobs.save(job)
        if (workspace) {
          void this.options.files.removeWorkspace(workspace, job.destination).catch(() => undefined)
        }
        continue
      }

      if (
        this.options.settings.get().resumeIncompleteDownloads &&
        this.canResumeAfterRestart(job) &&
        (job.workspaceDirectory !== null || this.hasDirectOutput(job))
      ) {
        job.status = 'queued'
        job.startedAt = null
        job.completedAt = null
        job.error = null
        job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
        this.touch(job)
        this.options.jobs.save(job)
        continue
      }

      job.status = 'failed'
      job.completedAt = now
      job.error = {
        code: 'INTERRUPTED',
        message: 'NexFetch closed before this download finished. Retry to start again.',
        retryable: true,
        diagnosticId: randomUUID(),
      }
      job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
      this.touch(job)
      const workspace = job.workspaceDirectory
      job.workspaceDirectory = null
      this.options.jobs.save(job)
      if (workspace) {
        void this.options.files.removeWorkspace(workspace, job.destination).catch(() => undefined)
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer)
      this.scheduleTimer = null
    }
    for (const controller of this.lookupRuntimes.values()) controller.abort('shutdown')
    const completions = [...this.runtimes.values()].map((runtime) => {
      runtime.controller.abort('shutdown')
      return runtime.completion
    })

    await Promise.race([
      Promise.allSettled(completions),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ])
  }

  private canResumeAfterRestart(job: PersistedJobRecord): boolean {
    try {
      return this.options.registry.get(job.engineId).capabilities.resumeAfterRestart
    } catch {
      return false
    }
  }

  private hasDirectOutput(job: PersistedJobRecord): boolean {
    try {
      return this.options.registry.get(job.engineId).capabilities.directOutput
    } catch {
      return false
    }
  }

  private activeDownloadRuntimeCount(): number {
    let count = 0
    for (const jobId of this.runtimes.keys()) {
      const job = this.options.jobs.get(jobId)
      if (job && job.status !== 'seeding') count += 1
    }
    return count
  }

  private getOrThrow(jobId: string): PersistedJobRecord {
    const job = this.options.jobs.get(jobId)
    if (!job) {
      throw new DomainError('INVALID_REQUEST', 'The requested download job was not found.')
    }
    return job
  }

  private pump(): void {
    if (this.shuttingDown) return
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer)
      this.scheduleTimer = null
    }

    const maxConcurrent = this.options.settings.get().maxConcurrentDownloads
    const now = Date.now()
    const queued = this.options.jobs
      .list()
      .filter((job) => job.status === 'queued')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (const job of queued) {
      if (this.activeDownloadRuntimeCount() >= maxConcurrent) return
      const dueAt = scheduledTime(job)
      if (dueAt !== null && dueAt > now) continue
      this.startJob(job)
    }

    if (this.activeDownloadRuntimeCount() >= maxConcurrent) return

    const nextScheduled = queued
      .map((job) => ({ job, dueAt: scheduledTime(job) }))
      .filter(
        (entry): entry is { job: PersistedJobRecord; dueAt: number } =>
          entry.dueAt !== null && entry.dueAt > now,
      )
      .sort((a, b) => a.dueAt - b.dueAt)[0]

    if (!nextScheduled) return
    const delay = Math.min(nextScheduled.dueAt - now, 2 ** 31 - 1)
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null
      this.pump()
    }, delay)
    this.scheduleTimer.unref()
  }

  private startJob(job: PersistedJobRecord): void {
    const controller = new AbortController()
    const runtime: JobRuntime = {
      job,
      controller,
      completion: Promise.resolve(),
      lastPersistAt: 0,
      pauseRequested: false,
    }
    this.runtimes.set(job.id, runtime)

    runtime.completion = this.runJob(job, runtime)
      .catch((error: unknown) => {
        this.options.logger.error('job_runtime_uncaught', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        this.runtimes.delete(job.id)
        this.pump()
      })
  }

  private queueMetadataLookup(job: PersistedJobRecord): void {
    if (!this.options.torrentMetadata) return
    if (this.lookupRuntimes.size < MAX_METADATA_LOOKUPS) {
      this.beginMetadataLookup(job)
      return
    }
    if (!this.lookupQueue.includes(job.id)) this.lookupQueue.push(job.id)
  }

  private pumpLookupQueue(): void {
    if (this.shuttingDown) return
    while (this.lookupRuntimes.size < MAX_METADATA_LOOKUPS && this.lookupQueue.length > 0) {
      const jobId = this.lookupQueue.shift()
      if (!jobId) break
      const job = this.options.jobs.get(jobId)
      if (!job || job.status !== 'metadata') continue
      this.beginMetadataLookup(job)
    }
  }

  private beginMetadataLookup(job: PersistedJobRecord): void {
    if (job.status !== 'metadata' || this.lookupRuntimes.has(job.id)) return
    const provider = this.options.torrentMetadata
    if (!provider) return

    if (job.details?.engineId === 'torrent' && job.details.lookup) {
      job.details.lookup = {
        ...job.details.lookup,
        phase: 'searching',
        startedAt: job.details.lookup.startedAt || new Date().toISOString(),
        elapsedMs: 0,
        peers: 0,
        message: 'Searching the DHT for peers…',
      }
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
    }

    const controller = new AbortController()
    this.lookupRuntimes.set(job.id, controller)
    void this.runMetadataLookup(job, controller).finally(() => {
      this.lookupRuntimes.delete(job.id)
      this.pumpLookupQueue()
    })
  }

  private async runMetadataLookup(
    job: PersistedJobRecord,
    controller: AbortController,
  ): Promise<void> {
    const provider = this.options.torrentMetadata
    if (!provider) return

    let timedOut = false
    let lastPersistAt = 0
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort('timeout')
    }, METADATA_TIMEOUT_MS)
    timeout.unref()

    try {
      if (job.details?.engineId !== 'torrent' || !job.details.lookup) {
        throw new DomainError('INTERNAL_ERROR', 'The metadata lookup details are missing.')
      }
      const details = job.details

      const result = await provider.resolve(
        details.infoHash,
        details.hashVersion,
        controller.signal,
        (progress) => {
          if (this.shuttingDown || controller.signal.aborted) return
          const current = this.options.jobs.get(job.id)
          if (!current || current.status !== 'metadata') return
          if (current.details?.engineId !== 'torrent') return

          current.details.lookup = {
            phase: 'searching',
            startedAt: current.details.lookup?.startedAt ?? new Date().toISOString(),
            elapsedMs: progress.elapsedMs,
            peers: progress.peers,
            dhtNodes: progress.dhtNodes,
            message: progress.message,
          }
          current.details.discovery = {
            ...current.details.discovery,
            dhtNodes: progress.dhtNodes,
          }
          current.progress = {
            ...current.progress,
            bytesPerSecond: null,
            etaSeconds: null,
          }
          this.touch(current)
          this.emit(current)
          if (Date.now() - lastPersistAt >= 5000) {
            lastPersistAt = Date.now()
            this.options.jobs.save(current)
          }
        },
        {
          trackers: job.lookupTrackers ?? [],
          sourceKind:
            job.source.kind === 'torrent' && job.source.sourceKind === 'magnet'
              ? 'magnet'
              : 'infohash',
        },
      )

      if (this.shuttingDown || controller.signal.aborted) return
      const current = this.options.jobs.get(job.id)
      if (!current || current.status !== 'metadata') return

      const selection = provider.createSelection(result.preview, result.metadataPath)
      const settings = this.options.settings.get()
      const magnetSource =
        current.source.kind === 'torrent' && current.source.sourceKind === 'magnet'
      current.title = result.preview.title
      current.source = {
        kind: 'torrent',
        infoHash: result.preview.infoHash,
        hashVersion: result.preview.hashVersion,
        sourceKind: magnetSource ? 'magnet' : 'infohash',
        displayName: result.preview.title,
      }
      current.destination = defaultTorrentDestination(
        settings.downloadDirectory,
        torrentFolderName(result.preview.title, result.preview.files),
      )
      current.selection = selection
      current.details = selection.details
      current.status = 'setup'
      current.progress = {
        ...emptyProgress(),
        totalBytes: result.preview.totalBytes,
      }
      current.error = null
      current.completedAt = null
      this.touch(current)
      this.options.jobs.save(current)
      this.emit(current)
      this.options.logger.info('torrent_metadata_ready', {
        jobId: current.id,
        infoHash: result.preview.infoHash.slice(0, 12),
        fileCount: result.preview.fileCount,
      })
    } catch (error) {
      if (this.shuttingDown) return
      const current = this.options.jobs.get(job.id)
      if (!current || current.status !== 'metadata') return

      const appError =
        timedOut && controller.signal.reason === 'timeout'
          ? {
              code: 'TORRENT_NO_PEERS' as const,
              message:
                'No peers shared metadata for this info hash. Check the hash, or open the .torrent file instead.',
              retryable: true,
              diagnosticId: randomUUID(),
            }
          : toAppError(error)

      current.status = 'failed'
      current.completedAt = new Date().toISOString()
      current.error = appError
      if (current.details?.engineId === 'torrent' && current.details.lookup) {
        current.details.lookup = {
          ...current.details.lookup,
          phase: 'failed',
          message: appError.message,
        }
      }
      current.progress = {
        ...current.progress,
        bytesPerSecond: null,
        etaSeconds: null,
      }
      this.touch(current)
      this.options.jobs.save(current)
      this.emit(current)
      this.options.logger.warn('torrent_metadata_failed', {
        jobId: current.id,
        code: appError.code,
        diagnosticId: appError.diagnosticId,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async runJob(job: PersistedJobRecord, runtime: JobRuntime): Promise<void> {
    const now = new Date().toISOString()
    job.status = 'resolving'
    job.startedAt = now
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)

    try {
      if (!job.selection) {
        throw new DomainError('INVALID_REQUEST', 'This job has no saved format selection.')
      }

      const engine: DownloadEngine = this.options.registry.get(job.engineId)
      const directOutput = engine.capabilities.directOutput
      const workspace = directOutput
        ? job.destination
        : await this.options.files.createWorkspace(job.destination, job.id)
      job.workspaceDirectory = directOutput ? null : workspace
      this.options.jobs.save(job)

      const settings = this.options.settings.get()
      const context: EngineRunContext = {
        job: toJobView(job),
        selection: job.selection,
        workspaceDir: workspace,
        resume: job.attempt > 1,
        concurrentFragments: settings.concurrentFragments,
        maxDownloadRateBytesPerSecond: settings.maxDownloadRateBytesPerSecond,
        signal: runtime.controller.signal,
        logger: this.options.logger,
        dependencies: this.options.dependencies,
        emit: (event) => this.handleEngineEvent(job, runtime, event),
      }

      const result = await engine.start(toJobView(job), context)
      if (runtime.controller.signal.aborted) {
        throw new DomainError('CANCELLED', 'Download cancelled.')
      }

      if (job.selection.verification && result.output.kind === 'file') {
        job.status = 'verifying'
        this.touch(job)
        this.options.jobs.save(job)
        this.emit(job)
        await this.options.verifier.verify(
          result.output.path,
          job.selection.verification,
          runtime.controller.signal,
        )
      }

      const output = directOutput
        ? {
            directory: result.output.path,
            files: result.files ?? [],
          }
        : await this.options.files.finalizeOutput(
            result.output,
            workspace,
            job.destination,
            job.selection.filenameBase,
          )

      job.output = output
      job.status = 'completed'
      job.progress = {
        ...job.progress,
        downloadedBytes: result.totalBytes ?? job.progress.downloadedBytes,
        totalBytes: result.totalBytes ?? job.progress.totalBytes,
        percent: 100,
        bytesPerSecond: null,
        etaSeconds: null,
      }
      job.completedAt = new Date().toISOString()
      job.error = null
      this.touch(job)
      await this.cleanupWorkspace(job, job.workspaceDirectory)
      this.options.jobs.save(job)
      this.emit(job)
      this.options.logger.info('job_completed', { jobId: job.id })
    } catch (error) {
      const aborted =
        runtime.controller.signal.aborted ||
        (error instanceof DomainError && error.code === 'CANCELLED')

      if (aborted) {
        if (this.shuttingDown) {
          if ((job.status as JobStatus) === 'seeding' && job.output) {
            // A graceful quit stops seeding. The download itself is complete.
            job.status = 'completed'
            job.completedAt = job.completedAt ?? new Date().toISOString()
            job.error = null
            job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
            this.touch(job)
            this.options.jobs.save(job)
            this.emit(job)
            return
          }

          if (
            this.options.settings.get().resumeIncompleteDownloads &&
            this.canResumeAfterRestart(job) &&
            (job.workspaceDirectory !== null || this.hasDirectOutput(job))
          ) {
            job.status = 'queued'
            job.startedAt = null
            job.completedAt = null
            job.error = null
            job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
            this.touch(job)
            this.options.jobs.save(job)
            this.emit(job)
            return
          }

          await this.cleanupWorkspace(job, job.workspaceDirectory)
          this.setTerminal(job, 'failed', interruptedError())
          return
        }

        if (runtime.pauseRequested) {
          job.status = 'paused'
          job.completedAt = null
          job.error = null
          job.progress = { ...job.progress, bytesPerSecond: null, etaSeconds: null }
          this.touch(job)
          this.options.jobs.save(job)
          this.emit(job)
          return
        }

        await this.cleanupWorkspace(job, job.workspaceDirectory)
        this.setTerminal(job, 'cancelled', null)
        return
      }

      const appError = toAppError(error)
      job.status = 'failed'
      job.completedAt = new Date().toISOString()
      job.error = appError
      job.progress = {
        ...job.progress,
        bytesPerSecond: null,
        etaSeconds: null,
      }
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
      this.options.logger.warn('job_failed', {
        jobId: job.id,
        code: appError.code,
        diagnosticId: appError.diagnosticId,
      })
    }
  }

  private handleEngineEvent(
    job: PersistedJobRecord,
    runtime: JobRuntime,
    event: EngineEvent,
  ): void {
    if (isTerminal(job.status) || runtime.controller.signal.aborted) return

    if (event.type === 'phase') {
      job.status = event.phase
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
      if (event.phase === 'seeding') this.pump()
      return
    }

    if (event.type === 'output') {
      job.output = event.output
      this.touch(job)
      this.options.jobs.save(job)
      this.emit(job)
      return
    }

    if (event.type === 'progress') {
      const downloadedBytes = nonNegative(event.downloadedBytes) ?? job.progress.downloadedBytes
      const totalBytes = nonNegative(event.totalBytes) ?? job.progress.totalBytes
      const percent =
        downloadedBytes !== null && totalBytes !== null && totalBytes > 0
          ? Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100))
          : null

      job.progress = {
        downloadedBytes,
        totalBytes,
        percent,
        bytesPerSecond: positive(event.bytesPerSecond),
        etaSeconds: nonNegative(event.etaSeconds),
      }
      this.touch(job)
      this.emit(job)
      if (Date.now() - runtime.lastPersistAt >= 5000) {
        runtime.lastPersistAt = Date.now()
        this.options.jobs.save(job)
      }
      return
    }

    if (event.type === 'details') {
      job.details = { ...(job.details ?? {}), ...event.patch } as typeof job.details
      this.touch(job)
      this.emit(job)
      return
    }

    this.options.logger.warn('engine_warning', {
      jobId: job.id,
      code: event.code,
      message: event.message,
    })
  }

  private async cleanupWorkspace(job: PersistedJobRecord, workspace: string | null): Promise<void> {
    if (!workspace) return
    try {
      await this.options.files.removeWorkspace(workspace, job.destination)
      job.workspaceDirectory = null
    } catch (error) {
      this.options.logger.warn('job_workspace_cleanup_failed', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private setTerminal(
    job: PersistedJobRecord,
    status: 'completed' | 'failed' | 'cancelled',
    error: AppError | null,
  ): void {
    job.status = status
    job.completedAt = new Date().toISOString()
    job.error = error
    job.progress = {
      ...job.progress,
      bytesPerSecond: null,
      etaSeconds: null,
    }
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)
    this.pump()
  }

  private touch(job: PersistedJobRecord): void {
    job.revision += 1
    job.updatedAt = new Date().toISOString()
  }

  private emit(job: PersistedJobRecord): void {
    this.options.onJobChanged(toJobView(job))
  }
}
