import { useState } from 'react'
import type { AppInfo, DependencyStatus, Settings, SettingsPatch } from '@shared/ipc/contracts'
import { DependencyList } from '../../components/DependencyList'
import { Icon } from '../../components/Icon'

interface SettingsPageProps {
  settings: Settings
  appInfo: AppInfo
  dependencies: DependencyStatus | null
  rechecking: boolean
  onUpdate: (patch: SettingsPatch) => Promise<Settings | null>
  onChooseDirectory: () => Promise<void>
  onRecheck: () => Promise<void>
  onOpenLogs: () => Promise<void>
}

function platformLabel(platform: string): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

const RATE_OPTIONS = [
  { value: 0, label: 'Unlimited' },
  { value: 512 * 1024, label: '512 KB/s' },
  { value: 1 * 1024 * 1024, label: '1 MB/s' },
  { value: 2 * 1024 * 1024, label: '2 MB/s' },
  { value: 5 * 1024 * 1024, label: '5 MB/s' },
  { value: 10 * 1024 * 1024, label: '10 MB/s' },
  { value: 20 * 1024 * 1024, label: '20 MB/s' },
  { value: 50 * 1024 * 1024, label: '50 MB/s' },
] as const

function rateInMegabytes(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return ''
  const megabytes = bytesPerSecond / (1024 * 1024)
  return String(Number.isInteger(megabytes) ? megabytes : Number(megabytes.toFixed(2)))
}

export function SettingsPage({
  settings,
  appInfo,
  dependencies,
  rechecking,
  onUpdate,
  onChooseDirectory,
  onRecheck,
  onOpenLogs,
}: SettingsPageProps) {
  const [saving, setSaving] = useState(false)
  const [customRateRequested, setCustomRateRequested] = useState(false)

  const matchedRateOption = RATE_OPTIONS.find(
    (option) => option.value === settings.maxDownloadRateBytesPerSecond,
  )
  const rateSelectValue = matchedRateOption ? String(matchedRateOption.value) : 'custom'
  const showCustomRate = customRateRequested || rateSelectValue === 'custom'

  const applyPatch = async (patch: SettingsPatch): Promise<void> => {
    setSaving(true)
    try {
      await onUpdate(patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
          <p className="page-subtitle">
            Destination, concurrency, transfer limits, appearance, and local diagnostics. Changes
            save automatically.
          </p>
        </div>
        {saving ? (
          <span className="save-status" role="status">
            Saving…
          </span>
        ) : null}
      </header>

      <div className="settings-stack">
        <section className="card settings-card" aria-labelledby="settings-downloads-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Storage</p>
              <h2 id="settings-downloads-title">Downloads</h2>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">Download folder</span>
              <p>Completed files are placed in this folder. Temporary work stays hidden.</p>
            </div>
            <div className="setting-control setting-control--wide">
              <span className="path-value" title={settings.downloadDirectory}>
                {settings.downloadDirectory}
              </span>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => void onChooseDirectory()}
              >
                <Icon name="folder" size={16} />
                Choose…
              </button>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <label className="setting-name" htmlFor="setting-concurrency">
                Concurrent downloads
              </label>
              <p>Higher values use more bandwidth, disk, and CPU during FFmpeg merges.</p>
            </div>
            <select
              id="setting-concurrency"
              className="select"
              value={settings.maxConcurrentDownloads}
              onChange={(event) =>
                void applyPatch({ maxConcurrentDownloads: Number(event.target.value) })
              }
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? 'download' : 'downloads'}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <label className="setting-name" htmlFor="setting-fragments">
                Parallel connections
              </label>
              <p>
                Fragmented video streams can use this many connections. Higher values may speed up
                large videos but can trigger server throttling.
              </p>
            </div>
            <select
              id="setting-fragments"
              className="select"
              value={settings.concurrentFragments}
              onChange={(event) =>
                void applyPatch({ concurrentFragments: Number(event.target.value) })
              }
            >
              {[1, 2, 3, 4, 6, 8, 12, 16].map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? 'connection' : 'connections'}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <label className="setting-name" htmlFor="setting-rate-limit">
                Maximum download speed
              </label>
              <p>
                Caps each download. When fragments download in parallel, they share the limit.
                Changes apply to new downloads.
              </p>
            </div>
            <div className="setting-control">
              <select
                id="setting-rate-limit"
                className="select"
                value={showCustomRate ? 'custom' : rateSelectValue}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'custom') {
                    setCustomRateRequested(true)
                    return
                  }
                  setCustomRateRequested(false)
                  void applyPatch({ maxDownloadRateBytesPerSecond: Number(value) })
                }}
              >
                {RATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>

              {showCustomRate ? (
                <form
                  className="rate-custom"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    const megabytes = Number(data.get('custom-rate'))
                    if (!Number.isFinite(megabytes) || megabytes <= 0) return
                    setCustomRateRequested(false)
                    void applyPatch({
                      maxDownloadRateBytesPerSecond: Math.min(
                        1_000_000_000,
                        Math.round(megabytes * 1024 * 1024),
                      ),
                    })
                  }}
                >
                  <input
                    key={settings.maxDownloadRateBytesPerSecond}
                    className="rate-input"
                    name="custom-rate"
                    type="number"
                    min="0.01"
                    max="953.67"
                    step="0.01"
                    defaultValue={rateInMegabytes(settings.maxDownloadRateBytesPerSecond)}
                    placeholder="1"
                    aria-label="Custom maximum download speed in megabytes per second"
                    required
                  />
                  <span className="rate-unit">MB/s</span>
                  <button
                    type="submit"
                    className="button button--secondary button--small"
                    disabled={saving}
                  >
                    Apply
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card settings-card" aria-labelledby="settings-appearance-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Interface</p>
              <h2 id="settings-appearance-title">Appearance</h2>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <label className="setting-name" htmlFor="setting-theme">
                Theme
              </label>
              <p>Follow the operating system or choose a fixed appearance.</p>
            </div>
            <select
              id="setting-theme"
              className="select"
              value={settings.theme}
              onChange={(event) =>
                void applyPatch({ theme: event.target.value as Settings['theme'] })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </section>

        <section className="card settings-card" aria-labelledby="settings-diagnostics-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Diagnostics</p>
              <h2 id="settings-diagnostics-title">Runtime dependencies</h2>
            </div>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => void onRecheck()}
              disabled={rechecking}
            >
              <Icon name="refresh" size={16} />
              {rechecking ? 'Checking…' : 'Recheck'}
            </button>
          </div>
          <p className="card-copy">
            yt-dlp extracts metadata and formats. FFmpeg merges adaptive video and audio; ffprobe
            verifies the final 4K output.
          </p>
          <DependencyList status={dependencies} />
          <div className="settings-actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void onOpenLogs()}
            >
              <Icon name="folder" size={16} />
              Open log folder
            </button>
          </div>
          <p className="card-footnote">
            Development builds can use tools from PATH or the NXF_*_PATH overrides. Release builds
            will use pinned, checksum-verified bundled binaries.
          </p>
        </section>

        <section className="card settings-card" aria-labelledby="settings-about-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Product</p>
              <h2 id="settings-about-title">About NexFetch</h2>
            </div>
            <span className="badge badge--accent">Foundation</span>
          </div>
          <dl className="about-grid">
            <dt>Version</dt>
            <dd>v{appInfo.version}</dd>
            <dt>Platform</dt>
            <dd>{platformLabel(appInfo.platform)}</dd>
            <dt>Build</dt>
            <dd>{appInfo.isPackaged ? 'Packaged' : 'Development'}</dd>
            <dt>Quality policy</dt>
            <dd>Best available up to 4K · MKV allowed · verified after merge</dd>
          </dl>
          <p className="card-footnote">
            The YouTube engine is the next milestone. HTTP and BitTorrent controls remain hidden
            until those engines are implemented.
          </p>
        </section>
      </div>
    </div>
  )
}
