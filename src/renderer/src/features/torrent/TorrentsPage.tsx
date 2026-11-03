import { useEffect, useMemo, useState } from 'react'
import type { DownloadJob, Settings, TorrentSetupUpdateRequest } from '@shared/ipc/contracts'
import type {
  TorrentFileEntry,
  TorrentJobDetails,
  TorrentPeerEntry,
  TorrentTrackerEntry,
} from '@shared/domain/torrent'
import { Icon } from '../../components/Icon'
import { formatBytes, formatEta, formatSpeed } from '../../lib/format'
import { defaultTorrentDestination, torrentFolderName } from '../../lib/paths'

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
  onRemoveJob: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
  onFindMorePeers: (jobId: string) => void
  onVerifyTorrent: (jobId: string) => void
  onSetTorrentLimits: (
    jobId: string,
    downloadLimitBytesPerSecond: number | null,
    uploadLimitBytesPerSecond: number | null,
  ) => void
  onAddTorrent: () => void
  onOpenSettings: () => void
}

type TorrentFilter = 'all' | 'setup' | 'downloading' | 'seeding' | 'completed'
type DetailTab = 'files' | 'peers' | 'trackers' | 'discovery'

interface SetupState {
  destination: string
  selected: Set<number>
  downloadLimit: string
  uploadLimit: string
  seedAfterComplete: boolean
}

const STATUS_LABELS: Record<string, string> = {
  setup: 'Setup',
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

function isSeedingJob(job: DownloadJob): boolean {
  return job.status === 'seeding'
}

function isActiveJob(job: DownloadJob): boolean {
  return [
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

function rateToBytes(value: string): number | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const number = Number(trimmed)
  if (!Number.isFinite(number) || number < 0) return undefined
  return Math.round(number * 1024 * 1024)
}

function bytesToRate(value: number | null): string {
  if (value === null || value <= 0) return ''
  const megabytes = value / (1024 * 1024)
  return String(Number.isInteger(megabytes) ? megabytes : Number(megabytes.toFixed(2)))
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
}: {
  job: DownloadJob
  selected: boolean
  onSelect: () => void
}) {
  const details = torrentDetails(job)
  const percent = job.progress.percent
  return (
    <button
      type="button"
      className={`torrent-list-item${selected ? ' torrent-list-item--selected' : ''}`}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="torrent-list-top">
        <span className="torrent-list-title" title={job.title}>
          {job.title}
        </span>
        <TorrentStatus job={job} />
      </div>
      {isSetupJob(job) ? (
        <div className="torrent-list-meta">
          <span>
            {formatBytes(
              job.progress.totalBytes ??
                details?.files.reduce((sum, file) => sum + file.sizeBytes, 0) ??
                0,
            )}
          </span>
          <span>{details?.files.length ?? 0} files</span>
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
          <span>{job.status === 'completed' ? 'Verified pieces' : STATUS_LABELS[job.status]}</span>
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

function PeerList({ peers }: { peers: TorrentPeerEntry[] }) {
  if (peers.length === 0) {
    return <p className="torrent-empty-tab">No peers connected yet.</p>
  }
  return (
    <div className="torrent-table torrent-table--peers">
      <div className="torrent-table-head">
        <span>Address</span>
        <span>Client</span>
        <span>Progress</span>
        <span>↓</span>
        <span>↑</span>
        <span>Type</span>
      </div>
      {peers.map((peer) => (
        <div className="torrent-table-row" key={peer.address}>
          <span className="torrent-table-url">{peer.address}</span>
          <span>{peer.client}</span>
          <span>{Math.round(peer.progress * 100)}%</span>
          <span>{formatSpeed(peer.downloadRateBytesPerSecond)}</span>
          <span>{formatSpeed(peer.uploadRateBytesPerSecond)}</span>
          <span>{peerLabel(peer)}</span>
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
  onRemoveJob,
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
  const [liveDownloadLimit, setLiveDownloadLimit] = useState('')
  const [liveUploadLimit, setLiveUploadLimit] = useState('')

  const torrents = useMemo(
    () =>
      jobs.filter(isTorrentJob).sort((a, b) => {
        const aRank = isSetupJob(a) ? 0 : isActiveJob(a) ? 1 : isSeedingJob(a) ? 2 : 3
        const bRank = isSetupJob(b) ? 0 : isActiveJob(b) ? 1 : isSeedingJob(b) ? 2 : 3
        if (aRank !== bRank) return aRank - bRank
        return b.createdAt.localeCompare(a.createdAt)
      }),
    [jobs],
  )

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return torrents.filter((job) => {
      if (normalized && !job.title.toLowerCase().includes(normalized)) return false
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
      downloadLimit: bytesToRate(details.downloadLimitBytesPerSecond),
      uploadLimit: bytesToRate(details.uploadLimitBytesPerSecond),
      seedAfterComplete: details.seedAfterComplete,
    })
    setSetupError(null)
    setDetailTab('files')
    // Reset only when a different torrent is selected, not on every progress update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  useEffect(() => {
    if (!selected || selected.status !== 'seeding') {
      setLimitsOpen(false)
      return
    }
    const details = torrentDetails(selected)
    setLiveDownloadLimit(bytesToRate(details?.downloadLimitBytesPerSecond ?? null))
    setLiveUploadLimit(bytesToRate(details?.uploadLimitBytesPerSecond ?? null))
    // Initialize only when the selected torrent or its status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.status])

  const groups = useMemo(() => {
    const setupItems = filtered.filter(isSetupJob)
    const activeItems = filtered.filter(
      (job) => !isSetupJob(job) && !isSeedingJob(job) && !isCompletedJob(job),
    )
    const seedingItems = filtered.filter(isSeedingJob)
    const completedItems = filtered.filter(isCompletedJob)
    return [
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
    const downloadLimit = rateToBytes(setup.downloadLimit)
    const uploadLimit = rateToBytes(setup.uploadLimit)
    if (downloadLimit === undefined || uploadLimit === undefined) {
      setSetupError('Speed limits must be positive numbers in MB/s, or blank for global.')
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

  const saveLiveLimits = (): void => {
    if (!selected) return
    const downloadLimit = rateToBytes(liveDownloadLimit)
    const uploadLimit = rateToBytes(liveUploadLimit)
    if (downloadLimit === undefined || uploadLimit === undefined) return
    onSetTorrentLimits(selected.id, downloadLimit, uploadLimit)
    setLimitsOpen(false)
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
                    <span
                      className={`badge ${selectedDetails.isPrivate ? 'badge--warning' : 'badge--neutral'}`}
                    >
                      {selectedDetails.isPrivate ? 'Private' : 'Public'}
                    </span>
                  </div>
                  <p className="torrent-subtitle">
                    {formatBytes(
                      selected.progress.totalBytes ??
                        selectedDetails.files.reduce((sum, file) => sum + file.sizeBytes, 0),
                    )}{' '}
                    · {selectedDetails.files.length} files ·{' '}
                    <span className="mono">{selectedDetails.infoHash.slice(0, 12)}…</span>
                  </p>
                </div>
                <div className="torrent-detail-actions">
                  {isSetupJob(selected) ? null : selected.status === 'paused' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onResumeJob(selected.id)}
                    >
                      <Icon name="play" size={15} /> Resume
                    </button>
                  ) : selected.status === 'downloading' ||
                    selected.status === 'queued' ||
                    selected.status === 'resolving' ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => onPauseJob(selected.id)}
                    >
                      <Icon name="pause" size={15} /> Pause
                    </button>
                  ) : null}
                  {!isSetupJob(selected) &&
                  selected.status !== 'seeding' &&
                  !isCompletedJob(selected) ? (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => onCancelJob(selected.id)}
                    >
                      <Icon name="stop" size={15} /> Stop
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
                  {selected.status === 'failed' || selected.status === 'cancelled' ? (
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
                      onClick={() => {
                        onRemoveJob(selected.id)
                        onSelectJob(null)
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </header>

              {isSetupJob(selected) && setup ? (
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
                        className="link-button"
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
                        className="link-button"
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
                        className="link-button"
                        onClick={() => void changeDestination()}
                      >
                        Change
                      </button>
                    </div>
                    <p className="path-value torrent-destination" title={setup.destination}>
                      {setup.destination}
                    </p>
                  </section>

                  <section className="torrent-setup-section">
                    <div className="torrent-section-heading">
                      <h3>Speed limits</h3>
                      <span>Blank uses the global limit</span>
                    </div>
                    <div className="torrent-limit-grid">
                      <label>
                        <span>Download MB/s</span>
                        <input
                          className="text-input"
                          inputMode="decimal"
                          placeholder={
                            bytesToRate(settings.maxDownloadRateBytesPerSecond) || 'Unlimited'
                          }
                          value={setup.downloadLimit}
                          onChange={(event) =>
                            setSetup({ ...setup, downloadLimit: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>Upload MB/s</span>
                        <input
                          className="text-input"
                          inputMode="decimal"
                          placeholder={
                            bytesToRate(settings.maxUploadRateBytesPerSecond) || 'Unlimited'
                          }
                          value={setup.uploadLimit}
                          onChange={(event) =>
                            setSetup({ ...setup, uploadLimit: event.target.value })
                          }
                        />
                      </label>
                    </div>
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
                      <button type="button" className="link-button" onClick={onOpenSettings}>
                        Settings
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
                      onClick={() => {
                        onRemoveJob(selected.id)
                        onSelectJob(null)
                      }}
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
                        className="link-button"
                        onClick={() => onFindMorePeers(selected.id)}
                      >
                        Find more peers
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onVerifyTorrent(selected.id)}
                      >
                        Verify files
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setLimitsOpen((value) => !value)}
                      >
                        Speed limits
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
                        up
                      </span>
                    </div>
                    {limitsOpen ? (
                      <div className="torrent-live-limit-form">
                        <label>
                          <span>Download MB/s</span>
                          <input
                            className="text-input"
                            value={liveDownloadLimit}
                            placeholder={
                              bytesToRate(settings.maxDownloadRateBytesPerSecond) || 'Unlimited'
                            }
                            onChange={(event) => setLiveDownloadLimit(event.target.value)}
                          />
                        </label>
                        <label>
                          <span>Upload MB/s</span>
                          <input
                            className="text-input"
                            value={liveUploadLimit}
                            placeholder={
                              bytesToRate(settings.maxUploadRateBytesPerSecond) || 'Unlimited'
                            }
                            onChange={(event) => setLiveUploadLimit(event.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="button button--secondary button--small"
                          onClick={saveLiveLimits}
                        >
                          Apply
                        </button>
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
                    {detailTab === 'peers' ? <PeerList peers={selectedDetails.peers} /> : null}
                    {detailTab === 'trackers' ? (
                      <TrackerList trackers={selectedDetails.trackers} />
                    ) : null}
                    {detailTab === 'discovery' ? (
                      <DiscoveryPanel details={selectedDetails} />
                    ) : null}
                  </section>
                </div>
              )}

              {selected.error ? (
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
