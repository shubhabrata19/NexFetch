import { Icon } from '../../components/Icon'

export function HistoryPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Archive</p>
          <h1>History</h1>
          <p className="page-subtitle">
            Completed, failed, and cancelled jobs will be listed here.
          </p>
        </div>
        <span className="badge badge--neutral">0 records</span>
      </header>

      <section
        className="card empty-state empty-state--compact"
        aria-labelledby="empty-history-title"
      >
        <div className="empty-icon">
          <Icon name="history" size={30} />
        </div>
        <h2 id="empty-history-title">No history yet</h2>
        <p>
          Finished downloads will keep their output location and diagnostics here. Clearing history
          will never delete downloaded files.
        </p>
      </section>
    </div>
  )
}
