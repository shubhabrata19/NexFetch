import { useCallback, useEffect, useState } from 'react'
import type {
  AppInfo,
  DependencyStatus,
  Settings,
  SettingsPatch,
  Theme,
} from '@shared/ipc/contracts'
import { ErrorPanel } from './components/ErrorPanel'
import { Icon } from './components/Icon'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import type { ToastState } from './components/Toast'
import type { View } from './components/Sidebar'
import { DownloadsPage } from './features/downloads/DownloadsPage'
import { HistoryPage } from './features/history/HistoryPage'
import { SettingsPage } from './features/settings/SettingsPage'

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
        <Icon name="logo" size={30} />
      </div>
      <p className="eyebrow">NexFetch</p>
      <p className="boot-message">Preparing your download workspace…</p>
      <div className="spinner" aria-hidden="true" />
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('downloads')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((kind: ToastState['kind'], message: string): void => {
    setToast({ id: Date.now(), kind, message })
  }, [])

  const load = useCallback(async (): Promise<void> => {
    if (!window.nexfetch) {
      setFatalError('The desktop bridge is unavailable. Restart the application.')
      setLoading(false)
      return
    }

    setLoading(true)
    setFatalError(null)

    const [infoResult, settingsResult, dependencyResult] = await Promise.all([
      window.nexfetch.app.getInfo(),
      window.nexfetch.settings.get(),
      window.nexfetch.dependencies.getStatus(),
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
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!window.nexfetch) return
    const unsubscribeSettings = window.nexfetch.settings.onChanged(setSettings)
    const unsubscribeDependencies = window.nexfetch.dependencies.onChanged(setDependencies)
    return () => {
      unsubscribeSettings()
      unsubscribeDependencies()
    }
  }, [])

  const theme = settings?.theme
  useEffect(() => {
    if (!theme) return
    applyTheme(theme)
    if (theme !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme('system')
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
      const allReady = [result.data.ytDlp, result.data.ffmpeg, result.data.ffprobe].every(
        (dependency) => dependency.state === 'ready',
      )
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
        onNavigate={setView}
      />

      <main className="main-scroll">
        {view === 'downloads' ? (
          <DownloadsPage
            dependencies={dependencies}
            rechecking={rechecking}
            onOpenDestination={() => {
              void openDestination()
            }}
            onOpenSettings={() => setView('settings')}
            onRecheck={() => {
              void recheckDependencies()
            }}
          />
        ) : null}

        {view === 'history' ? <HistoryPage /> : null}

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
