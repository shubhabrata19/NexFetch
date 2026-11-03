import type { DownloadJob, DownloadSource, EngineDetails, EngineId, JobId, JobOutput } from './job'

export type SourceInput = { kind: 'text'; value: string } | { kind: 'file'; path: string }

export type EngineMatch =
  | { kind: 'supported'; source: DownloadSource; priority: number }
  | { kind: 'unsupported'; reason: string; priority: number }

export interface EngineCapabilities {
  preview: boolean
  selectableFormats: boolean
  fileSelection: boolean
  audioOnly: boolean
  pauseResume: boolean
  resumeAfterRestart: boolean
  /** The engine writes directly into the final destination instead of a workspace. */
  directOutput: boolean
  checksumVerification: boolean
  seeding: boolean
  liveSpeed: boolean
  eta: boolean
  peerStats: boolean
  parallelFragmentDownloads: boolean
}

export interface EngineLogger {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

export interface DependencyLocator {
  resolve(id: 'yt-dlp' | 'ffmpeg' | 'ffprobe'): { path: string; version: string | null } | null
}

export interface EngineContext {
  signal: AbortSignal
  logger: EngineLogger
  dependencies: DependencyLocator
}

export interface EngineRunContext extends EngineContext {
  job: DownloadJob
  selection: EngineSelection
  workspaceDir: string
  resume: boolean
  concurrentFragments: number
  maxDownloadRateBytesPerSecond: number
  emit(event: EngineEvent): void
}

export type EngineEvent =
  | { type: 'phase'; phase: 'resolving' | 'downloading' | 'processing' | 'verifying' | 'seeding' }
  | { type: 'output'; output: JobOutput }
  | {
      type: 'progress'
      downloadedBytes?: number | null
      totalBytes?: number | null
      bytesPerSecond?: number | null
      etaSeconds?: number | null
    }
  | { type: 'details'; patch: Partial<EngineDetails> }
  | { type: 'warning'; code: string; message: string }

export interface EngineResult {
  output: { kind: 'file' | 'directory'; path: string }
  totalBytes: number | null
  files?: Array<{ path: string; bytes: number | null }>
}

export interface EnginePreviewData {
  engineId: EngineId
  source: DownloadSource
  title: string
  subtitle: string | null
  thumbnailUrl: string | null
  durationSeconds: number | null
  data: unknown
}

export interface EngineSelection {
  engineId: EngineId
  data: unknown
  requiredDependencies: readonly ('yt-dlp' | 'ffmpeg' | 'ffprobe')[]
  filenameBase: string
  details: EngineDetails | null
  verification: {
    expectedVideoHeight: number | null
    requireAudio: boolean
  } | null
}

export interface DownloadEngine {
  readonly id: EngineId
  readonly displayName: string
  readonly capabilities: EngineCapabilities

  match(input: SourceInput): EngineMatch | null

  preview?(source: DownloadSource, ctx: EngineContext): Promise<EnginePreviewData>

  resolveSelection(preview: EnginePreviewData, selection: unknown): EngineSelection

  /** Applies setup-page edits before a deferred job is queued. */
  updateSelection?(job: DownloadJob, selection: EngineSelection, update: unknown): EngineSelection

  start(job: DownloadJob, ctx: EngineRunContext): Promise<EngineResult>

  pause?(jobId: JobId): Promise<void>
  resume?(jobId: JobId): Promise<void>
  stopSeeding?(jobId: JobId): Promise<void>
  setLimits?(
    job: DownloadJob,
    downloadLimitBytesPerSecond: number | null,
    uploadLimitBytesPerSecond: number | null,
  ): Promise<void>
  findMorePeers?(job: DownloadJob): Promise<void>
  verify?(job: DownloadJob): Promise<void>
  removeJob?(job: DownloadJob): Promise<void>
  dispose?(): Promise<void>
}
