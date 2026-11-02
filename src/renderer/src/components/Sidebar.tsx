import type { DependencyStatus } from '@shared/ipc/contracts'
import { Icon } from './Icon'
import { StatusDot } from './StatusDot'
import type { StatusTone } from './StatusDot'

export type View = 'downloads' | 'history' | 'settings'

interface SidebarProps {
  view: View
  version: string
  dependencies: DependencyStatus | null
  onNavigate: (view: View) => void
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

export function Sidebar({ view, version, dependencies, onNavigate }: SidebarProps) {
  const system = systemSummary(dependencies)

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="logo" size={22} />
        </div>
        <div className="brand-copy">
          <span className="brand-name">NexFetch</span>
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
        <span className="version-label">v{version}</span>
      </div>
    </aside>
  )
}
