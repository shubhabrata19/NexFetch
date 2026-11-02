import type { DownloadJob } from '@shared/domain/job'
import { Icon } from './Icon'
import { formatSpeed } from '../lib/format'
import { isActiveStatus } from '../lib/jobs'

interface SidebarActivityProps {
  jobs: DownloadJob[]
  onNavigate: () => void
}

const STATUS_PRIORITY: Record<string, number> = {
  downloading: 0,
  processing: 1,
  verifying: 2,
  resolving: 3,
  queued: 4,
  cancelling: 5,
}

function activeJobs(jobs: DownloadJob[]): DownloadJob[] {
  return jobs
    .filter((job) => isActiveStatus(job.status))
    .sort((a, b) => {
      const priority = (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
      return priority !== 0 ? priority : a.createdAt.localeCompare(b.createdAt)
    })
}

export function SidebarActivity({ jobs, onNavigate }: SidebarActivityProps) {
  const active = activeJobs(jobs)
  const visible = active.slice(0, 2)
  const first = active[0]
  const firstPercent = first?.progress.percent ?? null

  return (
    <div className="sidebar-activity">
      <button
        type="button"
        className="sidebar-activity-heading"
        onClick={onNavigate}
        aria-label="Open active downloads"
      >
        <span className="eyebrow">Active downloads</span>
        <span
          className={`sidebar-activity-count${active.length === 0 ? ' sidebar-activity-count--idle' : ''}`}
          key={active.length}
        >
          {active.length}
        </span>
      </button>

      {visible.length > 0 ? (
        <div className="sidebar-activity-list">
          {visible.map((job) => {
            const percent = job.progress.percent
            return (
              <div className="sidebar-job" key={job.id}>
                <div className="sidebar-job-thumb">
                  {job.details?.engineId === 'youtube' && job.details.thumbnailUrl ? (
                    <img
                      src={job.details.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Icon name="download" size={13} />
                  )}
                </div>
                <div className="sidebar-job-body">
                  <div className="sidebar-job-title" title={job.title}>
                    {job.title}
                  </div>
                  <div className="sidebar-job-meta">
                    <span>{percent === null ? 'In progress' : `${Math.round(percent)}%`}</span>
                    {job.progress.bytesPerSecond !== null ? (
                      <span>{formatSpeed(job.progress.bytesPerSecond)}</span>
                    ) : null}
                  </div>
                  <div
                    className={`sidebar-progress${percent === null ? ' sidebar-progress--indeterminate' : ''}`}
                    role="progressbar"
                    aria-label={`${job.title} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent ?? undefined}
                  >
                    <span
                      className="sidebar-progress-fill"
                      style={percent !== null ? { width: `${percent}%` } : undefined}
                    />
                  </div>
                </div>
              </div>
            )
          })}
          {active.length > visible.length ? (
            <span className="sidebar-activity-more">+{active.length - visible.length} more</span>
          ) : null}
        </div>
      ) : (
        <p className="sidebar-activity-idle">No active downloads</p>
      )}

      <button type="button" className="sidebar-activity-link" onClick={onNavigate}>
        View queue
        <Icon name="download" size={13} />
      </button>

      <button
        type="button"
        className="sidebar-activity-compact"
        onClick={onNavigate}
        aria-label={`${active.length} active downloads. Open queue.`}
        title={`${active.length} active downloads`}
      >
        <Icon name="download" size={18} />
        {active.length > 0 ? (
          <span className="sidebar-activity-count" key={`compact-${active.length}`}>
            {active.length}
          </span>
        ) : null}
        {first ? (
          <span
            className={`sidebar-compact-progress${firstPercent === null ? ' sidebar-progress--indeterminate' : ''}`}
          >
            <span
              className="sidebar-compact-progress-fill"
              style={firstPercent !== null ? { width: `${firstPercent}%` } : undefined}
            />
          </span>
        ) : null}
      </button>
    </div>
  )
}
