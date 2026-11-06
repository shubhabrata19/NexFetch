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
  onOpenReleases: () => Promise<void>
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

const UPLOAD_RATE_OPTIONS = [
  { value: 0, label: 'Unlimited' },
  { value: 128 * 1024, label: '128 KB/s' },
  { value: 256 * 1024, label: '256 KB/s' },
  { value: 512 * 1024, label: '512 KB/s' },
  { value: 1 * 1024 * 1024, label: '1 MB/s' },
  { value: 2 * 1024 * 1024, label: '2 MB/s' },
  { value: 5 * 1024 * 1024, label: '5 MB/s' },
  { value: 10 * 1024 * 1024, label: '10 MB/s' },
] as const

function rateInMegabytes(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return ''
  const megabytes = bytesPerSecond / (1024 * 1024)
  return String(Number.isInteger(megabytes) ? megabytes : Number(megabytes.toFixed(2)))
}

function rateDraftBytes(value: string): number | null {
  if (value.trim() === '') return null
  const megabytes = Number(value)
  if (!Number.isFinite(megabytes) || megabytes <= 0) return null
  return Math.min(1_000_000_000, Math.round(megabytes * 1024 * 1024))
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
  onOpenReleases,
}: SettingsPageProps) {
  const [saving, setSaving] = useState(false)
  const [customRateRequested, setCustomRateRequested] = useState(false)
  const [customRateDraft, setCustomRateDraft] = useState<string | null>(null)

  const matchedRateOption = RATE_OPTIONS.find(
    (option) => option.value === settings.maxDownloadRateBytesPerSecond,
  )
  const rateSelectValue = matchedRateOption ? String(matchedRateOption.value) : 'custom'
  const showCustomRate = customRateRequested || rateSelectValue === 'custom'
  const savedCustomRate = rateInMegabytes(settings.maxDownloadRateBytesPerSecond)
  const customRateValue = customRateDraft ?? savedCustomRate
  const customRateBytes = rateDraftBytes(customRateValue)
  const customRateDirty =
    showCustomRate &&
    (customRateBytes === null
      ? customRateValue !== savedCustomRate
      : customRateBytes !== settings.maxDownloadRateBytesPerSecond)

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
              <p>
                Applies to YouTube, direct files, and torrents. Higher values use more bandwidth,
                disk, and CPU during FFmpeg merges.
              </p>
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
                    setCustomRateDraft(null)
                    return
                  }
                  setCustomRateRequested(false)
                  setCustomRateDraft(null)
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
                    const bytes = rateDraftBytes(customRateValue)
                    if (bytes === null) return
                    const matchesPreset = RATE_OPTIONS.some((option) => option.value === bytes)
                    setCustomRateRequested(!matchesPreset)
                    setCustomRateDraft(matchesPreset ? null : rateInMegabytes(bytes))
                    void applyPatch({ maxDownloadRateBytesPerSecond: bytes })
                  }}
                >
                  <input
                    className="rate-input"
                    name="custom-rate"
                    type="number"
                    min="0.01"
                    max="953.67"
                    step="0.01"
                    value={customRateValue}
                    onChange={(event) => setCustomRateDraft(event.target.value)}
                    placeholder="1"
                    aria-label="Custom maximum download speed in megabytes per second"
                    required
                  />
                  <span className="rate-unit">MB/s</span>
                  {customRateDirty ? (
                    <button
                      type="submit"
                      className="button button--secondary button--small"
                      disabled={saving}
                    >
                      Apply
                    </button>
                  ) : null}
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card settings-card" aria-labelledby="settings-torrents-title">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Peer-to-peer</p>
              <h2 id="settings-torrents-title">Torrents</h2>
            </div>
            <span className="badge badge--accent">BitTorrent</span>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <label className="setting-name" htmlFor="setting-torrent-profile">
                Connection profile
              </label>
              <p>
                Controls how many peers NexFetch connects to. Maximum uses more sockets and memory.
              </p>
            </div>
            <select
              id="setting-torrent-profile"
              className="select"
              value={settings.torrentConnectionProfile}
              onChange={(event) =>
                void applyPatch({
                  torrentConnectionProfile: event.target
                    .value as Settings['torrentConnectionProfile'],
                })
              }
            >
              <option value="balanced">Balanced · 50 per torrent / 200 total</option>
              <option value="high">High · 100 per torrent / 500 total</option>
              <option value="maximum">Maximum · 200 per torrent / 1,000 total</option>
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <label className="setting-name" htmlFor="setting-upload-rate">
                Maximum upload speed
              </label>
              <p>Applies to torrent uploads and seeding. Per-torrent limits can override it.</p>
            </div>
            <select
              id="setting-upload-rate"
              className="select"
              value={settings.maxUploadRateBytesPerSecond}
              onChange={(event) =>
                void applyPatch({
                  maxUploadRateBytesPerSecond: Number(event.target.value),
                })
              }
            >
              {UPLOAD_RATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">Router port mapping</span>
              <p>
                Uses NAT-PMP first, then UPnP, to open one temporary port for incoming peers. Turn
                this off if you do not want NexFetch changing router state.
              </p>
            </div>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={settings.torrentNATMapping}
                onChange={(event) => void applyPatch({ torrentNATMapping: event.target.checked })}
              />
              <span>{settings.torrentNATMapping ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">Keep seeding by default</span>
              <p>
                New torrents stop uploading when the download completes unless this is on or the
                per-torrent option is selected.
              </p>
            </div>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={settings.torrentSeedAfterComplete}
                onChange={(event) =>
                  void applyPatch({ torrentSeedAfterComplete: event.target.checked })
                }
              />
              <span>{settings.torrentSeedAfterComplete ? 'On' : 'Off'}</span>
            </label>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">Resume unfinished downloads</span>
              <p>
                Incomplete HTTP and torrent jobs resume when NexFetch starts. Seeding never resumes
                automatically.
              </p>
            </div>
            <label className="setting-toggle">
              <input
                type="checkbox"
                checked={settings.resumeIncompleteDownloads}
                onChange={(event) =>
                  void applyPatch({ resumeIncompleteDownloads: event.target.checked })
                }
              />
              <span>{settings.resumeIncompleteDownloads ? 'On' : 'Off'}</span>
            </label>
          </div>

          <p className="card-footnote">
            Web seeds are disabled. DHT, PEX, and local peer discovery are on for public torrents
            and automatically off for private torrents. Encryption is always enabled.
          </p>
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
            verifies the final 4K output. The torrent engine is a bundled libtorrent helper.
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
          <div className="settings-actions">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => void onOpenReleases()}
            >
              <Icon name="download" size={16} />
              Check for updates
            </button>
          </div>
          <p className="card-footnote">
            Opens the GitHub releases page in your browser. NexFetch does not install updates
            automatically; download the latest unsigned preview from the release page.
          </p>
          <p className="card-footnote">
            YouTube, HTTP, and BitTorrent are independent engines behind one queue. Torrent metadata
            is parsed locally; magnets are intentionally not accepted.
          </p>
        </section>
      </div>
    </div>
  )
}
