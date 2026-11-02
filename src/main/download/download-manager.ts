import { randomUUID } from 'node:crypto'
import { DomainError } from '@shared/domain/errors'
import type { AppError } from '@shared/domain/errors'
import type { DownloadEngine, EngineEvent, EngineRunContext } from '@shared/domain/engine'
import type { DownloadJob, JobStatus } from '@shared/domain/job'
import { emptyProgress } from '@shared/domain/job'
import type { CreateJobRequest } from '@shared/ipc/contracts'
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
  controller: AbortController
  completion: Promise<void>
  lastPersistAt: number
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
  onJobChanged: (job: DownloadJob) => void
  onJobRemoved: (jobId: string) => void
}

function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function nonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
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

  async createJob(request: CreateJobRequest): Promise<DownloadJob> {
    const preview = this.options.previews.get(request.previewToken)
    if (!preview) {
      throw new DomainError(
        'PREVIEW_EXPIRED',
        'The video details expired. Fetch the video again before downloading.',
      )
    }

    const engine = this.options.registry.get(preview.engineId)
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

    const now = new Date().toISOString()
    const job: PersistedJobRecord = {
      id: randomUUID(),
      revision: 1,
      engineId: preview.engineId,
      source: preview.source,
      title: preview.title,
      status: 'queued',
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
      selection,
      workspaceDirectory: null,
    }

    this.options.jobs.save(job)
    this.emit(job)
    this.options.logger.info('job_created', {
      jobId: job.id,
      engineId: job.engineId,
      title: job.title.slice(0, 120),
    })
    this.pump()
    return toJobView(job)
  }

  async cancelJob(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (isTerminal(job.status)) return toJobView(job)

    if (job.status === 'queued') {
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
    runtime.controller.abort()
    await runtime.completion
    return this.getJob(jobId) ?? toJobView(job)
  }

  async retryJob(jobId: string): Promise<DownloadJob> {
    const job = this.getOrThrow(jobId)
    if (!isTerminal(job.status) || job.status === 'completed') {
      throw new DomainError('INVALID_REQUEST', 'Only failed or cancelled jobs can be retried.')
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
    job.attempt += 1
    job.workspaceDirectory = null
    this.touch(job)
    this.options.jobs.save(job)
    this.emit(job)
    this.pump()
    return toJobView(job)
  }

  async removeJob(jobId: string): Promise<void> {
    const job = this.getOrThrow(jobId)
    if (!isTerminal(job.status)) {
      throw new DomainError('INVALID_REQUEST', 'Cancel an active download before removing it.')
    }

    const workspace = job.workspaceDirectory
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
      job.status = 'failed'
      job.completedAt = now
      job.error = {
        code: 'INTERRUPTED',
        message: 'NexFetch closed before this download finished. Retry to start again.',
        retryable: true,
        diagnosticId: randomUUID(),
      }
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
    const completions = [...this.runtimes.values()].map((runtime) => {
      runtime.controller.abort()
      return runtime.completion
    })

    await Promise.race([
      Promise.allSettled(completions),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ])
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
    const maxConcurrent = this.options.settings.get().maxConcurrentDownloads

    while (this.runtimes.size < maxConcurrent) {
      const next = this.options.jobs
        .list()
        .filter((job) => job.status === 'queued')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (!next) return
      this.startJob(next)
    }
  }

  private startJob(job: PersistedJobRecord): void {
    const controller = new AbortController()
    const runtime: JobRuntime = {
      controller,
      completion: Promise.resolve(),
      lastPersistAt: 0,
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

      const workspace = await this.options.files.createWorkspace(job.destination, job.id)
      job.workspaceDirectory = workspace
      this.options.jobs.save(job)

      const engine: DownloadEngine = this.options.registry.get(job.engineId)
      const context: EngineRunContext = {
        job: toJobView(job),
        selection: job.selection,
        workspaceDir: workspace,
        resume: job.attempt > 1,
        concurrentFragments: this.options.settings.get().concurrentFragments,
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

      const output = await this.options.files.finalizeOutput(
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
      await this.cleanupWorkspace(job, workspace)
      this.options.jobs.save(job)
      this.emit(job)
      this.options.logger.info('job_completed', { jobId: job.id })
    } catch (error) {
      const cancelled =
        runtime.controller.signal.aborted ||
        (error instanceof DomainError && error.code === 'CANCELLED')

      if (cancelled) {
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
