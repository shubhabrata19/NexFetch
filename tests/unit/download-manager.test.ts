import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import type {
  DownloadEngine,
  EngineCapabilities,
  EnginePreviewData,
  EngineRunContext,
} from '@shared/domain/engine'
import type { DownloadSource } from '@shared/domain/job'
import { DownloadManager } from '@main/download/download-manager'
import { JsonJobRepository } from '@main/download/job-repository'
import type { PersistedJobRecord } from '@main/download/job-repository'
import { PreviewCache } from '@main/download/preview-cache'
import { EngineRegistry } from '@main/engines/registry'
import type { DependencyService } from '@main/services/dependency-service'
import { FileService } from '@main/services/file-service'
import { Logger } from '@main/services/logger'
import type { MediaVerifier } from '@main/services/media-verifier'
import { SettingsService } from '@main/services/settings-service'

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

const temporaryDirectories: string[] = []

function createFixture(
  initialMode: 'complete' | 'hang',
  options: { pauseResume?: boolean; resumeAfterRestart?: boolean } = {},
): {
  manager: DownloadManager
  settings: SettingsService
  jobs: JsonJobRepository
  destination: string
  previewToken: string
  jobEvents: string[]
  setMode: (mode: 'complete' | 'hang') => void
} {
  const state = { mode: initialMode }
  const directory = mkdtempSync(join(tmpdir(), 'nexfetch-manager-'))
  temporaryDirectories.push(directory)
  const destination = join(directory, 'downloads')
  const settings = new SettingsService({
    filePath: join(directory, 'settings.json'),
    defaultDownloadDirectory: destination,
  })
  settings.update({ maxConcurrentDownloads: 1 })

  const engine: DownloadEngine = {
    id: 'fake',
    displayName: 'Fake',
    capabilities: {
      ...capabilities,
      pauseResume: options.pauseResume ?? false,
      resumeAfterRestart: options.resumeAfterRestart ?? false,
    },
    match: (input) =>
      input.kind === 'text' && input.value === 'fake:'
        ? { kind: 'supported', source, priority: 100 }
        : null,
    resolveSelection: () => ({
      engineId: 'fake',
      data: {},
      requiredDependencies: [],
      filenameBase: 'fake-output',
      details: null,
      verification: null,
    }),
    start: async (_job, ctx: EngineRunContext) => {
      ctx.emit({ type: 'phase', phase: 'downloading' })
      ctx.emit({ type: 'progress', downloadedBytes: 50, totalBytes: 100 })

      if (state.mode === 'hang') {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 10_000)
          const onAbort = (): void => {
            clearTimeout(timer)
            ctx.signal.removeEventListener('abort', onAbort)
            reject(new DomainError('CANCELLED', 'cancelled'))
          }
          ctx.signal.addEventListener('abort', onAbort, { once: true })
        })
      }

      const outputPath = join(ctx.workspaceDir, 'fake-output.mp4')
      await writeFile(outputPath, 'fake media')
      return { output: { kind: 'file', path: outputPath }, totalBytes: 10 }
    },
  }

  const registry = new EngineRegistry()
  registry.register(engine)
  const previews = new PreviewCache()
  const preview: EnginePreviewData = {
    engineId: 'fake',
    source,
    title: 'Fake download',
    subtitle: null,
    thumbnailUrl: null,
    durationSeconds: 10,
    data: {},
  }
  const previewToken = previews.put(preview).token

  const jobEvents: string[] = []
  const jobs = new JsonJobRepository(join(directory, 'jobs.json'))
  const manager = new DownloadManager({
    registry,
    jobs,
    settings,
    files: new FileService(),
    verifier: {} as MediaVerifier,
    dependencies: {
      resolveExecutable: () => null,
    } as unknown as DependencyService,
    previews,
    logger: new Logger(join(directory, 'logs')),
    onJobChanged: (job) => jobEvents.push(`${job.id}:${job.status}`),
    onJobRemoved: () => undefined,
  })

  return {
    manager,
    settings,
    jobs,
    destination,
    previewToken,
    jobEvents,
    setMode: (mode) => {
      state.mode = mode
    },
  }
}

function persistedJob(overrides: Partial<PersistedJobRecord> = {}): PersistedJobRecord {
  const now = new Date().toISOString()
  return {
    id: 'recovered-job',
    revision: 1,
    engineId: 'fake',
    source,
    title: 'Recovered job',
    status: 'queued',
    progress: {
      downloadedBytes: 10,
      totalBytes: 100,
      percent: 10,
      bytesPerSecond: 5,
      etaSeconds: 18,
    },
    destination: 'C:\\downloads',
    output: null,
    details: null,
    error: null,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    scheduledAt: null,
    selection: null,
    workspaceDirectory: null,
    ...overrides,
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for condition')
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('download manager', () => {
  it('runs a job through queue, finalization, and completion', async () => {
    const fixture = createFixture('complete')
    const job = await fixture.manager.createJob({
      previewToken: fixture.previewToken,
      selection: { mode: 'best-up-to-4k' },
      destination: fixture.destination,
    })

    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'completed')
    await waitFor(() => fixture.jobEvents.some((event) => event.endsWith(':completed')))
    const completed = fixture.manager.getJob(job.id)
    expect(completed?.progress.percent).toBe(100)
    expect(completed?.output?.files[0]?.path).toBe(join(fixture.destination, 'fake-output.mp4'))
    expect(existsSync(completed?.output?.files[0]?.path ?? '')).toBe(true)
    expect(fixture.jobEvents.some((event) => event.endsWith(':downloading'))).toBe(true)
    expect(fixture.jobEvents.some((event) => event.endsWith(':completed'))).toBe(true)

    await fixture.manager.removeJob(job.id)
    expect(fixture.manager.getJob(job.id)).toBeNull()
    expect(existsSync(completed?.output?.files[0]?.path ?? '')).toBe(true)
    await fixture.manager.shutdown()
  })

  it('cancels an active job and cleans its workspace', async () => {
    const fixture = createFixture('hang')
    const job = await fixture.manager.createJob({
      previewToken: fixture.previewToken,
      selection: { mode: 'best-up-to-4k' },
      destination: fixture.destination,
    })

    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'downloading')
    const cancelled = await fixture.manager.cancelJob(job.id)
    expect(cancelled.status).toBe('cancelled')
    expect(existsSync(join(fixture.destination, '.nexfetch-tmp', job.id))).toBe(false)
    await fixture.manager.shutdown()
  })

  it('retries a cancelled job and completes it', async () => {
    const fixture = createFixture('hang')
    const job = await fixture.manager.createJob({
      previewToken: fixture.previewToken,
      selection: { mode: 'best-up-to-4k' },
      destination: fixture.destination,
    })

    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'downloading')
    await fixture.manager.cancelJob(job.id)
    fixture.setMode('complete')

    const retried = await fixture.manager.retryJob(job.id)
    expect(['queued', 'resolving', 'downloading']).toContain(retried.status)
    expect(retried.attempt).toBe(2)

    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'completed')
    const completed = fixture.manager.getJob(job.id)
    expect(existsSync(completed?.output?.files[0]?.path ?? '')).toBe(true)
    await fixture.manager.removeJob(job.id)
    await fixture.manager.shutdown()
  })

  it('pauses and resumes a capable job without deleting its workspace', async () => {
    const fixture = createFixture('hang', { pauseResume: true })
    const job = await fixture.manager.createJob({
      previewToken: fixture.previewToken,
      selection: { mode: 'best-up-to-4k' },
      destination: fixture.destination,
    })

    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'downloading')
    const paused = await fixture.manager.pauseJob(job.id)
    expect(paused.status).toBe('paused')
    expect(existsSync(join(fixture.destination, '.nexfetch-tmp', job.id))).toBe(true)

    fixture.setMode('complete')
    const resumed = await fixture.manager.resumeJob(job.id)
    expect(['queued', 'resolving', 'downloading']).toContain(resumed.status)
    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'completed')
    await fixture.manager.shutdown()
  })

  it('starts a scheduled job when its time arrives', async () => {
    const fixture = createFixture('complete')
    const job = await fixture.manager.createJob({
      previewToken: fixture.previewToken,
      selection: { mode: 'best-up-to-4k' },
      destination: fixture.destination,
      scheduledAt: new Date(Date.now() + 150).toISOString(),
    })

    expect(job.status).toBe('queued')
    await waitFor(() => fixture.manager.getJob(job.id)?.status === 'completed', 4000)
    await fixture.manager.shutdown()
  })

  it('recovers resumable interrupted jobs and fails non-resumable ones', () => {
    const resumable = createFixture('complete', { resumeAfterRestart: true })
    resumable.jobs.save(
      persistedJob({
        id: 'resumable',
        status: 'downloading',
        workspaceDirectory: join(resumable.destination, '.nexfetch-tmp', 'resumable'),
      }),
    )
    resumable.manager.recoverInterruptedJobs()
    expect(resumable.manager.getJob('resumable')?.status).toBe('queued')

    const nonResumable = createFixture('complete')
    nonResumable.jobs.save(
      persistedJob({
        id: 'not-resumable',
        status: 'downloading',
        workspaceDirectory: null,
      }),
    )
    nonResumable.manager.recoverInterruptedJobs()
    expect(nonResumable.manager.getJob('not-resumable')?.status).toBe('failed')

    void resumable.manager.shutdown()
    void nonResumable.manager.shutdown()
  })

  it('leaves queued and paused jobs untouched during recovery', () => {
    const fixture = createFixture('complete')
    fixture.jobs.save(persistedJob({ id: 'queued', status: 'queued' }))
    fixture.jobs.save(persistedJob({ id: 'paused', status: 'paused' }))

    fixture.manager.recoverInterruptedJobs()
    expect(fixture.manager.getJob('queued')?.status).toBe('queued')
    expect(fixture.manager.getJob('paused')?.status).toBe('paused')
    void fixture.manager.shutdown()
  })
})
