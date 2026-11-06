import type {
  TorrentDiscovery,
  TorrentFileEntry,
  TorrentPeerEntry,
  TorrentTrackerEntry,
} from '@shared/domain/torrent'

export interface HelperTorrentStatus {
  id: string
  title: string
  state: string
  progress: number
  downloadedBytes: number
  totalBytes: number
  downloadRateBytesPerSecond: number
  uploadRateBytesPerSecond: number
  etaSeconds: number | null
  uploadedBytes: number
  ratio: number | null
  seedsConnected: number
  seedsAvailable: number | null
  peersConnected: number
  peersAvailable: number | null
  isPrivate: boolean
  infoHash: string
  hashVersion: 1 | 2
  files: TorrentFileEntry[]
  trackers: TorrentTrackerEntry[]
  peers: TorrentPeerEntry[]
  downloadLimitBytesPerSecond: number | null
  uploadLimitBytesPerSecond: number | null
  maxConnections: number | null
  seedAfterComplete: boolean
  discovery: TorrentDiscovery
  error: string | null
}

export interface HelperPreview {
  title: string
  totalBytes: number
  files: TorrentFileEntry[]
  fileCount: number
  infoHash: string
  hashVersion: 1 | 2
  isPrivate: boolean
  trackers: TorrentTrackerEntry[]
  sourceKind: 'file' | 'infohash' | 'magnet'
  createdAt: string | null
  createdBy: string | null
  comment: string | null
  webSeedCount: number
  metadataPath?: string
}

export interface HelperResolveProgress {
  requestId: string
  dhtNodes: number | null
  peers: number | null
  elapsedMs: number
  message: string
}

export interface HelperEvent {
  event: string
  data: unknown
}

export interface HelperResult<T> {
  id: string
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}
