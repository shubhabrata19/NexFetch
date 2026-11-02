import type { VideoFormat } from './quality'

export interface YoutubeVideoInfo {
  id: string
  title: string
  channel: string | null
  durationSeconds: number | null
  thumbnailUrl: string | null
  uploadDate: string | null
  canonicalUrl: string
}

export interface YoutubeFormat extends VideoFormat {
  label: string
  resolutionLabel: string
  note: string | null
  protocol: string | null
}

export interface YoutubeBestChoice {
  videoFormatId: string
  audioFormatId: string | null
  requiresFfmpeg: boolean
  estimatedBytes: number | null
  predictedContainer: string
  resolutionLabel: string
}

export interface YoutubePreview {
  video: YoutubeVideoInfo
  formats: YoutubeFormat[]
  bestUpTo4k: YoutubeBestChoice | null
  audioOnlyAvailable: boolean
}

export interface YoutubePreviewEnvelope extends YoutubePreview {
  previewToken: string
  expiresAt: string
}

export type YoutubeSelection =
  | { mode: 'best-up-to-4k' }
  | { mode: 'video'; videoFormatId: string; audioFormatId?: string }
  | { mode: 'audio'; audioFormatId: string }

export interface YoutubeResolvedSelection {
  mode: 'video' | 'audio'
  videoFormatId: string | null
  audioFormatId: string | null
  expectedVideoHeight: number | null
  requiresFfmpeg: boolean
  container: string
  selector: string
  formatIds: string[]
  fragmented: boolean
}
