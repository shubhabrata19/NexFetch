import type { DependencyInfo, DependencyStatus } from '@shared/ipc/contracts'
import { StatusDot } from './StatusDot'
import type { StatusTone } from './StatusDot'

interface DependencyListProps {
  status: DependencyStatus | null
}

const DEPENDENCIES: Array<{ key: keyof DependencyStatus; label: string }> = [
  { key: 'ytDlp', label: 'yt-dlp' },
  { key: 'ffmpeg', label: 'FFmpeg' },
  { key: 'ffprobe', label: 'ffprobe' },
]

function toneFor(info: DependencyInfo | undefined): StatusTone {
  if (!info) return 'neutral'
  if (info.state === 'ready') return 'success'
  if (info.state === 'missing') return 'warning'
  return 'danger'
}

function stateLabel(info: DependencyInfo | undefined): string {
  if (!info) return 'Checking…'
  if (info.state === 'ready') return info.version ?? 'Ready'
  if (info.state === 'missing') return 'Not detected'
  return 'Check failed'
}

function sourceLabel(info: DependencyInfo | undefined): string | null {
  if (!info?.source) return null
  if (info.source === 'bundled') return 'Bundled'
  if (info.source === 'system') return 'System'
  return 'Development override'
}

export function DependencyList({ status }: DependencyListProps) {
  return (
    <div className="dependency-list">
      {DEPENDENCIES.map(({ key, label }) => {
        const info = status?.[key]
        const source = sourceLabel(info)
        return (
          <div className="dependency-row" key={key}>
            <div className="dependency-name">
              <StatusDot tone={toneFor(info)} />
              <span>{label}</span>
            </div>
            <div className="dependency-meta">
              <span className="dependency-version" title={info?.version ?? undefined}>
                {stateLabel(info)}
              </span>
              {source ? <span className="dependency-source">{source}</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
