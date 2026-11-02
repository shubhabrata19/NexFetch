import type { AppError } from '../domain/errors'

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
