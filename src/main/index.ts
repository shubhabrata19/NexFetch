import { app, dialog, Menu, nativeImage, nativeTheme, session, Tray } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc/channels'
import type { DownloadJob } from '@shared/domain/job'
import { DownloadManager } from './download/download-manager'
import { PreviewCache } from './download/preview-cache'
import { PreviewService } from './download/preview-service'
import { YoutubePreviewService } from './download/youtube-preview-service'
import { HttpEngine } from './engines/http/http-engine'
import { EngineRegistry } from './engines/registry'
import { YoutubeEngine } from './engines/youtube/youtube-engine'
import { TorrentHelperClient } from './engines/torrent/helper-client'
import { TorrentEngine } from './engines/torrent/torrent-engine'
import { TorrentPreviewService } from './engines/torrent/torrent-preview-service'
import { registerIpc } from './ipc/register-ipc'
import { createAppMenu } from './menu'
import { configureSession, hardenWebContents } from './security'
import { DependencyService } from './services/dependency-service'
import { FileService } from './services/file-service'
import { Logger } from './services/logger'
import { MediaVerifier } from './services/media-verifier'
import { SettingsService } from './services/settings-service'
import { migrateJsonJobs } from './storage/json-migration'
import { migrateDatabase } from './storage/migrations'
import { SqliteJobRepository } from './storage/sqlite-job-repository'
import { SqliteDatabase } from './storage/sqlite-database'
import { SqliteSettingsRepository } from './storage/settings-repository'
import { createMainWindow } from './window'
import { captureViews } from './dev-capture'

const isDev = !app.isPackaged

app.setName('NexFetch')

// Development-only profile isolation for screenshot capture and manual testing.
if (isDev && process.env.NEXFETCH_USER_DATA_DIR) {
  app.setPath('userData', process.env.NEXFETCH_USER_DATA_DIR)
}

app.enableSandbox()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let logger: Logger | null = null
let downloadManager: DownloadManager | null = null
let database: SqliteDatabase | null = null
let disposeIpc: (() => void) | null = null
let disposeEngines: (() => Promise<void>) | null = null
let shuttingDown = false
let isQuitting = false
let quitPromptOpen = false

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets', 'nexfetch_icon.png')
    : join(process.cwd(), 'resources', 'assets', 'nexfetch_icon.png')
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!logger) return
    mainWindow = createMainWindow(isDev, logger)
    attachWindowCloseHandler(mainWindow)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  destroyTray()
}

function focusMainWindow(): void {
  showMainWindow()
}

function activeTransfers(): DownloadJob[] {
  if (!downloadManager) return []
  return downloadManager
    .listJobs()
    .filter(
      (job) =>
        job.status !== 'setup' &&
        job.status !== 'metadata' &&
        job.status !== 'paused' &&
        job.status !== 'completed' &&
        job.status !== 'failed' &&
        job.status !== 'cancelled',
    )
}

function transferSummary(): { active: number; seeding: number } {
  const jobs = activeTransfers()
  return {
    active: jobs.filter((job) => job.status !== 'seeding').length,
    seeding: jobs.filter((job) => job.status === 'seeding').length,
  }
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

function updateTray(): void {
  if (!tray) return
  const summary = transferSummary()
  tray.setToolTip(
    summary.active > 0 || summary.seeding > 0
      ? `NexFetch — ${summary.active} downloading, ${summary.seeding} seeding`
      : 'NexFetch',
  )
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open NexFetch', click: showMainWindow },
      { type: 'separator' },
      {
        label: 'Pause all',
        click: () => {
          void (async () => {
            if (!downloadManager) return
            const jobs = activeTransfers().filter(
              (job) =>
                job.status === 'queued' ||
                job.status === 'resolving' ||
                job.status === 'downloading',
            )
            await Promise.allSettled(jobs.map((job) => downloadManager?.pauseJob(job.id)))
          })()
        },
      },
      {
        label: 'Resume all',
        click: () => {
          void (async () => {
            if (!downloadManager) return
            const jobs = downloadManager.listJobs().filter((job) => job.status === 'paused')
            await Promise.allSettled(jobs.map((job) => downloadManager?.resumeJob(job.id)))
          })()
        },
      },
      { type: 'separator' },
      { label: 'Quit NexFetch', click: () => app.quit() },
    ]),
  )
}

function ensureTray(): boolean {
  if (tray) return true
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath()))
    tray.on('double-click', showMainWindow)
    updateTray()
    return true
  } catch (error) {
    logger?.warn('tray_unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function promptWindowClose(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || quitPromptOpen) return
  const summary = transferSummary()
  if (summary.active === 0 && summary.seeding === 0) {
    isQuitting = true
    app.quit()
    return
  }

  quitPromptOpen = true
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Downloads are still running',
      message:
        summary.seeding > 0
          ? `${summary.active} downloading, ${summary.seeding} seeding`
          : `${summary.active} ${summary.active === 1 ? 'download is' : 'downloads are'} still running`,
      detail:
        'Continue in the background to keep transfers running, or close NexFetch and resume unfinished downloads next time. Seeding stops when NexFetch closes.',
      buttons: ['Continue in Background', 'Close NexFetch', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })

    if (result.response === 0) {
      if (ensureTray()) mainWindow.hide()
      else mainWindow.minimize()
      return
    }
    if (result.response === 1) {
      isQuitting = true
      app.quit()
    }
  } finally {
    quitPromptOpen = false
  }
}

async function promptQuit(): Promise<void> {
  const summary = transferSummary()
  if (summary.active === 0 && summary.seeding === 0) {
    isQuitting = true
    app.quit()
    return
  }
  if (quitPromptOpen) return
  quitPromptOpen = true
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Stop downloads and quit?',
      message: `${summary.active} downloading, ${summary.seeding} seeding`,
      detail: 'Unfinished downloads will resume next time. Seeding stops when NexFetch closes.',
      buttons: ['Stop and Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (result.response === 0) {
      isQuitting = true
      app.quit()
    }
  } finally {
    quitPromptOpen = false
  }
}

function attachWindowCloseHandler(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (isQuitting) return
    const summary = transferSummary()
    logger?.info('window_close_requested', {
      active: summary.active,
      seeding: summary.seeding,
    })
    if (summary.active === 0 && summary.seeding === 0) return
    event.preventDefault()
    void promptWindowClose()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents)
  })

  app.on('render-process-gone', (_event, _webContents, details) => {
    logger?.error('renderer_process_gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  app.on('child-process-gone', (_event, details) => {
    logger?.warn('child_process_gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  app.on('before-quit', (event) => {
    logger?.info('app_quitting')
    if (!isQuitting) {
      const summary = transferSummary()
      if (summary.active > 0 || summary.seeding > 0) {
        event.preventDefault()
        void promptQuit()
        return
      }
      isQuitting = true
    }
    if (!downloadManager || shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void downloadManager
      .shutdown()
      .then(() => disposeEngines?.())
      .finally(() => {
        app.quit()
      })
  })

  app.on('will-quit', () => {
    disposeIpc?.()
    disposeIpc = null
    destroyTray()
    downloadManager = null
    database?.close()
    database = null
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit()
  })

  app.on('activate', () => {
    if (mainWindow) {
      focusMainWindow()
      return
    }
    if (logger) {
      mainWindow = createMainWindow(isDev, logger)
      attachWindowCloseHandler(mainWindow)
    }
  })

  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.nexfetch.desktop')

      const appLogger = new Logger(app.getPath('logs'))
      logger = appLogger
      appLogger.info('app_starting', {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
      })

      configureSession(session.defaultSession, isDev)
      createAppMenu(isDev)

      const userData = app.getPath('userData')
      const defaultDownloadDirectory = join(app.getPath('downloads'), 'NexFetch')
      const sqlite = new SqliteDatabase({
        filePath: join(userData, 'nexfetch.sqlite'),
        logger: appLogger,
      })
      sqlite.open()
      database = sqlite
      migrateDatabase(sqlite, appLogger)

      const jobs = new SqliteJobRepository(sqlite, appLogger)
      migrateJsonJobs({
        database: sqlite,
        repository: jobs,
        jobsFilePath: join(userData, 'jobs.json'),
        logger: appLogger,
      })

      const settings = new SettingsService({
        repository: new SqliteSettingsRepository(sqlite),
        defaultDownloadDirectory,
        legacyFilePath: join(userData, 'settings.json'),
        logger: appLogger,
      })

      nativeTheme.themeSource = settings.get().theme

      try {
        mkdirSync(settings.get().downloadDirectory, { recursive: true })
      } catch (error) {
        appLogger.warn('download_directory_unavailable', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      const dependencyService = new DependencyService({
        bundledRoot: app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources'),
        allowEnvOverrides: !app.isPackaged,
        logger: appLogger,
      })
      await dependencyService.verifyIntegrity()

      const registry = new EngineRegistry()
      const youtubeEngine = new YoutubeEngine()
      registry.register(youtubeEngine)
      registry.register(new HttpEngine())

      const torrentHelper = new TorrentHelperClient(
        {
          bundledRoot: app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources'),
          isPackaged: app.isPackaged,
          projectRoot: process.cwd(),
        },
        appLogger,
      )
      const torrentEngine = new TorrentEngine(torrentHelper, settings, appLogger)
      registry.register(torrentEngine)
      disposeEngines = async () => {
        await Promise.allSettled(registry.list().map((engine) => engine.dispose?.()))
      }

      const previewCache = new PreviewCache()
      const fileService = new FileService()
      const mediaVerifier = new MediaVerifier(dependencyService)
      const youtubePreview = new YoutubePreviewService(
        youtubeEngine,
        previewCache,
        dependencyService,
        appLogger,
      )
      const previewService = new PreviewService(
        registry,
        previewCache,
        dependencyService,
        appLogger,
      )
      const torrentPreview = new TorrentPreviewService(
        torrentEngine,
        previewCache,
        join(userData, 'torrent-metadata'),
        appLogger,
      )

      downloadManager = new DownloadManager({
        registry,
        jobs,
        settings,
        files: fileService,
        verifier: mediaVerifier,
        dependencies: dependencyService,
        previews: previewCache,
        logger: appLogger,
        torrentMetadata: {
          resolve: (infoHash, hashVersion, signal, onProgress) =>
            torrentPreview.resolveInfoHashMetadata(infoHash, hashVersion, signal, onProgress),
          createSelection: (preview, metadataPath) =>
            torrentEngine.createSetup(preview, metadataPath),
        },
        onJobChanged: (job) => {
          const window = getMainWindow()
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC.jobsChanged, job)
          }
          updateTray()
        },
        onJobRemoved: (jobId) => {
          const window = getMainWindow()
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC.jobsRemoved, jobId)
          }
          updateTray()
        },
      })
      downloadManager.recoverInterruptedJobs()

      disposeIpc = registerIpc({
        getWindow: getMainWindow,
        settings,
        dependencies: dependencyService,
        previewService,
        youtubePreview,
        torrentPreview,
        registry,
        downloadManager,
        logger: appLogger,
      })

      mainWindow = createMainWindow(isDev, appLogger)
      attachWindowCloseHandler(mainWindow)
      if (isDev && process.env.NEXFETCH_CAPTURE === '1') {
        const captureWindow = mainWindow
        const captureDir = process.env.NEXFETCH_CAPTURE_OUT ?? join(process.cwd(), 'docs', 'images')
        void captureViews(captureWindow, captureDir)
          .then((paths) => {
            for (const path of paths) appLogger.info('screenshot_captured', { path })
          })
          .catch((error: unknown) => {
            appLogger.error('screenshot_capture_failed', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => {
            isQuitting = true
            app.quit()
          })
      }
      downloadManager?.refreshQueue()
      appLogger.info('app_ready')
    })
    .catch((error: unknown) => {
      logger?.error('app_startup_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      database?.close()
      database = null
      app.quit()
    })
}

process.on('uncaughtException', (error) => {
  logger?.error('uncaught_exception', {
    error: error.message,
    stack: error.stack,
  })
  console.error(error)
})

process.on('unhandledRejection', (reason) => {
  logger?.error('unhandled_rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  })
})
