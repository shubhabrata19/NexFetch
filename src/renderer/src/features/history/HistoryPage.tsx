import type { DownloadJob } from '@shared/ipc/contracts'
import { JobList } from '../../components/JobList'

interface HistoryPageProps {
  jobs: DownloadJob[]
  onCancelJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onRemoveJob: (jobId: string) => void
  onOpenJobLocation: (jobId: string, revealFile: boolean) => void
}

export function HistoryPage({
  jobs,
  onCancelJob,
  onRetryJob,
  onRemoveJob,
  onOpenJobLocation,
}: HistoryPageProps) {
  const terminalJobs = jobs.filter((job) =>
    ['completed', 'failed', 'cancelled'].includes(job.status),
  )

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Archive</p>
          <h1>History</h1>
          <p className="page-subtitle">
            Completed, failed, and cancelled jobs. Clearing history never deletes downloaded files.
          </p>
        </div>
        <span className="badge badge--neutral">
          {terminalJobs.length} {terminalJobs.length === 1 ? 'record' : 'records'}
        </span>
      </header>

      <JobList
        jobs={terminalJobs}
        emptyTitle="No history yet"
        emptyMessage="Finished downloads will keep their output location and diagnostics here."
        emptyIcon="history"
        onCancel={onCancelJob}
        onRetry={onRetryJob}
        onRemove={onRemoveJob}
        onOpenLocation={onOpenJobLocation}
      />
    </div>
  )
}
