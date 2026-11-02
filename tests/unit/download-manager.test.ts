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
  audioOnly: false,
  pauseResume: false,
  resumeAfterRestart: false,
  checksumVerification: false,
  seeding: false,
  liveSpeed: true,
  eta: true,
  peerStats: false,
}

const temporaryDirectories: string[] = []

function createFixture(initialMode: 'complete' | 'hang'): {
  manager: DownloadManager
  settings: SettingsService
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
    capabilities,
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
  const manager = new DownloadManager({
    registry,
    jobs: new JsonJobRepository(join(directory, 'jobs.json')),
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
    destination,
    previewToken,
    jobEvents,
    setMode: (mode) => {
      state.mode = mode
    },
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
})
