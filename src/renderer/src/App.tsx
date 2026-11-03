import { useCallback, useEffect, useState } from 'react'
import type {
  AppInfo,
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  EngineInfo,
  Settings,
  SettingsPatch,
  Theme,
  TorrentSetupUpdateRequest,
} from '@shared/ipc/contracts'
import brandIcon from './assets/nexfetch-icon.png'
import { ErrorPanel } from './components/ErrorPanel'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import type { ToastState } from './components/Toast'
import type { View } from './components/Sidebar'
import { DownloadsPage } from './features/downloads/DownloadsPage'
import type { SourceTab } from './features/downloads/DownloadsPage'
import { HistoryPage } from './features/history/HistoryPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TorrentsPage } from './features/torrent/TorrentsPage'

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
}

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-mark">
        <img src={brandIcon} alt="" />
      </div>
      <p className="eyebrow">NexFetch</p>
      <p className="boot-message">Preparing your download workspace…</p>
      <div className="spinner" aria-hidden="true" />
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('downloads')
  const [downloadSource, setDownloadSource] = useState<SourceTab>('youtube')
  const [selectedTorrentId, setSelectedTorrentId] = useState<string | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme('system'))
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(null)
  const [engines, setEngines] = useState<EngineInfo[]>([])
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((kind: ToastState['kind'], message: string): void => {
    setToast({ id: Date.now(), kind, message })
  }, [])

  const upsertJob = useCallback((job: DownloadJob): void => {
    setJobs((previous) => {
      const index = previous.findIndex((existing) => existing.id === job.id)
      if (index === -1) return [job, ...previous]
      const next = [...previous]
      next[index] = job
      return next
    })
  }, [])

  const load = useCallback(async (): Promise<void> => {
    if (!window.nexfetch) {
      setFatalError('The desktop bridge is unavailable. Restart the application.')
      setLoading(false)
      return
    }

    setLoading(true)
    setFatalError(null)

    const [infoResult, settingsResult, dependencyResult, engineResult, jobsResult] =
      await Promise.all([
        window.nexfetch.app.getInfo(),
        window.nexfetch.settings.get(),
        window.nexfetch.dependencies.getStatus(),
        window.nexfetch.engines.list(),
        window.nexfetch.jobs.list(),
      ])

    if (!infoResult.ok) {
      setFatalError(infoResult.error.message)
      setLoading(false)
      return
    }
    if (!settingsResult.ok) {
      setFatalError(settingsResult.error.message)
      setLoading(false)
      return
    }

    setInfo(infoResult.data)
    setSettings(settingsResult.data)
    if (dependencyResult.ok) {
      setDependencies(dependencyResult.data)
    } else {
      showToast('error', dependencyResult.error.message)
    }
    if (engineResult.ok) {
      setEngines(engineResult.data)
    }
    if (jobsResult.ok) {
      setJobs(jobsResult.data)
    } else {
      showToast('error', jobsResult.error.message)
    }
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!window.nexfetch) return
    const unsubscribeSettings = window.nexfetch.settings.onChanged(setSettings)
    const unsubscribeDependencies = window.nexfetch.dependencies.onChanged(setDependencies)
    const unsubscribeJobs = window.nexfetch.jobs.onChanged(upsertJob)
    const unsubscribeRemoved = window.nexfetch.jobs.onRemoved((jobId) => {
      setJobs((previous) => previous.filter((job) => job.id !== jobId))
    })
    return () => {
      unsubscribeSettings()
      unsubscribeDependencies()
      unsubscribeJobs()
      unsubscribeRemoved()
    }
  }, [upsertJob])

  const theme = settings?.theme
  useEffect(() => {
    if (!theme) return
    applyTheme(theme)
    setResolvedTheme(resolveTheme(theme))
    if (theme !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      applyTheme('system')
      setResolvedTheme(resolveTheme('system'))
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const updateSettings = useCallback(
    async (patch: SettingsPatch): Promise<Settings | null> => {
      const result = await window.nexfetch.settings.update(patch)
      if (!result.ok) {
        showToast('error', result.error.message)
        return null
      }
      setSettings(result.data)
      return result.data
    },
    [showToast],
  )

  const toggleTheme = useCallback((): void => {
    void updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })
  }, [resolvedTheme, updateSettings])

  const chooseDirectory = useCallback(async (): Promise<void> => {
    const result = await window.nexfetch.system.chooseDirectory()
    if (!result.ok) {
      showToast('error', result.error.message)
      return
    }
    if (result.data) {
      const updated = await updateSettings({ downloadDirectory: result.data })
      if (updated) showToast('success', 'Download folder updated.')
    }
  }, [showToast, updateSettings])

  const openDestination = useCallback(async (): Promise<void> => {
    const result = await window.nexfetch.system.openDestination()
    if (!result.ok) showToast('error', result.error.message)
  }, [showToast])

  const openLogs = useCallback(async (): Promise<void> => {
    const result = await window.nexfetch.system.openLogs()
    if (!result.ok) showToast('error', result.error.message)
  }, [showToast])

  const recheckDependencies = useCallback(async (): Promise<void> => {
    setRechecking(true)
    try {
      const result = await window.nexfetch.dependencies.recheck()
      if (!result.ok) {
        showToast('error', result.error.message)
        return
      }
      setDependencies(result.data)
      const allReady = [
        result.data.ytDlp,
        result.data.ffmpeg,
        result.data.ffprobe,
        result.data.torrentHelper,
      ].every((dependency) => dependency.state === 'ready')
      showToast(
        allReady ? 'success' : 'info',
        allReady
          ? 'All runtime dependencies are ready.'
          : 'Dependency check complete — setup is still required.',
      )
    } finally {
      setRechecking(false)
    }
  }, [showToast])

  const createJob = useCallback(
    async (request: CreateJobRequest): Promise<DownloadJob | null> => {
      const result = await window.nexfetch.jobs.create(request)
      if (!result.ok) {
        showToast('error', result.error.message)
        return null
      }
      upsertJob(result.data)
      showToast('success', 'Added to the download queue.')
      return result.data
    },
    [showToast, upsertJob],
  )

  const createTorrentSetup = useCallback(
    async (request: CreateJobRequest): Promise<DownloadJob | null> => {
      const result = await window.nexfetch.jobs.create(request)
      if (!result.ok) {
        showToast('error', result.error.message)
        return null
      }
      upsertJob(result.data)
      setSelectedTorrentId(result.data.id)
      setView('torrents')
      showToast('success', 'Torrent ready to set up.')
      return result.data
    },
    [showToast, upsertJob],
  )

  const openTorrent = useCallback((jobId: string): void => {
    setSelectedTorrentId(jobId)
    setView('torrents')
  }, [])

  const startTorrentSetup = useCallback(
    async (request: TorrentSetupUpdateRequest): Promise<DownloadJob | null> => {
      const result = await window.nexfetch.jobs.startSetup(request)
      if (!result.ok) {
        showToast('error', result.error.message)
        return null
      }
      upsertJob(result.data)
      showToast('success', 'Torrent added to the download queue.')
      return result.data
    },
    [showToast, upsertJob],
  )

  const startSeeding = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.startSeeding({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('info', 'Seeding started.')
      })()
    },
    [showToast, upsertJob],
  )

  const stopSeeding = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.stopSeeding({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('info', 'Seeding stopped.')
      })()
    },
    [showToast, upsertJob],
  )

  const setTorrentLimits = useCallback(
    (
      jobId: string,
      downloadLimitBytesPerSecond: number | null,
      uploadLimitBytesPerSecond: number | null,
    ): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.setTorrentLimits({
          jobId,
          downloadLimitBytesPerSecond,
          uploadLimitBytesPerSecond,
        })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('success', 'Torrent speed limits updated.')
      })()
    },
    [showToast, upsertJob],
  )

  const findMorePeers = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.findMorePeers({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('info', 'Asking trackers and DHT for more peers.')
      })()
    },
    [showToast, upsertJob],
  )

  const verifyTorrent = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.verifyTorrent({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('info', 'Checking torrent pieces.')
      })()
    },
    [showToast, upsertJob],
  )

  const cancelJob = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.cancel({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
      })()
    },
    [showToast, upsertJob],
  )

  const pauseJob = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.pause({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
      })()
    },
    [showToast, upsertJob],
  )

  const resumeJob = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.resume({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('info', 'Download resumed.')
      })()
    },
    [showToast, upsertJob],
  )

  const retryJob = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.retry({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        upsertJob(result.data)
        showToast('info', 'Download queued again.')
      })()
    },
    [showToast, upsertJob],
  )

  const removeJob = useCallback(
    (jobId: string): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.remove({ jobId })
        if (!result.ok) {
          showToast('error', result.error.message)
          return
        }
        setJobs((previous) => previous.filter((job) => job.id !== jobId))
      })()
    },
    [showToast],
  )

  const openJobLocation = useCallback(
    (jobId: string, revealFile: boolean): void => {
      void (async () => {
        const result = await window.nexfetch.jobs.openLocation({ jobId, revealFile })
        if (!result.ok) showToast('error', result.error.message)
      })()
    },
    [showToast],
  )

  if (loading) return <BootScreen />

  if (fatalError || !settings || !info) {
    return (
      <ErrorPanel
        message={fatalError ?? 'The application state could not be loaded.'}
        onRetry={() => {
          void load()
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        version={info.version}
        dependencies={dependencies}
        jobs={jobs}
        resolvedTheme={resolvedTheme}
        onNavigate={setView}
        onStopJob={cancelJob}
        onToggleTheme={toggleTheme}
      />

      <main className="main-scroll">
        {view === 'downloads' ? (
          <DownloadsPage
            settings={settings}
            dependencies={dependencies}
            engines={engines}
            jobs={jobs}
            source={downloadSource}
            onSourceChange={setDownloadSource}
            onCreateJob={createJob}
            onCreateTorrent={createTorrentSetup}
            onOpenTorrent={openTorrent}
            onCancelJob={cancelJob}
            onPauseJob={pauseJob}
            onResumeJob={resumeJob}
            onStopSeeding={stopSeeding}
            onRetryJob={retryJob}
            onRemoveJob={removeJob}
            onOpenJobLocation={openJobLocation}
            onOpenDestination={() => {
              void openDestination()
            }}
            onOpenSettings={() => setView('settings')}
            onViewHistory={() => setView('history')}
          />
        ) : null}

        {view === 'torrents' ? (
          <TorrentsPage
            settings={settings}
            jobs={jobs}
            selectedJobId={selectedTorrentId}
            onSelectJob={setSelectedTorrentId}
            onStartSetup={startTorrentSetup}
            onCancelJob={cancelJob}
            onPauseJob={pauseJob}
            onResumeJob={resumeJob}
            onRetryJob={retryJob}
            onStartSeeding={startSeeding}
            onStopSeeding={stopSeeding}
            onRemoveJob={removeJob}
            onOpenLocation={openJobLocation}
            onFindMorePeers={findMorePeers}
            onVerifyTorrent={verifyTorrent}
            onSetTorrentLimits={setTorrentLimits}
            onAddTorrent={() => {
              setDownloadSource('torrent')
              setView('downloads')
            }}
            onOpenSettings={() => setView('settings')}
          />
        ) : null}

        {view === 'history' ? (
          <HistoryPage
            jobs={jobs}
            onCancelJob={cancelJob}
            onRetryJob={retryJob}
            onStopSeeding={stopSeeding}
            onRemoveJob={removeJob}
            onOpenJobLocation={openJobLocation}
          />
        ) : null}

        {view === 'settings' ? (
          <SettingsPage
            settings={settings}
            appInfo={info}
            dependencies={dependencies}
            rechecking={rechecking}
            onUpdate={updateSettings}
            onChooseDirectory={chooseDirectory}
            onRecheck={recheckDependencies}
            onOpenLogs={openLogs}
          />
        ) : null}
      </main>

      <Toast toast={toast} />
    </div>
  )
}
