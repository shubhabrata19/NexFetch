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

function createContext(overrides: Partial<EngineRunContext> = {}): {
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
})
