import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  EngineInfo,
  Settings,
} from '@shared/ipc/contracts'
import { QueuePanel } from '../../components/QueuePanel'
import { HttpDownloadPanel } from '../http/HttpDownloadPanel'
import { TorrentDownloadPanel } from '../torrent/TorrentDownloadPanel'
import { YoutubeDownloadPanel } from '../youtube/YoutubeDownloadPanel'

interface DownloadsPageProps {
  settings: Settings
  dependencies: DependencyStatus | null
  engines: EngineInfo[]
  jobs: DownloadJob[]
  source: SourceTab
  onSourceChange: (source: SourceTab) => void
  onCreateJob: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onCreateTorrent: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onOpenTorrent: (jobId: string) => void
  onCancelJob: (jobId: string) => void
  onPauseJob: (jobId: string) => void
  onResumeJob: (jobId: string) => void
  onStopSeeding: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onRemoveJob: (jobId: string) => void
  onOpenJobLocation: (jobId: string, revealFile: boolean) => void
  onOpenDestination: () => void
  onOpenSettings: () => void
  onViewHistory: () => void
}

export type SourceTab = 'youtube' | 'http' | 'torrent'

export function DownloadsPage({
  settings,
  dependencies,
  engines,
  jobs,
  source,
  onSourceChange,
  onCreateJob,
  onCreateTorrent,
  onOpenTorrent,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  onStopSeeding,
  onRetryJob,
  onRemoveJob,
  onOpenJobLocation,
  onOpenDestination,
  onOpenSettings,
  onViewHistory,
}: DownloadsPageProps) {
  return (
    <div className="page page--downloads">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Downloads</h1>
          <p className="page-subtitle">
            Download YouTube at the best available quality up to 4K, fetch a direct file, or add a
            torrent.
          </p>
        </div>
        <span className="badge badge--neutral">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
        </span>
      </header>

      <div className="downloads-workspace">
        <div className="download-main">
          <div className="source-tabs" role="tablist" aria-label="Download source">
            <button
              type="button"
              role="tab"
              aria-selected={source === 'youtube'}
              className={`source-tab${source === 'youtube' ? ' source-tab--active' : ''}`}
              onClick={() => onSourceChange('youtube')}
            >
              YouTube
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'http'}
              className={`source-tab${source === 'http' ? ' source-tab--active' : ''}`}
              onClick={() => onSourceChange('http')}
            >
              Direct file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'torrent'}
              className={`source-tab${source === 'torrent' ? ' source-tab--active' : ''}`}
              onClick={() => onSourceChange('torrent')}
            >
              Torrent
            </button>
          </div>

          {source === 'youtube' ? (
            <YoutubeDownloadPanel
              settings={settings}
              dependencies={dependencies}
              onCreateJob={onCreateJob}
              onOpenSettings={onOpenSettings}
            />
          ) : source === 'http' ? (
            <HttpDownloadPanel settings={settings} onCreateJob={onCreateJob} />
          ) : (
            <TorrentDownloadPanel
              settings={settings}
              dependencies={dependencies}
              jobs={jobs}
              onCreateTorrent={onCreateTorrent}
              onOpenTorrent={onOpenTorrent}
            />
          )}
        </div>

        <QueuePanel
          jobs={jobs}
          engines={engines}
          onCancel={onCancelJob}
          onPause={onPauseJob}
          onResume={onResumeJob}
          onStopSeeding={onStopSeeding}
          onRetry={onRetryJob}
          onRemove={onRemoveJob}
          onOpenLocation={onOpenJobLocation}
          onOpenDestination={onOpenDestination}
          onViewHistory={onViewHistory}
        />
      </div>
    </div>
  )
}
