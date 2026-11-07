import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DownloadJob, Settings, TorrentSetupUpdateRequest } from '@shared/ipc/contracts'
import type {
  TorrentFileEntry,
  TorrentJobDetails,
  TorrentPeerEntry,
  TorrentTrackerEntry,
} from '@shared/domain/torrent'
import { Icon } from '../../components/Icon'
import { PeerLimitInput } from '../../components/PeerLimitInput'
import {
  RateLimitInput,
  rateDraftFromBytes,
  rateDraftToBytes,
} from '../../components/RateLimitInput'
import type { RateLimitDraft } from '../../components/RateLimitInput'
import { formatBytes, formatEta, formatSpeed } from '../../lib/format'
import { defaultTorrentDestination, torrentFolderName } from '../../lib/paths'
import {
  connectionProfileLabel,
  parsePeerLimit,
  peerLimitDraft,
  profilePeerLimit,
} from '../../lib/torrent-limits'
import { cleanPeerClientName, sortPeers } from './peer-sort'
import type { PeerSortDirection, PeerSortKey } from './peer-sort'

interface TorrentsPageProps {
  settings: Settings
  jobs: DownloadJob[]
  selectedJobId: string | null
  onSelectJob: (jobId: string | null) => void
  onStartSetup: (request: TorrentSetupUpdateRequest) => Promise<DownloadJob | null>
  onCancelJob: (jobId: string) => void
  onPauseJob: (jobId: string) => void
  onResumeJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onStartSeeding: (jobId: string) => void
  onStopSeeding: (jobId: string) => void
  onRequestRemoveJob: (jobId: string) => void
  onRequestCloseTorrent: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
  onFindMorePeers: (jobId: string) => void
  onVerifyTorrent: (jobId: string) => void
  onSetTorrentLimits: (
    jobId: string,
    downloadLimitBytesPerSecond: number | null,
    uploadLimitBytesPerSecond: number | null,
    maxConnections: number | null,
  ) => Promise<DownloadJob | null>
  onAddTorrent: () => void
  onOpenSettings: () => void
}

type TorrentFilter = 'all' | 'setup' | 'downloading' | 'seeding' | 'completed'
type DetailTab = 'files' | 'peers' | 'trackers' | 'discovery'

interface SetupState {
  destination: string
  selected: Set<number>
  downloadLimit: RateLimitDraft
  uploadLimit: RateLimitDraft
  maxConnections: string
  seedAfterComplete: boolean
}

const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
  metadata: 'Metadata',
  queued: 'Queued',
  resolving: 'Preparing',
  downloading: 'Downloading',
  processing: 'Processing',
  verifying: 'Verifying',
  paused: 'Paused',
  seeding: 'Seeding',
  cancelling: 'Stopping',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function isTorrentJob(job: DownloadJob): boolean {
  return job.engineId === 'torrent'
}

function torrentDetails(job: DownloadJob): TorrentJobDetails | null {
  return job.details?.engineId === 'torrent' ? job.details : null
}

function isSetupJob(job: DownloadJob): boolean {
  return job.status === 'setup'
}

function isMetadataJob(job: DownloadJob): boolean {
  return job.status === 'metadata'
}

function isMetadataLookupJob(job: DownloadJob): boolean {
  return (
    job.engineId === 'torrent' &&
    job.details?.engineId === 'torrent' &&
    job.details.lookup !== undefined
  )
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function metadataFailureTitle(job: DownloadJob): string {
  if (job.error?.code === 'TORRENT_UNAVAILABLE') return 'Torrent engine unavailable'
  if (job.error?.code === 'TORRENT_INVALID') return 'Lookup failed'
  return 'Metadata not found'
}

function isSeedingJob(job: DownloadJob): boolean {
  return job.status === 'seeding'
}

function isActiveJob(job: DownloadJob): boolean {
  return [
    'metadata',
    'queued',
    'resolving',
    'downloading',
    'processing',
    'verifying',
    'paused',
    'cancelling',
  ].includes(job.status)
}

function isCompletedJob(job: DownloadJob): boolean {
  return job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
}

function effectiveRate(override: number | null, global: number): number {
  return override ?? global
}

function effectiveRateLabel(override: number | null, global: number): string {
  const value = effectiveRate(override, global)
  return value > 0 ? formatSpeed(value) : 'Unlimited'
}

function selectedSize(files: TorrentFileEntry[], selected: Set<number>): number {
  return files
    .filter((file) => selected.has(file.index))
    .reduce((total, file) => total + file.sizeBytes, 0)
}

function peerLabel(peer: TorrentPeerEntry): string {
  return peer.seed ? 'Seed' : 'Peer'
}

function TorrentStatus({ job }: { job: DownloadJob }) {
  const status = job.status
  const tone =
    status === 'completed'
      ? 'badge--success'
      : status === 'failed'
        ? 'badge--danger'
        : status === 'seeding'
          ? 'badge--success'
          : status === 'setup' || status === 'paused' || status === 'cancelled'
            ? 'badge--neutral'
            : 'badge--accent'
  return <span className={`badge ${tone}`}>{STATUS_LABELS[status] ?? status}</span>
}

function TorrentListItem({
  job,
  selected,
  onSelect,
  onPause,
  onResume,
  onClose,
}: {
  job: DownloadJob
  selected: boolean
  onSelect: () => void
  onPause: () => void
  onResume: () => void
  onClose: () => void
}) {
  const details = torrentDetails(job)
  const percent = job.progress.percent
  const canPause =
    job.status === 'queued' ||
    job.status === 'resolving' ||
    job.status === 'downloading' ||
    job.status === 'seeding'
  const canResume = job.status === 'paused'
  const canCloseLookup = job.status === 'metadata'
  return (
    <div
      className={`torrent-list-item${selected ? ' torrent-list-item--selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
    >
      <button type="button" className="torrent-list-main" onClick={onSelect}>
        <div className="torrent-list-top">
          <span className="torrent-list-title" title={job.title}>
            {job.title}
          </span>
          <TorrentStatus job={job} />
        </div>
        {isMetadataJob(job) ? (
          <>
            <div className="progress-track progress-track--compact progress-track--indeterminate">
              <span className="progress-fill" />
            </div>
            <div className="torrent-list-meta">
              <span>{details?.lookup?.phase === 'queued' ? 'Waiting…' : 'Finding peers…'}</span>
              <span>{formatElapsed(details?.lookup?.elapsedMs ?? 0)}</span>
              <span>{details?.lookup?.peers ?? 0} peers</span>
              <span>{details?.lookup?.dhtNodes ?? '—'} DHT</span>
            </div>
          </>
        ) : isSetupJob(job) ? (
          <div className="torrent-list-meta">
            <span>
              {formatBytes(
                job.progress.totalBytes ??
                  details?.files.reduce((sum, file) => sum + file.sizeBytes, 0) ??
                  0,
              )}
            </span>
            <span>
              {details?.files.length ?? 0} {(details?.files.length ?? 0) === 1 ? 'file' : 'files'}
            </span>
          </div>
        ) : isMetadataLookupJob(job) ? (
          <div className="torrent-list-meta">
            <span>
              {job.status === 'cancelled'
                ? 'Lookup cancelled'
                : job.error?.code === 'TORRENT_NO_PEERS'
                  ? 'No metadata found'
                  : 'Lookup failed'}
            </span>
            <span>{details?.lookup?.dhtNodes ?? '—'} DHT</span>
          </div>
        ) : job.status === 'seeding' ? (
          <div className="torrent-list-meta">
            <span>
              ↑ {job.progress.bytesPerSecond ? formatSpeed(job.progress.bytesPerSecond) : '—'}
            </span>
            <span>
              {details?.ratio !== null && details?.ratio !== undefined
                ? `ratio ${details.ratio.toFixed(2)}`
                : 'ratio —'}
            </span>
          </div>
        ) : isCompletedJob(job) ? (
          <div className="torrent-list-meta">
            <span>{formatBytes(job.progress.totalBytes ?? 0)}</span>
            <span>
              {job.status === 'completed' ? 'Verified pieces' : STATUS_LABELS[job.status]}
            </span>
          </div>
        ) : (
          <>
            <div className="progress-track progress-track--compact">
              <span className="progress-fill" style={{ width: `${percent ?? 0}%` }} />
            </div>
            <div className="torrent-list-meta">
              <span>{percent === null ? '—' : `${Math.round(percent)}%`}</span>
              <span>
                ↓ {job.progress.bytesPerSecond ? formatSpeed(job.progress.bytesPerSecond) : '—'}
              </span>
              <span>
                S {details?.seedsConnected ?? '—'} ({details?.seedsAvailable ?? '—'})
              </span>
            </div>
          </>
        )}
      </button>
      <div className="torrent-list-actions">
        {canResume ? (
          <button
            type="button"
            className="torrent-list-icon"
            onClick={onResume}
            title={`Resume ${job.title}`}
            aria-label={`Resume ${job.title}`}
          >
            <Icon name="play" size={13} />
          </button>
        ) : null}
        {canPause ? (
          <button
            type="button"
            className="torrent-list-icon"
            onClick={onPause}
            title={`Pause ${job.title}`}
            aria-label={`Pause ${job.title}`}
          >
            <Icon name="pause" size={13} />
          </button>
        ) : null}
        <button
          type="button"
          className="torrent-list-icon torrent-list-icon--danger"
          onClick={onClose}
          title={canCloseLookup ? `Cancel metadata lookup for ${job.title}` : `Close ${job.title}`}
          aria-label={
            canCloseLookup ? `Cancel metadata lookup for ${job.title}` : `Close ${job.title}`
          }
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  )
}

function SetupFileList({
  files,
  selected,
  onToggle,
}: {
  files: TorrentFileEntry[]
  selected: Set<number>
  onToggle: (index: number, value: boolean) => void
}) {
  return (
    <div className="torrent-file-list">
      {files.map((file) => (
        <label className="torrent-file-row" key={file.index}>
          <input
            className="checkbox-input"
            type="checkbox"
            checked={selected.has(file.index)}
            onChange={(event) => onToggle(file.index, event.target.checked)}
          />
          <span className="torrent-file-main">
            <span className="torrent-file-name" title={file.path}>
              {file.path}
            </span>
            {file.executable ? <span className="badge badge--warning">Executable</span> : null}
          </span>
          <span className="torrent-file-size">{formatBytes(file.sizeBytes)}</span>
        </label>
      ))}
    </div>
  )
}

function LiveFileList({ files, selected }: { files: TorrentFileEntry[]; selected: Set<number> }) {
  return (
    <div className="torrent-file-list">
      {files.map((file) => {
        const percent =
          file.downloadedBytes !== null && file.sizeBytes > 0
            ? Math.min(100, (file.downloadedBytes / file.sizeBytes) * 100)
            : 0
        return (
          <div
            className={`torrent-file-row${selected.has(file.index) ? '' : ' torrent-file-row--skipped'}`}
            key={file.index}
          >
            <span className="torrent-file-main">
              <span className="torrent-file-name" title={file.path}>
                {file.path}
              </span>
              {file.executable ? <span className="badge badge--warning">Executable</span> : null}
            </span>
            <span className="torrent-file-size">
              {file.downloadedBytes !== null ? formatBytes(file.downloadedBytes) : '—'} /{' '}
              {formatBytes(file.sizeBytes)}
            </span>
            <span className="torrent-file-progress">
              <span className="progress-track progress-track--compact">
                <span className="progress-fill" style={{ width: `${percent}%` }} />
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TrackerList({ trackers }: { trackers: TorrentTrackerEntry[] }) {
  if (trackers.length === 0) {
    return <p className="torrent-empty-tab">No trackers. Peer discovery is using DHT.</p>
  }
  return (
    <div className="torrent-table">
      <div className="torrent-table-head">
        <span>Tracker</span>
        <span>Status</span>
        <span>Seeds</span>
        <span>Peers</span>
        <span>Next</span>
      </div>
      {trackers.map((tracker) => (
        <div className="torrent-table-row" key={`${tracker.tier}-${tracker.url}`}>
          <span className="torrent-table-url" title={tracker.url}>
            {tracker.url}
          </span>
          <span
            className={`badge ${tracker.status === 'working' ? 'badge--success' : tracker.status === 'error' ? 'badge--danger' : 'badge--neutral'}`}
          >
            {tracker.status}
          </span>
          <span>{tracker.seeds ?? '—'}</span>
          <span>{tracker.peers ?? '—'}</span>
          <span>
            {tracker.nextAnnounceSeconds !== null ? formatEta(tracker.nextAnnounceSeconds) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

function PeerSortHeader({
  label,
  sortLabel,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string
  sortLabel: string
  sortKey: PeerSortKey
  activeKey: PeerSortKey
  direction: PeerSortDirection
  onSort: (key: PeerSortKey) => void
}) {
  const active = sortKey === activeKey
  return (
    <span
      role="columnheader"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="torrent-sort-button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${sortLabel}`}
        aria-label={`Sort by ${sortLabel}`}
      >
        {label}
        <span
          className={`torrent-sort-indicator${active ? ' torrent-sort-indicator--active' : ''}`}
          aria-hidden="true"
        >
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </span>
  )
}

function PeerList({
  peers,
  sortKey,
  sortDirection,
  onSort,
}: {
  peers: TorrentPeerEntry[]
  sortKey: PeerSortKey
  sortDirection: PeerSortDirection
  onSort: (key: PeerSortKey) => void
}) {
  if (peers.length === 0) {
    return <p className="torrent-empty-tab">No peers connected yet.</p>
  }

  const sorted = sortPeers(peers, sortKey, sortDirection)

  return (
    <div className="torrent-table torrent-table--peers" role="table" aria-label="Connected peers">
      <div className="torrent-table-head" role="row">
        <PeerSortHeader
          label="Address"
          sortLabel="address"
          sortKey="address"
          activeKey={sortKey}
          direction={sortDirection}
          onSort={onSort}
        />
        <PeerSortHeader
          label="Client"
          sortLabel="client"
          sortKey="client"
          activeKey={sortKey}
          direction={sortDirection}
          onSort={onSort}
        />
        <PeerSortHeader
          label="Progress"
          sortLabel="progress"
          sortKey="progress"
          activeKey={sortKey}
          direction={sortDirection}
          onSort={onSort}
        />
        <PeerSortHeader
          label="Down"
          sortLabel="download speed"
          sortKey="download"
          activeKey={sortKey}
          direction={sortDirection}
          onSort={onSort}
        />
        <PeerSortHeader
          label="Up"
          sortLabel="upload speed"
          sortKey="upload"
          activeKey={sortKey}
          direction={sortDirection}
          onSort={onSort}
        />
        <PeerSortHeader
          label="Type"
          sortLabel="peer type"
          sortKey="type"
          activeKey={sortKey}
          direction={sortDirection}
          onSort={onSort}
        />
      </div>
      {sorted.map((peer) => (
        <div className="torrent-table-row" key={peer.address} role="row">
          <span className="torrent-table-url" role="cell" title={peer.address}>
            {peer.address}
          </span>
          <span role="cell" title={cleanPeerClientName(peer.client)}>
            {cleanPeerClientName(peer.client)}
          </span>
          <span role="cell">{Math.round(peer.progress * 100)}%</span>
          <span role="cell">{formatSpeed(peer.downloadRateBytesPerSecond)}</span>
          <span role="cell">{formatSpeed(peer.uploadRateBytesPerSecond)}</span>
          <span role="cell">{peerLabel(peer)}</span>
        </div>
      ))}
    </div>
  )
}

function DiscoveryPanel({ details }: { details: TorrentJobDetails }) {
  const discovery = details.discovery
  return (
    <div className="torrent-discovery">
      <div className="torrent-discovery-row">
        <span>DHT</span>
        <span>
          {discovery.dht ? `On · ${discovery.dhtNodes ?? '—'} nodes` : 'Off (private torrent)'}
        </span>
      </div>
      <div className="torrent-discovery-row">
        <span>PEX</span>
        <span>{discovery.pex ? 'On' : 'Off (private torrent)'}</span>
      </div>
      <div className="torrent-discovery-row">
        <span>Local peer discovery</span>
        <span>{discovery.lsd ? 'On' : 'Off (private torrent)'}</span>
      </div>
      <div className="torrent-discovery-row">
        <span>Incoming</span>
        <span>
          {discovery.listenPort !== null ? `Port ${discovery.listenPort}` : '—'} ·{' '}
          {discovery.incomingConnections ? 'reachable' : 'not reachable yet'}
        </span>
      </div>
      <div className="torrent-discovery-row">
        <span>NAT mapping</span>
        <span>
          {discovery.natMapping
            ? discovery.natStatus === 'mapped'
              ? 'Mapped'
              : discovery.natStatus === 'unavailable'
                ? 'Unavailable'
                : 'On'
            : 'Off'}
        </span>
      </div>
      <div className="torrent-discovery-row">
        <span>Web seeds</span>
        <span>Disabled for security</span>
      </div>
    </div>
  )
}

function MetadataLookupPanel({
  job,
  details,
  onCancel,
  onRetry,
  onAddTorrent,
}: {
  job: DownloadJob
  details: TorrentJobDetails
  onCancel: () => void
  onRetry: () => void
  onAddTorrent: () => void
}) {
  const lookup = details.lookup
  const failed = job.status === 'failed' || job.status === 'cancelled'
  const queued = lookup?.phase === 'queued'
  const message =
    job.error?.message ??
    lookup?.message ??
    'NexFetch is asking the DHT for peers that can provide this torrent’s metadata.'

  return (
    <div className="torrent-detail-body">
      <section className="torrent-metadata-panel">
        <div className="torrent-metadata-heading">
          <span
            className={`torrent-metadata-icon${failed ? ' torrent-metadata-icon--failed' : ''}`}
          >
            {failed ? (
              <Icon name="alert" size={20} />
            ) : (
              <span className="spinner torrent-metadata-spinner" aria-hidden="true" />
            )}
          </span>
          <div>
            <p className="eyebrow">Metadata lookup</p>
            <h3>
              {failed
                ? job.status === 'cancelled'
                  ? 'Lookup cancelled'
                  : metadataFailureTitle(job)
                : queued
                  ? 'Waiting for a lookup slot…'
                  : 'Finding peers on the DHT…'}
            </h3>
            <p className="torrent-metadata-copy">{message}</p>
          </div>
        </div>

        <div className="torrent-stat-grid torrent-stat-grid--metadata">
          <div>
            <span>Elapsed</span>
            <strong>{formatElapsed(lookup?.elapsedMs ?? 0)}</strong>
          </div>
          <div>
            <span>Peers</span>
            <strong>{lookup?.peers ?? 0}</strong>
          </div>
          <div>
            <span>DHT nodes</span>
            <strong>{lookup?.dhtNodes ?? '—'}</strong>
          </div>
          <div>
            <span>Hash version</span>
            <strong>v{details.hashVersion}</strong>
          </div>
        </div>

        {!failed ? (
          <div className="progress-track progress-track--indeterminate" role="status">
            <span className="progress-fill" />
          </div>
        ) : null}

        <p className="torrent-metadata-guidance">
          No files are downloaded during this step. Private torrents cannot be discovered through
          the DHT, and a lookup can take up to 3 minutes. If it does not finish, open the .torrent
          file instead.
        </p>

        <div className="torrent-metadata-actions">
          {failed ? (
            <button type="button" className="button button--primary" onClick={onRetry}>
              <Icon name="refresh" size={16} /> Retry lookup
            </button>
          ) : (
            <button type="button" className="button button--secondary" onClick={onCancel}>
              <Icon name="x" size={16} /> Cancel lookup
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={onAddTorrent}>
            <Icon name="folder" size={16} /> Use a .torrent file
          </button>
        </div>
      </section>
    </div>
  )
}

export function TorrentsPage({
  settings,
  jobs,
  selectedJobId,
  onSelectJob,
  onStartSetup,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  onRetryJob,
  onStartSeeding,
  onStopSeeding,
  onRequestRemoveJob,
  onRequestCloseTorrent,
  onOpenLocation,
  onFindMorePeers,
  onVerifyTorrent,
  onSetTorrentLimits,
  onAddTorrent,
  onOpenSettings,
}: TorrentsPageProps) {
  const [filter, setFilter] = useState<TorrentFilter>('all')
  const [search, setSearch] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('files')
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [applyingLimits, setApplyingLimits] = useState(false)
  const [limitsFeedback, setLimitsFeedback] = useState<string | null>(null)
  const [limitsError, setLimitsError] = useState<string | null>(null)
  const [liveDownloadLimit, setLiveDownloadLimit] = useState<RateLimitDraft>({
    value: '',
    unit: 'MB',
  })
  const [liveUploadLimit, setLiveUploadLimit] = useState<RateLimitDraft>({
    value: '',
    unit: 'MB',
  })
  const [liveMaxConnections, setLiveMaxConnections] = useState('')
  const [peerSortKey, setPeerSortKey] = useState<PeerSortKey>('address')
  const [peerSortDirection, setPeerSortDirection] = useState<PeerSortDirection>('asc')

  const torrents = useMemo(
    () =>
      jobs.filter(isTorrentJob).sort((a, b) => {
        const rank = (job: DownloadJob): number =>
          isMetadataJob(job)
            ? 0
            : isSetupJob(job)
              ? 1
              : isActiveJob(job)
                ? 2
                : isSeedingJob(job)
                  ? 3
                  : 4
        const aRank = rank(a)
        const bRank = rank(b)
        if (aRank !== bRank) return aRank - bRank
        return b.createdAt.localeCompare(a.createdAt)
      }),
    [jobs],
  )

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return torrents.filter((job) => {
      const details = torrentDetails(job)
      if (
        normalized &&
        !job.title.toLowerCase().includes(normalized) &&
        !details?.infoHash.toLowerCase().includes(normalized)
      ) {
        return false
      }
      if (filter === 'setup') return isSetupJob(job)
      if (filter === 'downloading') return isActiveJob(job)
      if (filter === 'seeding') return isSeedingJob(job)
      if (filter === 'completed') return isCompletedJob(job)
      return true
    })
  }, [filter, search, torrents])

  const selected = torrents.find((job) => job.id === selectedJobId) ?? torrents[0] ?? null
  const selectedDetails = selected ? torrentDetails(selected) : null

  useEffect(() => {
    if (!selected || !isSetupJob(selected)) {
      setSetup(null)
      return
    }
    const details = torrentDetails(selected)
    if (!details) {
      setSetup(null)
      return
    }
    setSetup({
      destination: selected.destination,
      selected: new Set(details.files.filter((file) => file.selected).map((file) => file.index)),
      downloadLimit: rateDraftFromBytes(details.downloadLimitBytesPerSecond),
      uploadLimit: rateDraftFromBytes(details.uploadLimitBytesPerSecond),
      maxConnections: peerLimitDraft(details.maxConnections),
      seedAfterComplete: details.seedAfterComplete,
    })
    setSetupError(null)
    setDetailTab('files')
    // Reset when the selected torrent changes or metadata becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.status])

  const syncLiveLimits = useCallback((details: TorrentJobDetails | null): void => {
    setLiveDownloadLimit(rateDraftFromBytes(details?.downloadLimitBytesPerSecond ?? null))
    setLiveUploadLimit(rateDraftFromBytes(details?.uploadLimitBytesPerSecond ?? null))
    setLiveMaxConnections(peerLimitDraft(details?.maxConnections))
  }, [])

  useEffect(() => {
    setLimitsOpen(false)
    setLimitsFeedback(null)
    setLimitsError(null)
  }, [selected?.id])

  useEffect(() => {
    syncLiveLimits(selectedDetails)
    // Only re-sync when stored limits change, not on every progress update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected?.id,
    selectedDetails?.downloadLimitBytesPerSecond,
    selectedDetails?.uploadLimitBytesPerSecond,
    selectedDetails?.maxConnections,
    syncLiveLimits,
  ])

  const groups = useMemo(() => {
    const preparingItems = filtered.filter(isMetadataJob)
    const setupItems = filtered.filter(isSetupJob)
    const activeItems = filtered.filter(
      (job) =>
        !isMetadataJob(job) && !isSetupJob(job) && !isSeedingJob(job) && !isCompletedJob(job),
    )
    const seedingItems = filtered.filter(isSeedingJob)
    const completedItems = filtered.filter(isCompletedJob)
    return [
      { label: 'Preparing', items: preparingItems },
      { label: 'Setup', items: setupItems },
      { label: 'Downloading', items: activeItems },
      { label: 'Seeding', items: seedingItems },
      { label: 'Completed', items: completedItems },
    ].filter((group) => group.items.length > 0)
  }, [filtered])

  const changeDestination = async (): Promise<void> => {
    if (!selected || !setup) return
    const result = await window.nexfetch.system.chooseDirectory()
    if (!result.ok || !result.data) return
    setSetup({
      ...setup,
      destination: defaultTorrentDestination(
        result.data,
        torrentFolderName(selected.title, selectedDetails?.files ?? []),
      ),
    })
  }

  const startDownload = async (): Promise<void> => {
    if (!selected || !setup) return
    const downloadLimit = rateDraftToBytes(setup.downloadLimit)
    const uploadLimit = rateDraftToBytes(setup.uploadLimit)
    const maxConnections = parsePeerLimit(setup.maxConnections)
    if (downloadLimit === undefined || uploadLimit === undefined || maxConnections === undefined) {
      setSetupError(
        'Speed limits must be zero or a positive number. Max peers must be 1–1000. Blank inherits the defaults.',
      )
      return
    }
    if (setup.selected.size === 0) {
      setSetupError('Select at least one file.')
      return
    }
    setStarting(true)
    setSetupError(null)
    try {
      const job = await onStartSetup({
        jobId: selected.id,
        destination: setup.destination,
        fileIndices: [...setup.selected],
        downloadLimitBytesPerSecond: downloadLimit,
        uploadLimitBytesPerSecond: uploadLimit,
        maxConnections,
        seedAfterComplete: setup.seedAfterComplete,
      })
      if (job) {
        setDetailTab('files')
        onSelectJob(job.id)
      }
    } finally {
      setStarting(false)
    }
  }

  const liveDownloadBytes = rateDraftToBytes(liveDownloadLimit)
  const liveUploadBytes = rateDraftToBytes(liveUploadLimit)
  const liveMaxConnectionsValue = parsePeerLimit(liveMaxConnections)
  const liveValidationMessage =
    liveDownloadBytes === undefined || liveUploadBytes === undefined
      ? 'Speed limits must be zero or a positive number, or blank to use the global limit.'
      : liveMaxConnectionsValue === undefined
        ? 'Max peers must be a whole number from 1 to 1000, or blank to use the profile default.'
        : null
  const liveLimitsDirty =
    selectedDetails !== null &&
    (liveDownloadBytes !== (selectedDetails.downloadLimitBytesPerSecond ?? null) ||
      liveUploadBytes !== (selectedDetails.uploadLimitBytesPerSecond ?? null) ||
      liveMaxConnectionsValue !== (selectedDetails.maxConnections ?? null))
  const profilePeers = profilePeerLimit(settings.torrentConnectionProfile)

  const toggleLiveLimits = (): void => {
    if (limitsOpen) {
      setLimitsOpen(false)
      return
    }
    syncLiveLimits(selectedDetails)
    setLimitsError(null)
    setLimitsFeedback(null)
    setLimitsOpen(true)
  }

  const cancelLiveLimits = (): void => {
    syncLiveLimits(selectedDetails)
    setLimitsOpen(false)
    setLimitsError(null)
    setLimitsFeedback(null)
  }

  const useLimitDefaults = (): void => {
    setLiveDownloadLimit({ value: '', unit: 'MB' })
    setLiveUploadLimit({ value: '', unit: 'MB' })
    setLiveMaxConnections('')
    setLimitsError(null)
    setLimitsFeedback(null)
  }

  const saveLiveLimits = async (): Promise<void> => {
    if (!selected || !liveLimitsDirty) return
    if (
      liveDownloadBytes === undefined ||
      liveUploadBytes === undefined ||
      liveMaxConnectionsValue === undefined
    ) {
      setLimitsError(liveValidationMessage ?? 'The transfer limits are invalid.')
      return
    }
    setApplyingLimits(true)
    setLimitsError(null)
    setLimitsFeedback(null)
    try {
      const job = await onSetTorrentLimits(
        selected.id,
        liveDownloadBytes,
        liveUploadBytes,
        liveMaxConnectionsValue,
      )
      if (job) {
        setLimitsFeedback('Transfer limits applied.')
      } else {
        setLimitsError('The transfer limits could not be applied.')
      }
    } catch {
      setLimitsError('The transfer limits could not be applied.')
    } finally {
      setApplyingLimits(false)
    }
  }

  return (
    <div className="page page--torrents">
      <header className="page-header">
        <div>
          <p className="eyebrow">Torrent client</p>
          <h1>Torrents</h1>
          <p className="page-subtitle">
            Files, peers, trackers, and seeding for every torrent in the queue.
          </p>
        </div>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={onAddTorrent}
        >
          <Icon name="download" size={16} />
          Add torrent
        </button>
      </header>

      <div className="torrents-workspace">
        <aside className="torrents-list-panel card" aria-label="Torrents">
          <div className="torrents-search">
            <Icon name="file" size={15} />
            <input
              className="text-input"
              type="search"
              placeholder="Search torrents"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div
            className="filter-tabs torrent-filter-tabs"
            role="tablist"
            aria-label="Torrent filter"
          >
            {(
              [
                ['all', 'All'],
                ['setup', 'Setup'],
                ['downloading', 'Active'],
                ['seeding', 'Seeding'],
                ['completed', 'Done'],
              ] as Array<[TorrentFilter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                className={`filter-tab${filter === id ? ' filter-tab--active' : ''}`}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="torrents-list-body">
            {groups.length === 0 ? (
              <div className="torrents-list-empty">
                <div className="empty-icon empty-icon--small">
                  <Icon name="download" size={22} />
                </div>
                <h3>No torrents yet</h3>
                <p>Add a .torrent file or info hash from Downloads.</p>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={onAddTorrent}
                >
                  Go to Downloads
                </button>
              </div>
            ) : (
              groups.map((group) => (
                <div className="torrent-group" key={group.label}>
                  <p className="queue-group-label">
                    {group.label} <span>{group.items.length}</span>
                  </p>
                  {group.items.map((job) => (
                    <TorrentListItem
                      key={job.id}
                      job={job}
                      selected={selected?.id === job.id}
                      onSelect={() => {
                        onSelectJob(job.id)
                        setDetailTab('files')
                      }}
                      onPause={() => onPauseJob(job.id)}
                      onResume={() => onResumeJob(job.id)}
                      onClose={() => onRequestCloseTorrent(job.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="torrent-detail card" aria-label="Torrent details">
          {!selected || !selectedDetails ? (
            <div className="torrent-detail-empty">
              <div className="empty-icon">
                <Icon name="download" size={28} />
              </div>
              <h2>Select a torrent</h2>
              <p>Choose a torrent from the list to see files, peers, and trackers.</p>
            </div>
          ) : (
            <>
              <header className="torrent-detail-header">
                <div className="torrent-detail-title">
                  <div className="torrent-title-line">
                    <h2>{selected.title}</h2>
                    <TorrentStatus job={selected} />
                    {!isMetadataLookupJob(selected) ? (
                      <span
                        className={`badge ${selectedDetails.isPrivate ? 'badge--warning' : 'badge--neutral'}`}
                      >
                        {selectedDetails.isPrivate ? 'Private' : 'Public'}
                      </span>
                    ) : null}
                  </div>
                  <p className="torrent-subtitle">
                    {isMetadataLookupJob(selected) ? (
                      <>
                        v{selectedDetails.hashVersion} ·{' '}
                        <span className="mono torrent-full-hash">{selectedDetails.infoHash}</span>
                      </>
                    ) : (
                      <>
                        {formatBytes(
                          selected.progress.totalBytes ??
                            selectedDetails.files.reduce((sum, file) => sum + file.sizeBytes, 0),
                        )}{' '}
                        · {selectedDetails.files.length}{' '}
                        {selectedDetails.files.length === 1 ? 'file' : 'files'} ·{' '}
                        <span className="mono">{selectedDetails.infoHash.slice(0, 12)}…</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="torrent-detail-actions">
                  {isSetupJob(selected) ? null : selected.status ===
                    'metadata' ? null : selected.status === 'paused' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onResumeJob(selected.id)}
                    >
                      <Icon name="play" size={15} /> Resume
                    </button>
                  ) : selected.status === 'downloading' ||
                    selected.status === 'queued' ||
                    selected.status === 'resolving' ||
                    selected.status === 'seeding' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onPauseJob(selected.id)}
                    >
                      <Icon name="pause" size={15} /> Pause
                    </button>
                  ) : null}
                  {selected.status === 'seeding' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onStopSeeding(selected.id)}
                    >
                      <Icon name="stop" size={15} /> Stop seeding
                    </button>
                  ) : null}
                  {selected.status === 'completed' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onStartSeeding(selected.id)}
                    >
                      <Icon name="play" size={15} /> Keep seeding
                    </button>
                  ) : null}
                  {isCompletedJob(selected) && selected.status !== 'cancelled' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onOpenLocation(selected.id, false)}
                    >
                      <Icon name="folder" size={15} /> Open folder
                    </button>
                  ) : null}
                  {(selected.status === 'failed' || selected.status === 'cancelled') &&
                  !isMetadataLookupJob(selected) ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onRetryJob(selected.id)}
                    >
                      <Icon name="refresh" size={15} /> Retry
                    </button>
                  ) : null}
                  {isCompletedJob(selected) ? (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => onRequestRemoveJob(selected.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </header>

              {isMetadataLookupJob(selected) && !isSetupJob(selected) ? (
                <MetadataLookupPanel
                  job={selected}
                  details={selectedDetails}
                  onCancel={() => onCancelJob(selected.id)}
                  onRetry={() => onRetryJob(selected.id)}
                  onAddTorrent={onAddTorrent}
                />
              ) : isSetupJob(selected) && setup ? (
                <div className="torrent-detail-body">
                  <section className="torrent-setup-section">
                    <div className="torrent-section-heading">
                      <h3>Files</h3>
                      <span>
                        {formatBytes(selectedSize(selectedDetails.files, setup.selected))} selected
                      </span>
                    </div>
                    <div className="torrent-file-tools">
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() =>
                          setSetup({
                            ...setup,
                            selected: new Set(selectedDetails.files.map((file) => file.index)),
                          })
                        }
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => setSetup({ ...setup, selected: new Set() })}
                      >
                        Select none
                      </button>
                    </div>
                    <SetupFileList
                      files={selectedDetails.files}
                      selected={setup.selected}
                      onToggle={(index, value) => {
                        const next = new Set(setup.selected)
                        if (value) next.add(index)
                        else next.delete(index)
                        setSetup({ ...setup, selected: next })
                      }}
                    />
                  </section>

                  <section className="torrent-setup-section">
                    <div className="torrent-section-heading">
                      <h3>Destination</h3>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void changeDestination()}
                      >
                        <Icon name="folder" size={14} /> Change
                      </button>
                    </div>
                    <p className="path-value torrent-destination" title={setup.destination}>
                      {setup.destination}
                    </p>
                  </section>

                  <section className="torrent-setup-section">
                    <div className="torrent-section-heading">
                      <h3>Speed limits</h3>
                      <span>Blank uses the global limit · 0 means unlimited</span>
                    </div>
                    <div className="torrent-limit-grid">
                      <RateLimitInput
                        id="torrent-setup-download-limit"
                        label="Download"
                        value={setup.downloadLimit}
                        placeholderBytes={settings.maxDownloadRateBytesPerSecond}
                        onChange={(value) => setSetup({ ...setup, downloadLimit: value })}
                      />
                      <RateLimitInput
                        id="torrent-setup-upload-limit"
                        label="Upload"
                        value={setup.uploadLimit}
                        placeholderBytes={settings.maxUploadRateBytesPerSecond}
                        onChange={(value) => setSetup({ ...setup, uploadLimit: value })}
                      />
                    </div>
                  </section>

                  <section className="torrent-setup-section">
                    <div className="torrent-section-heading">
                      <h3>Connections</h3>
                      <span>
                        Blank uses the {connectionProfileLabel(settings.torrentConnectionProfile)}{' '}
                        profile
                      </span>
                    </div>
                    <div className="torrent-peer-limit-field">
                      <PeerLimitInput
                        id="torrent-setup-max-connections"
                        label="Max connected peers"
                        value={setup.maxConnections}
                        placeholder={profilePeers}
                        describedBy="torrent-setup-peer-hint"
                        onChange={(value) => setSetup({ ...setup, maxConnections: value })}
                      />
                    </div>
                    <p id="torrent-setup-peer-hint" className="torrent-field-hint">
                      Caps connected peers for this torrent. The{' '}
                      {connectionProfileLabel(settings.torrentConnectionProfile)} profile default is{' '}
                      {profilePeers} peers.
                    </p>
                  </section>

                  <section className="torrent-setup-section torrent-setup-section--inline">
                    <label className="torrent-checkbox-row">
                      <input
                        className="checkbox-input"
                        type="checkbox"
                        checked={setup.seedAfterComplete}
                        onChange={(event) =>
                          setSetup({ ...setup, seedAfterComplete: event.target.checked })
                        }
                      />
                      <span>
                        <strong>Keep seeding after completion</strong>
                        <small>Default is off. Upload stops when you close NexFetch.</small>
                      </span>
                    </label>
                  </section>

                  <section className="torrent-setup-section">
                    <div className="torrent-section-heading">
                      <h3>Discovery</h3>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={onOpenSettings}
                      >
                        <Icon name="settings" size={14} /> Settings
                      </button>
                    </div>
                    <div className="torrent-discovery">
                      <div className="torrent-discovery-row">
                        <span>Trackers</span>
                        <span>{selectedDetails.trackers.length} configured</span>
                      </div>
                      <div className="torrent-discovery-row">
                        <span>DHT / PEX / LSD</span>
                        <span>
                          {selectedDetails.isPrivate
                            ? 'Off for private torrent'
                            : 'On · public torrent'}
                        </span>
                      </div>
                      <div className="torrent-discovery-row">
                        <span>Web seeds</span>
                        <span>Disabled for security</span>
                      </div>
                      <div className="torrent-discovery-row">
                        <span>NAT mapping</span>
                        <span>{settings.torrentNATMapping ? 'On' : 'Off'}</span>
                      </div>
                    </div>
                  </section>

                  {setupError ? (
                    <p className="dependency-warning" role="alert">
                      {setupError}
                    </p>
                  ) : null}

                  <div className="torrent-setup-action-bar">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onRequestRemoveJob(selected.id)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button button--primary button--download"
                      onClick={() => void startDownload()}
                      disabled={starting || setup.selected.size === 0}
                    >
                      <Icon name="download" size={18} />
                      {starting
                        ? 'Starting…'
                        : `Download ${formatBytes(selectedSize(selectedDetails.files, setup.selected))}`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="torrent-detail-body">
                  <section className="torrent-live-overview">
                    <div className="torrent-progress-line">
                      <div className="progress-track">
                        <span
                          className="progress-fill"
                          style={{ width: `${selected.progress.percent ?? 0}%` }}
                        />
                      </div>
                      <span>
                        {selected.progress.percent === null
                          ? '—'
                          : `${Math.round(selected.progress.percent)}%`}
                      </span>
                    </div>
                    <div className="torrent-stat-grid">
                      <div>
                        <span>Downloaded</span>
                        <strong>
                          {formatBytes(selected.progress.downloadedBytes ?? 0)} /{' '}
                          {formatBytes(selected.progress.totalBytes ?? 0)}
                        </strong>
                      </div>
                      <div>
                        <span>Download</span>
                        <strong>{formatSpeed(selected.progress.bytesPerSecond ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Upload</span>
                        <strong>
                          {formatSpeed(selectedDetails.uploadRateBytesPerSecond ?? 0)}
                        </strong>
                      </div>
                      <div>
                        <span>ETA</span>
                        <strong>
                          {selected.progress.etaSeconds !== null
                            ? formatEta(selected.progress.etaSeconds)
                            : '—'}
                        </strong>
                      </div>
                      <div>
                        <span>Seeds</span>
                        <strong>
                          {selectedDetails.seedsConnected ?? '—'} (
                          {selectedDetails.seedsAvailable ?? '—'})
                        </strong>
                      </div>
                      <div>
                        <span>Peers</span>
                        <strong>
                          {selectedDetails.peersConnected ?? '—'} (
                          {selectedDetails.peersAvailable ?? '—'})
                        </strong>
                      </div>
                      <div>
                        <span>Ratio</span>
                        <strong>
                          {selectedDetails.ratio !== null ? selectedDetails.ratio.toFixed(2) : '—'}
                        </strong>
                      </div>
                      <div>
                        <span>Uploaded</span>
                        <strong>{formatBytes(selectedDetails.uploadedBytes ?? 0)}</strong>
                      </div>
                    </div>
                    <div className="torrent-live-actions">
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => onFindMorePeers(selected.id)}
                      >
                        <Icon name="refresh" size={14} /> Find more peers
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--small"
                        onClick={() => onVerifyTorrent(selected.id)}
                      >
                        <Icon name="check" size={14} /> Verify files
                      </button>
                      <button
                        type="button"
                        className={`button button--small${limitsOpen ? ' button--primary' : ' button--secondary'}`}
                        onClick={toggleLiveLimits}
                        aria-expanded={limitsOpen}
                        aria-controls="torrent-live-limits"
                      >
                        <Icon name="settings" size={14} /> Transfer limits
                      </button>
                      <span className="torrent-limit-summary">
                        {effectiveRateLabel(
                          selectedDetails.downloadLimitBytesPerSecond,
                          settings.maxDownloadRateBytesPerSecond,
                        )}{' '}
                        down ·{' '}
                        {effectiveRateLabel(
                          selectedDetails.uploadLimitBytesPerSecond,
                          settings.maxUploadRateBytesPerSecond,
                        )}{' '}
                        up · {selectedDetails.maxConnections ?? profilePeers} peers max
                      </span>
                    </div>
                    {limitsOpen ? (
                      <div
                        className="torrent-live-limit-form"
                        id="torrent-live-limits"
                        role="group"
                        aria-label="Per-torrent transfer limits"
                      >
                        <RateLimitInput
                          id="torrent-live-download-limit"
                          label="Download"
                          value={liveDownloadLimit}
                          placeholderBytes={settings.maxDownloadRateBytesPerSecond}
                          invalid={liveDownloadBytes === undefined}
                          describedBy="torrent-live-limit-hint"
                          onChange={(value) => {
                            setLiveDownloadLimit(value)
                            setLimitsError(null)
                            setLimitsFeedback(null)
                          }}
                        />
                        <RateLimitInput
                          id="torrent-live-upload-limit"
                          label="Upload"
                          value={liveUploadLimit}
                          placeholderBytes={settings.maxUploadRateBytesPerSecond}
                          invalid={liveUploadBytes === undefined}
                          describedBy="torrent-live-limit-hint"
                          onChange={(value) => {
                            setLiveUploadLimit(value)
                            setLimitsError(null)
                            setLimitsFeedback(null)
                          }}
                        />
                        <PeerLimitInput
                          id="torrent-live-max-connections"
                          label="Max connected peers"
                          value={liveMaxConnections}
                          placeholder={profilePeers}
                          invalid={liveMaxConnectionsValue === undefined}
                          describedBy="torrent-live-limit-hint"
                          onChange={(value) => {
                            setLiveMaxConnections(value)
                            setLimitsError(null)
                            setLimitsFeedback(null)
                          }}
                        />
                        <div className="torrent-live-limit-actions">
                          <p id="torrent-live-limit-hint" className="torrent-live-limit-hint">
                            Blank inherits global:{' '}
                            {effectiveRateLabel(null, settings.maxDownloadRateBytesPerSecond)} down
                            · {effectiveRateLabel(null, settings.maxUploadRateBytesPerSecond)} up ·{' '}
                            {profilePeers} peers max. Enter 0 for unlimited speed.
                          </p>
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={useLimitDefaults}
                            disabled={applyingLimits}
                          >
                            Use defaults
                          </button>
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            onClick={cancelLiveLimits}
                            disabled={applyingLimits}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button button--primary button--small"
                            onClick={() => void saveLiveLimits()}
                            disabled={
                              applyingLimits || !liveLimitsDirty || liveValidationMessage !== null
                            }
                          >
                            {applyingLimits ? 'Applying…' : 'Apply limits'}
                          </button>
                        </div>
                        {liveValidationMessage ? (
                          <p className="inline-error torrent-live-limit-message" role="alert">
                            {liveValidationMessage}
                          </p>
                        ) : null}
                        {limitsError ? (
                          <p className="inline-error torrent-live-limit-message" role="alert">
                            {limitsError}
                          </p>
                        ) : null}
                        {limitsFeedback ? (
                          <p className="torrent-live-limit-success" role="status">
                            {limitsFeedback}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>

                  <div
                    className="filter-tabs torrent-detail-tabs"
                    role="tablist"
                    aria-label="Torrent detail"
                  >
                    {(
                      [
                        ['files', 'Files'],
                        ['peers', 'Peers'],
                        ['trackers', 'Trackers'],
                        ['discovery', 'Discovery'],
                      ] as Array<[DetailTab, string]>
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={detailTab === id}
                        className={`filter-tab${detailTab === id ? ' filter-tab--active' : ''}`}
                        onClick={() => setDetailTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <section className="torrent-tab-body">
                    {detailTab === 'files' ? (
                      <LiveFileList
                        files={selectedDetails.files}
                        selected={
                          new Set(
                            selectedDetails.files
                              .filter((file) => file.selected)
                              .map((file) => file.index),
                          )
                        }
                      />
                    ) : null}
                    {detailTab === 'peers' ? (
                      <PeerList
                        peers={selectedDetails.peers}
                        sortKey={peerSortKey}
                        sortDirection={peerSortDirection}
                        onSort={(key) => {
                          if (key === peerSortKey) {
                            setPeerSortDirection((direction) =>
                              direction === 'asc' ? 'desc' : 'asc',
                            )
                          } else {
                            setPeerSortKey(key)
                            setPeerSortDirection(
                              key === 'progress' || key === 'download' || key === 'upload'
                                ? 'desc'
                                : 'asc',
                            )
                          }
                        }}
                      />
                    ) : null}
                    {detailTab === 'trackers' ? (
                      <TrackerList trackers={selectedDetails.trackers} />
                    ) : null}
                    {detailTab === 'discovery' ? (
                      <DiscoveryPanel details={selectedDetails} />
                    ) : null}
                  </section>

                  {!isSetupJob(selected) &&
                  !isCompletedJob(selected) &&
                  !isMetadataLookupJob(selected) ? (
                    <div className="torrent-danger-zone">
                      <button
                        type="button"
                        className="button button--danger button--small"
                        onClick={() => onRequestCloseTorrent(selected.id)}
                      >
                        <Icon name="trash" size={14} /> Remove torrent
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {selected.error && !isMetadataLookupJob(selected) ? (
                <p className="job-error torrent-detail-error" role="alert">
                  {selected.error.message}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
