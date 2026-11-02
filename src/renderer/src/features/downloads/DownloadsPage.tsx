import type {
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  Settings,
} from '@shared/ipc/contracts'
import { Icon } from '../../components/Icon'
import { JobList } from '../../components/JobList'
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
}: DownloadsPageProps) {
  const activeCount = jobs.filter(
    (job) => !['completed', 'failed', 'cancelled'].includes(job.status),
  ).length

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Downloads</h1>
          <p className="page-subtitle">
            Paste a YouTube link, inspect the actual formats, and download at the best available
            quality up to 4K.
          </p>
        </div>
        <div className="header-actions">
          <span className="badge badge--neutral">
            {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
          </span>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={onOpenDestination}
          >
            <Icon name="folder" size={16} />
            Open folder
          </button>
        </div>
      </header>

      <YoutubeDownloadPanel
        settings={settings}
        dependencies={dependencies}
        onCreateJob={onCreateJob}
        onOpenSettings={onOpenSettings}
      />

      <section className="queue-section" aria-labelledby="queue-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Activity</p>
            <h2 id="queue-title">Queue</h2>
          </div>
          <span className="badge badge--neutral">{activeCount} active</span>
        </div>
        <JobList
          jobs={jobs}
          emptyTitle="Your queue is empty"
          emptyMessage="Fetch a YouTube video above to choose a quality and start your first download."
          emptyIcon="download"
          onCancel={onCancelJob}
          onRetry={onRetryJob}
          onRemove={onRemoveJob}
          onOpenLocation={onOpenJobLocation}
        />
      </section>
    </div>
  )
}
