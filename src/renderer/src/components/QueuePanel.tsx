import type { DownloadJob, EngineInfo } from '@shared/ipc/contracts'
import { Icon } from './Icon'
import { isTerminalStatus } from '../lib/jobs'
import { JobRow } from './JobList'

interface QueuePanelProps {
  jobs: DownloadJob[]
  engines: EngineInfo[]
  onCancel: (jobId: string) => void
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onStopSeeding: (jobId: string) => void
  onRetry: (jobId: string) => void
  onRemove: (jobId: string) => void
  onOpenLocation: (jobId: string, revealFile: boolean) => void
  onOpenDestination: () => void
  onViewHistory: () => void
}

export function QueuePanel({
  jobs,
  engines,
  onCancel,
  onPause,
  onResume,
  onStopSeeding,
  onRetry,
  onRemove,
  onOpenLocation,
  onOpenDestination,
  onViewHistory,
}: QueuePanelProps) {
  const pausableEngineIds = new Set(
    engines.filter((engine) => engine.capabilities.pauseResume).map((engine) => engine.id),
  )
  const activeJobs = jobs
    .filter((job) => job.status !== 'setup' && !isTerminalStatus(job.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const recentJobs = jobs
    .filter((job) => isTerminalStatus(job.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4)

  return (
    <aside className="queue-rail" aria-labelledby="queue-rail-title">
      <section className="card queue-rail-card">
        <div className="queue-rail-heading">
          <div>
            <p className="eyebrow">Activity</p>
            <h2 id="queue-rail-title">Queue</h2>
          </div>
          <span className={`badge ${activeJobs.length > 0 ? 'badge--accent' : 'badge--neutral'}`}>
            {activeJobs.length} active
          </span>
        </div>

        <div className="queue-rail-body">
          {activeJobs.length > 0 ? (
            <div className="queue-group">
              <p className="queue-group-label">Active &amp; queued</p>
              <div className="job-list" role="list">
                {activeJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    compact
                    pausableEngineIds={pausableEngineIds}
                    onCancel={onCancel}
                    onPause={onPause}
                    onResume={onResume}
                    onStopSeeding={onStopSeeding}
                    onRetry={onRetry}
                    onRemove={onRemove}
                    onOpenLocation={onOpenLocation}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="queue-rail-empty">
              <div className="empty-icon empty-icon--small">
                <Icon name="download" size={22} />
              </div>
              <h3>Nothing downloading</h3>
              <p>Choose a quality and start a download. Progress will appear here.</p>
            </div>
          )}

          {recentJobs.length > 0 ? (
            <div className="queue-group queue-group--recent">
              <p className="queue-group-label">Recent</p>
              <div className="job-list" role="list">
                {recentJobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    compact
                    pausableEngineIds={pausableEngineIds}
                    onCancel={onCancel}
                    onPause={onPause}
                    onResume={onResume}
                    onStopSeeding={onStopSeeding}
                    onRetry={onRetry}
                    onRemove={onRemove}
                    onOpenLocation={onOpenLocation}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="queue-rail-footer">
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={onOpenDestination}
          >
            <Icon name="folder" size={15} />
            Open folder
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={onViewHistory}
          >
            History
          </button>
        </div>
      </section>
    </aside>
  )
}
