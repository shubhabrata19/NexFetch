import type { AppError } from './errors'
import type { TorrentJobDetails } from './torrent'

export type EngineId = string
export type JobId = string

export type YoutubeDownloadSource = {
  kind: 'youtube'
  videoId: string
  canonicalUrl: string
}

export type HttpDownloadSource = {
  kind: 'http'
  /** Full URL, including query parameters. Never write this to logs. */
  url: string
  host: string
}

export type TorrentDownloadSource = {
  kind: 'torrent'
  infoHash: string
  hashVersion: 1 | 2
  sourceKind: 'file' | 'infohash'
  displayName: string
}

export type DownloadSource = YoutubeDownloadSource | HttpDownloadSource | TorrentDownloadSource

export type JobStatus =
  | 'setup'
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

export interface HttpChecksumState {
  algorithm: 'sha256'
  expectedHex: string
  verified: boolean | null
}

export interface HttpJobDetails {
  engineId: 'http'
  host: string
  /** Host and path only; query parameters are intentionally omitted. */
  displayUrl: string
  contentType: string | null
  contentLength: number | null
  acceptRanges: boolean
  resumable: boolean
  etag: string | null
  lastModified: string | null
  checksum: HttpChecksumState | null
}

export type EngineDetails = YoutubeJobDetails | HttpJobDetails | TorrentJobDetails

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
  scheduledAt: string | null
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

export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
