import { useState } from 'react'
import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  EngineInfo,
  Settings,
} from '@shared/ipc/contracts'
import { QueuePanel } from '../../components/QueuePanel'
import { HttpDownloadPanel } from '../http/HttpDownloadPanel'
import { YoutubeDownloadPanel } from '../youtube/YoutubeDownloadPanel'

interface DownloadsPageProps {
  settings: Settings
  dependencies: DependencyStatus | null
  engines: EngineInfo[]
  jobs: DownloadJob[]
  onCreateJob: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onCancelJob: (jobId: string) => void
  onPauseJob: (jobId: string) => void
  onResumeJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onRemoveJob: (jobId: string) => void
  onOpenJobLocation: (jobId: string, revealFile: boolean) => void
  onOpenDestination: () => void
  onOpenSettings: () => void
  onViewHistory: () => void
}

type SourceTab = 'youtube' | 'http'

export function DownloadsPage({
  settings,
  dependencies,
  engines,
  jobs,
  onCreateJob,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  onRetryJob,
  onRemoveJob,
  onOpenJobLocation,
  onOpenDestination,
  onOpenSettings,
  onViewHistory,
}: DownloadsPageProps) {
  const [source, setSource] = useState<SourceTab>('youtube')

  return (
    <div className="page page--downloads">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Downloads</h1>
          <p className="page-subtitle">
            Download a YouTube video at the best available quality up to 4K, or fetch a direct
            HTTP/HTTPS file.
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
              onClick={() => setSource('youtube')}
            >
              YouTube
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'http'}
              className={`source-tab${source === 'http' ? ' source-tab--active' : ''}`}
              onClick={() => setSource('http')}
            >
              Direct file
            </button>
          </div>

          {source === 'youtube' ? (
            <YoutubeDownloadPanel
              settings={settings}
              dependencies={dependencies}
              onCreateJob={onCreateJob}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <HttpDownloadPanel settings={settings} onCreateJob={onCreateJob} />
          )}
        </div>

        <QueuePanel
          jobs={jobs}
          engines={engines}
          onCancel={onCancelJob}
          onPause={onPauseJob}
          onResume={onResumeJob}
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
