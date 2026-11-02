import type { DownloadJob } from '../domain/job'
import type { AppError } from '../domain/errors'
import type { YoutubePreviewEnvelope, YoutubeSelection } from '../domain/youtube'

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export interface AppInfo {
  name: string
  version: string
  platform: string
  isPackaged: boolean
}

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  downloadDirectory: string
  maxConcurrentDownloads: number
  concurrentFragments: number
  theme: Theme
}

export type SettingsPatch = Partial<Settings>

export type DependencyId = 'yt-dlp' | 'ffmpeg' | 'ffprobe'
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
}

export interface CreateJobRequest {
  previewToken: string
  selection: YoutubeSelection
  destination: string
}

export interface YoutubePreviewRequest {
  url: string
  requestId: string
}

export interface JobIdRequest {
  jobId: string
}

export interface OpenLocationRequest {
  jobId: string
  revealFile?: boolean
}

export type { DownloadJob, YoutubePreviewEnvelope, YoutubeSelection }
