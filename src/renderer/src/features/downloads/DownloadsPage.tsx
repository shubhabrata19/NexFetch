import type { DependencyStatus } from '@shared/ipc/contracts'
import { DependencyList } from '../../components/DependencyList'
import { Icon } from '../../components/Icon'

interface DownloadsPageProps {
  dependencies: DependencyStatus | null
  rechecking: boolean
  onOpenDestination: () => void
  onOpenSettings: () => void
  onRecheck: () => void
}

function readinessSummary(dependencies: DependencyStatus | null): {
  label: string
  tone: string
} {
  if (!dependencies) return { label: 'Checking', tone: 'badge--neutral' }
  const all = [dependencies.ytDlp, dependencies.ffmpeg, dependencies.ffprobe]
  if (all.every((dependency) => dependency.state === 'ready')) {
    return { label: 'Ready', tone: 'badge--success' }
  }
  return { label: 'Setup needed', tone: 'badge--warning' }
}

export function DownloadsPage({
  dependencies,
  rechecking,
  onOpenDestination,
  onOpenSettings,
  onRecheck,
}: DownloadsPageProps) {
  const readiness = readinessSummary(dependencies)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Downloads</h1>
          <p className="page-subtitle">
            Active transfers, your queue, and completed files will live here.
          </p>
        </div>
        <span className="badge badge--neutral">0 jobs</span>
      </header>

      <div className="downloads-layout">
        <section className="card empty-state" aria-labelledby="empty-downloads-title">
          <div className="empty-icon">
            <Icon name="download" size={30} />
          </div>
          <h2 id="empty-downloads-title">No downloads yet</h2>
          <p>
            The secure foundation is ready. The YouTube engine — metadata, actual formats up to 4K,
            and FFmpeg merging — is the next milestone.
          </p>
          <div className="empty-actions">
            <button type="button" className="button button--primary" onClick={onOpenDestination}>
              <Icon name="folder" size={17} />
              Open download folder
            </button>
            <button type="button" className="button button--secondary" onClick={onOpenSettings}>
              Review settings
            </button>
          </div>
          <p className="empty-note">
            No fake queue controls are shown before the download engine exists.
          </p>
        </section>

        <aside className="page-aside">
          <section className="card aside-card" aria-labelledby="system-title">
            <div className="card-heading">
              <div>
                <p className="eyebrow">System</p>
                <h2 id="system-title">Readiness</h2>
              </div>
              <span className={`badge ${readiness.tone}`}>{readiness.label}</span>
            </div>
            <p className="card-copy">
              Development builds look for the tools on PATH. Release builds will bundle verified
              yt-dlp and FFmpeg binaries.
            </p>
            <DependencyList status={dependencies} />
            <button
              type="button"
              className="button button--secondary button--small button--full"
              onClick={onRecheck}
              disabled={rechecking}
            >
              <Icon name="refresh" size={16} />
              {rechecking ? 'Checking…' : 'Recheck dependencies'}
            </button>
          </section>

          <section className="card aside-card quality-card" aria-labelledby="quality-title">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Quality policy</p>
                <h2 id="quality-title">4K first</h2>
              </div>
              <span className="badge badge--accent">Locked</span>
            </div>
            <ul className="check-list">
              <li>
                <Icon name="check" size={16} />
                Best available up to 2160p
              </li>
              <li>
                <Icon name="check" size={16} />
                No silent downgrade to 1080p
              </li>
              <li>
                <Icon name="check" size={16} />
                MKV allowed for true 4K codecs
              </li>
              <li>
                <Icon name="check" size={16} />
                ffprobe verification after merge
              </li>
            </ul>
            <p className="card-footnote">
              Quality wins over container compatibility. Manual MP4 choices remain available when
              the selected codecs support them.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
