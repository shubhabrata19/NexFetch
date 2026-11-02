import { Icon } from './Icon'

interface ErrorPanelProps {
  message: string
  onRetry: () => void
}

export function ErrorPanel({ message, onRetry }: ErrorPanelProps) {
  return (
    <div className="boot-screen">
      <div className="error-panel" role="alert">
        <div className="error-icon">
          <Icon name="alert" size={28} />
        </div>
        <p className="eyebrow">Startup error</p>
        <h1>NexFetch could not start</h1>
        <p className="error-message">{message}</p>
        <button type="button" className="button button--primary" onClick={onRetry}>
          <Icon name="refresh" size={17} />
          Try again
        </button>
      </div>
    </div>
  )
}
