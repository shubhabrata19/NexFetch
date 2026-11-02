import type { DownloadJob } from '@shared/domain/job'
import type { DependencyStatus } from '@shared/ipc/contracts'
import brandIcon from '../assets/nexfetch-icon.png'
import { Icon } from './Icon'
import { SidebarActivity } from './SidebarActivity'
import { StatusDot } from './StatusDot'
import type { StatusTone } from './StatusDot'

export type View = 'downloads' | 'history' | 'settings'

interface SidebarProps {
  view: View
  version: string
  dependencies: DependencyStatus | null
  jobs: DownloadJob[]
  resolvedTheme: 'light' | 'dark'
  onNavigate: (view: View) => void
  onStopJob: (jobId: string) => void
  onToggleTheme: () => void
}

const NAV_ITEMS: Array<{ view: View; label: string; icon: 'download' | 'history' | 'settings' }> = [
  { view: 'downloads', label: 'Downloads', icon: 'download' },
  { view: 'history', label: 'History', icon: 'history' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
]

function systemSummary(dependencies: DependencyStatus | null): {
  label: string
  tone: StatusTone
} {
  if (!dependencies) return { label: 'Checking system…', tone: 'neutral' }

  const all = [dependencies.ytDlp, dependencies.ffmpeg, dependencies.ffprobe]
  if (all.every((dependency) => dependency.state === 'ready')) {
    return { label: 'System ready', tone: 'success' }
  }
  if (all.some((dependency) => dependency.state === 'error')) {
    return { label: 'System check needed', tone: 'danger' }
  }
  return { label: 'Setup needed', tone: 'warning' }
}

export function Sidebar({
  view,
  version,
  dependencies,
  jobs,
  resolvedTheme,
  onNavigate,
  onStopJob,
  onToggleTheme,
}: SidebarProps) {
  const system = systemSummary(dependencies)
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-mark">
          <img src={brandIcon} alt="" />
        </div>
        <div className="brand-copy">
          <span className="brand-name">
            <span>Nex</span>
            <span className="brand-name-accent">Fetch</span>
          </span>
          <span className="brand-tagline">Download manager</span>
        </div>
      </div>

      <nav className="nav" aria-label="Sections">
        {NAV_ITEMS.map((item) => {
          const active = view === item.view
          return (
            <button
              key={item.view}
              type="button"
              className={`nav-button${active ? ' nav-button--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              onClick={() => onNavigate(item.view)}
            >
              <Icon name={item.icon} size={19} />
              <span className="nav-label">{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-activity-wrap">
        <SidebarActivity
          jobs={jobs}
          onNavigate={() => onNavigate('downloads')}
          onStopJob={onStopJob}
        />
      </div>

      <div className="sidebar-footer">
        <button
          type="button"
          className="system-chip"
          onClick={() => onNavigate('settings')}
          aria-label={`${system.label}. Open settings.`}
        >
          <StatusDot tone={system.tone} />
          <span className="system-chip-label">{system.label}</span>
        </button>
        <div className="sidebar-footer-meta">
          <span className="version-label">v{version}</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={`Switch to ${nextTheme} theme`}
            title={`Switch to ${nextTheme} theme`}
          >
            <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
