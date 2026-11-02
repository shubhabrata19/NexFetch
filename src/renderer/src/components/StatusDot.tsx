export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral'

interface StatusDotProps {
  tone: StatusTone
}

export function StatusDot({ tone }: StatusDotProps) {
  return <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
}
