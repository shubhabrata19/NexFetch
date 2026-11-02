import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  Settings,
} from '@shared/ipc/contracts'
import { QueuePanel } from '../../components/QueuePanel'
import { YoutubeDownloadPanel } from '../youtube/YoutubeDownloadPanel'

interface DownloadsPageProps {
  settings: Settings
  dependencies: DependencyStatus | null
  jobs: DownloadJob[]
  onCreateJob: (request: CreateJobRequest) => Promise<DownloadJob | null>
  onCancelJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onRemoveJob: (jobId: string) => void
  onOpenJobLocation: (jobId: string, revealFile: boolean) => void
  onOpenDestination: () => void
  onOpenSettings: () => void
  onViewHistory: () => void
}

export function DownloadsPage({
  settings,
  dependencies,
  jobs,
  onCreateJob,
  onCancelJob,
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
            Paste a YouTube link, inspect the actual formats, and download at the best available
            quality up to 4K.
          </p>
        </div>
        <span className="badge badge--neutral">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
        </span>
      </header>

      <div className="downloads-workspace">
        <div className="download-main">
          <YoutubeDownloadPanel
            settings={settings}
            dependencies={dependencies}
            onCreateJob={onCreateJob}
            onOpenSettings={onOpenSettings}
          />
        </div>

        <QueuePanel
          jobs={jobs}
          onCancel={onCancelJob}
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
