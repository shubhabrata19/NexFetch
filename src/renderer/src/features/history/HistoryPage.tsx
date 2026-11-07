import { useState } from 'react'
import type { DownloadJob } from '@shared/ipc/contracts'
import { JobList } from '../../components/JobList'

interface HistoryPageProps {
  jobs: DownloadJob[]
  onCancelJob: (jobId: string) => void
  onRetryJob: (jobId: string) => void
  onStopSeeding: (jobId: string) => void
  onRequestRemoveJob: (jobId: string) => void
  onOpenJobLocation: (jobId: string, revealFile: boolean) => void
  removingJobId?: string | null
}

type HistoryFilter = 'all' | 'files' | 'videos' | 'torrents'

const FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'videos', label: 'Videos' },
  { id: 'torrents', label: 'Torrents' },
]

export function HistoryPage({
  jobs,
  onCancelJob,
  onRetryJob,
  onStopSeeding,
  onRequestRemoveJob,
  onOpenJobLocation,
  removingJobId,
}: HistoryPageProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const terminalJobs = jobs.filter((job) =>
    ['completed', 'failed', 'cancelled', 'seeding'].includes(job.status),
  )
  const filteredJobs = terminalJobs.filter((job) => {
    if (filter === 'files') return job.engineId === 'http'
    if (filter === 'videos') return job.engineId === 'youtube'
    if (filter === 'torrents') return job.engineId === 'torrent'
    return true
  })

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Archive</p>
          <h1>History</h1>
          <p className="page-subtitle">
            Completed, failed, cancelled, and seeding jobs. Removing an entry keeps its files on
            disk unless you choose to delete them.
          </p>
        </div>
        <span className="badge badge--neutral">
          {filteredJobs.length} {filteredJobs.length === 1 ? 'record' : 'records'}
        </span>
      </header>

      <div className="filter-tabs" role="tablist" aria-label="History filter">
        {FILTERS.map((entry) => {
          const count =
            entry.id === 'all'
              ? terminalJobs.length
              : terminalJobs.filter((job) =>
                  entry.id === 'files'
                    ? job.engineId === 'http'
                    : entry.id === 'videos'
                      ? job.engineId === 'youtube'
                      : job.engineId === 'torrent',
                ).length
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={filter === entry.id}
              className={`filter-tab${filter === entry.id ? ' filter-tab--active' : ''}`}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
              <span className="filter-count">{count}</span>
            </button>
          )
        })}
      </div>

      <JobList
        jobs={filteredJobs}
        emptyTitle="No history yet"
        emptyMessage={
          filter === 'files'
            ? 'Direct file downloads will appear here.'
            : filter === 'videos'
              ? 'YouTube downloads will appear here.'
              : filter === 'torrents'
                ? 'Completed torrents will appear here.'
                : 'Finished downloads will keep their output location and diagnostics here.'
        }
        emptyIcon="history"
        onCancel={onCancelJob}
        onRetry={onRetryJob}
        onStopSeeding={onStopSeeding}
        onRequestRemove={onRequestRemoveJob}
        onOpenLocation={onOpenJobLocation}
        removingJobId={removingJobId}
      />
    </div>
  )
}
