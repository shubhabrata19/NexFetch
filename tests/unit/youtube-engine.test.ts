import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineEvent, EngineRunContext, EngineSelection } from '@shared/domain/engine'
import type { DownloadJob, YoutubeJobDetails } from '@shared/domain/job'
import type { YoutubeResolvedSelection } from '@shared/domain/youtube'
import { YoutubeEngine } from '@main/engines/youtube/youtube-engine'
import type { ProcessRunOptions, ProcessRunResult } from '@main/services/process-runner'

const temporaryDirectories: string[] = []

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function createContext(
  overrides: Partial<EngineRunContext> = {},
  selectionOverrides: Partial<YoutubeResolvedSelection> = {},
): {
  ctx: EngineRunContext
  events: EngineEvent[]
  workspaceDir: string
} {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'nexfetch-youtube-engine-'))
  temporaryDirectories.push(workspaceDir)

  const resolved: YoutubeResolvedSelection = {
    mode: 'video',
    videoFormatId: '137',
    audioFormatId: '140',
    expectedVideoHeight: 1080,
    requiresFfmpeg: true,
    container: 'mp4',
    selector: '137+140',
    formatIds: ['137', '140'],
    fragmented: true,
    ...selectionOverrides,
  }

  const details: YoutubeJobDetails = {
    engineId: 'youtube',
    videoId: 'video123',
    channel: 'Example Channel',
    thumbnailUrl: null,
    selectedVideo: { formatId: '137', label: '1080p', ext: 'mp4', sizeBytes: 1000 },
    selectedAudio: { formatId: '140', label: 'Audio', ext: 'm4a', sizeBytes: 100 },
    container: 'mp4',
  }

  const selection: EngineSelection = {
    engineId: 'youtube',
    data: resolved,
    requiredDependencies: ['yt-dlp', 'ffmpeg'],
    filenameBase: 'Example [video123]',
    details,
    verification: { expectedVideoHeight: 1080, requireAudio: true },
  }

  const job = {
    source: {
      kind: 'youtube',
      videoId: 'video123',
      canonicalUrl: 'https://www.youtube.com/watch?v=video123',
    },
  } as unknown as DownloadJob

  const events: EngineEvent[] = []
  const ctx: EngineRunContext = {
    job,
    selection,
    workspaceDir,
    resume: false,
    concurrentFragments: 4,
    maxDownloadRateBytesPerSecond: 0,
    signal: new AbortController().signal,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    dependencies: {
      resolve: (id) => ({ path: `C:\\tools\\${id}.exe`, version: null }),
    },
    emit: (event) => events.push(event),
    ...overrides,
  }

  return { ctx, events, workspaceDir }
}

function successfulRunner(
  workspaceDir: string,
  options: {
    args?: string[]
    onRun?: (options: ProcessRunOptions) => void
  } = {},
): (options: ProcessRunOptions) => Promise<ProcessRunResult> {
  return async (runOptions) => {
    options.args?.push(...runOptions.args)
    options.onRun?.(runOptions)
    const output = join(workspaceDir, 'video123.mp4')
    writeFileSync(output, 'media')
    runOptions.onStdoutLine?.(`NXF_FILE ${JSON.stringify(output)}`)
    return {
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    }
  }
}

describe('youtube engine', () => {
  it('advertises parallel fragment downloads', () => {
    const engine = new YoutubeEngine()
    expect(engine.capabilities.parallelFragmentDownloads).toBe(true)
  })

  it('passes the configured fragment concurrency to yt-dlp', async () => {
    const { ctx, workspaceDir } = createContext({ concurrentFragments: 8 })
    const args: string[] = []
    const engine = new YoutubeEngine(successfulRunner(workspaceDir, { args }))

    await engine.start(ctx.job, ctx)

    const index = args.indexOf('--concurrent-fragments')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(args[index + 1]).toBe('8')
  })

  it('aggregates progress across the selected video and audio streams', async () => {
    const { ctx, events, workspaceDir } = createContext()
    const lines = [
      'NXF_PROGRESS {"formatId":"137","progress":{"status":"downloading","downloaded_bytes":250,"total_bytes":1000,"speed":100,"eta":8}}',
      'NXF_PROGRESS {"formatId":"137","progress":{"status":"finished","downloaded_bytes":1000,"total_bytes":1000,"speed":100,"eta":0}}',
      'NXF_PROGRESS {"formatId":"140","progress":{"status":"downloading","downloaded_bytes":50,"total_bytes":100,"speed":20,"eta":3}}',
      'NXF_PROGRESS {"formatId":"140","progress":{"status":"finished","downloaded_bytes":100,"total_bytes":100,"speed":20,"eta":0}}',
    ]
    const engine = new YoutubeEngine(
      successfulRunner(workspaceDir, {
        onRun: (runOptions) => {
          for (const line of lines) runOptions.onStdoutLine?.(line)
        },
      }),
    )

    await engine.start(ctx.job, ctx)

    const progress = events.filter(
      (event): event is Extract<EngineEvent, { type: 'progress' }> => event.type === 'progress',
    )
    expect(progress.map((entry) => [entry.downloadedBytes, entry.totalBytes])).toEqual([
      [250, 1100],
      [1000, 1100],
      [1050, 1100],
      [1100, 1100],
    ])

    const processingIndex = events.findIndex(
      (event) => event.type === 'phase' && event.phase === 'processing',
    )
    const videoFinishedIndex = events.findIndex(
      (event) =>
        event.type === 'progress' && event.downloadedBytes === 1000 && event.totalBytes === 1100,
    )
    expect(processingIndex).toBeGreaterThan(videoFinishedIndex)
  })

  it('omits --limit-rate when downloads are unlimited', async () => {
    const { ctx, workspaceDir } = createContext()
    const args: string[] = []
    const engine = new YoutubeEngine(successfulRunner(workspaceDir, { args }))

    await engine.start(ctx.job, ctx)

    expect(args).not.toContain('--limit-rate')
  })

  it('divides the per-download speed limit across fragment connections', async () => {
    const { ctx, workspaceDir } = createContext({
      concurrentFragments: 4,
      maxDownloadRateBytesPerSecond: 10 * 1024 * 1024,
    })
    const args: string[] = []
    const engine = new YoutubeEngine(successfulRunner(workspaceDir, { args }))

    await engine.start(ctx.job, ctx)

    const index = args.indexOf('--limit-rate')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(args[index + 1]).toBe(String(Math.ceil((10 * 1024 * 1024) / 4)))
  })

  it('applies the full speed limit when the download is not fragmented', async () => {
    const { ctx, workspaceDir } = createContext(
      {
        concurrentFragments: 4,
        maxDownloadRateBytesPerSecond: 10 * 1024 * 1024,
      },
      { fragmented: false },
    )
    const args: string[] = []
    const engine = new YoutubeEngine(successfulRunner(workspaceDir, { args }))

    await engine.start(ctx.job, ctx)

    expect(args).not.toContain('--concurrent-fragments')
    const index = args.indexOf('--limit-rate')
    expect(index).toBeGreaterThanOrEqual(0)
    expect(args[index + 1]).toBe(String(10 * 1024 * 1024))
  })
})
