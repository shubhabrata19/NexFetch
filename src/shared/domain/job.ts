import type { AppError } from './errors'

export type EngineId = string
export type JobId = string

export type DownloadSource = {
  kind: 'youtube'
  videoId: string
  canonicalUrl: string
}

export type JobStatus =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'processing'
  | 'verifying'
  | 'paused'
  | 'seeding'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface JobProgress {
  downloadedBytes: number | null
  totalBytes: number | null
  percent: number | null
  bytesPerSecond: number | null
  etaSeconds: number | null
}

export interface FormatSummary {
  formatId: string
  label: string
  ext: string
  sizeBytes: number | null
}

export interface YoutubeJobDetails {
  engineId: 'youtube'
  videoId: string
  channel: string | null
  thumbnailUrl?: string | null
  selectedVideo: FormatSummary | null
  selectedAudio: FormatSummary | null
  container: string | null
}

export type EngineDetails = YoutubeJobDetails

export interface JobOutput {
  directory: string
  files: Array<{ path: string; bytes: number | null }>
}

export interface DownloadJob {
  id: JobId
  revision: number
  engineId: EngineId
  source: DownloadSource
  title: string
  status: JobStatus
  progress: JobProgress
  destination: string
  output: JobOutput | null
  details: EngineDetails | null
  error: AppError | null
  attempt: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export function emptyProgress(): JobProgress {
  return {
    downloadedBytes: null,
    totalBytes: null,
    percent: null,
    bytesPerSecond: null,
    etaSeconds: null,
  }
}
