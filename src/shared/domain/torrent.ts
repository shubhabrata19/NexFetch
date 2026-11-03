export type TorrentHashVersion = 1 | 2
export type TorrentSourceKind = 'file' | 'infohash'

export interface TorrentFileEntry {
  index: number
  /** Normalized path using forward slashes. */
  path: string
  name: string
  sizeBytes: number
  selected: boolean
  executable: boolean
  downloadedBytes: number | null
}

export type TorrentTrackerStatus = 'working' | 'error' | 'unknown'

export interface TorrentTrackerEntry {
  url: string
  tier: number
  status: TorrentTrackerStatus
  message: string | null
  seeds: number | null
  peers: number | null
  nextAnnounceSeconds: number | null
}

export interface TorrentPeerEntry {
  address: string
  client: string
  progress: number
  downloadRateBytesPerSecond: number
  uploadRateBytesPerSecond: number
  seed: boolean
  flags: string
}

export type TorrentNATStatus = 'mapped' | 'unavailable' | 'disabled' | null

export interface TorrentDiscovery {
  dht: boolean
  pex: boolean
  lsd: boolean
  natMapping: boolean
  natStatus: TorrentNATStatus
  listenPort: number | null
  incomingConnections: boolean
  dhtNodes: number | null
  webSeeds: 'disabled'
}

export interface TorrentPreview {
  title: string
  totalBytes: number
  files: TorrentFileEntry[]
  fileCount: number
  infoHash: string
  hashVersion: TorrentHashVersion
  isPrivate: boolean
  trackers: TorrentTrackerEntry[]
  sourceKind: TorrentSourceKind
  createdAt: string | null
  createdBy: string | null
  comment: string | null
  webSeedCount: number
}

export interface TorrentPreviewEnvelope extends TorrentPreview {
  engineId: 'torrent'
  previewToken: string
  expiresAt: string
}

export interface TorrentSelection {
  fileIndices: number[]
  downloadLimitBytesPerSecond?: number | null
  uploadLimitBytesPerSecond?: number | null
  seedAfterComplete?: boolean
}

export interface TorrentResolvedSelection {
  metadataPath: string
  infoHash: string
  hashVersion: TorrentHashVersion
  title: string
  isPrivate: boolean
  fileCount: number
  fileIndices: number[]
  downloadLimitBytesPerSecond: number | null
  uploadLimitBytesPerSecond: number | null
  seedAfterComplete: boolean
}

export interface TorrentSetupUpdate {
  destination: string
  fileIndices: number[]
  downloadLimitBytesPerSecond: number | null
  uploadLimitBytesPerSecond: number | null
  seedAfterComplete: boolean
}

export interface TorrentJobDetails {
  engineId: 'torrent'
  infoHash: string
  hashVersion: TorrentHashVersion
  isPrivate: boolean
  files: TorrentFileEntry[]
  trackers: TorrentTrackerEntry[]
  peers: TorrentPeerEntry[]
  seedsConnected: number | null
  seedsAvailable: number | null
  peersConnected: number | null
  peersAvailable: number | null
  downloadRateBytesPerSecond: number | null
  uploadRateBytesPerSecond: number | null
  uploadedBytes: number | null
  ratio: number | null
  downloadLimitBytesPerSecond: number | null
  uploadLimitBytesPerSecond: number | null
  seedAfterComplete: boolean
  discovery: TorrentDiscovery
}

export interface TorrentResolveProgress {
  requestId: string
  dhtNodes: number | null
  peers: number | null
  elapsedMs: number
  message: string
}
