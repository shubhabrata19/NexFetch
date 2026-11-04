import type { EngineCapabilities } from '../domain/engine'
import type { HttpPreviewEnvelope, HttpSelection } from '../domain/http'
import type { DownloadJob } from '../domain/job'
import type { AppError } from '../domain/errors'
import type {
  TorrentPreviewEnvelope,
  TorrentSelection,
  TorrentSetupUpdate,
} from '../domain/torrent'
import type { YoutubePreviewEnvelope, YoutubeSelection } from '../domain/youtube'

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export interface AppInfo {
  name: string
  version: string
  platform: string
  isPackaged: boolean
}

export type Theme = 'system' | 'light' | 'dark'

export type TorrentConnectionProfile = 'balanced' | 'high' | 'maximum'

export interface Settings {
  downloadDirectory: string
  maxConcurrentDownloads: number
  concurrentFragments: number
  maxDownloadRateBytesPerSecond: number
  maxUploadRateBytesPerSecond: number
  torrentConnectionProfile: TorrentConnectionProfile
  torrentNATMapping: boolean
  torrentSeedAfterComplete: boolean
  resumeIncompleteDownloads: boolean
  theme: Theme
}

export type SettingsPatch = Partial<Settings>

export type DependencyId = 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'torrent-helper'
export type DependencyState = 'ready' | 'missing' | 'error'
export type DependencySource = 'bundled' | 'system' | 'env'

export interface DependencyInfo {
  id: DependencyId
  state: DependencyState
  version: string | null
  source: DependencySource | null
}

export interface DependencyStatus {
  ytDlp: DependencyInfo
  ffmpeg: DependencyInfo
  ffprobe: DependencyInfo
  torrentHelper: DependencyInfo
}

export interface CreateJobRequest {
  previewToken: string
  selection: YoutubeSelection | HttpSelection | TorrentSelection
  destination: string
  /** Optional ISO timestamp for a one-time scheduled start. */
  scheduledAt?: string
  /** Torrents open in Setup and are queued only after explicit confirmation. */
  deferStart?: boolean
}

export interface TorrentBytesPreviewRequest {
  requestId: string
  name: string
  dataBase64: string
}

export interface TorrentSetupUpdateRequest extends TorrentSetupUpdate {
  jobId: string
}

export interface TorrentLimitsRequest {
  jobId: string
  downloadLimitBytesPerSecond: number | null
  uploadLimitBytesPerSecond: number | null
}

export interface YoutubePreviewRequest {
  url: string
  requestId: string
}

export interface PreviewRequest {
  url: string
  requestId: string
}

export type SourcePreviewEnvelope =
  (YoutubePreviewEnvelope & { engineId: 'youtube' }) | HttpPreviewEnvelope | TorrentPreviewEnvelope

export interface EngineInfo {
  id: string
  displayName: string
  capabilities: EngineCapabilities
}

export interface JobIdRequest {
  jobId: string
}

export interface OpenLocationRequest {
  jobId: string
  revealFile?: boolean
}

export type {
  DownloadJob,
  HttpPreviewEnvelope,
  HttpSelection,
  TorrentPreviewEnvelope,
  TorrentSelection,
  YoutubePreviewEnvelope,
  YoutubeSelection,
}
