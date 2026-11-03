import { app, nativeTheme, session } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc/channels'
import { DownloadManager } from './download/download-manager'
import { PreviewCache } from './download/preview-cache'
import { PreviewService } from './download/preview-service'
import { YoutubePreviewService } from './download/youtube-preview-service'
import { HttpEngine } from './engines/http/http-engine'
import { EngineRegistry } from './engines/registry'
import { YoutubeEngine } from './engines/youtube/youtube-engine'
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

const isDev = !app.isPackaged

app.setName('NexFetch')
app.enableSandbox()

let mainWindow: BrowserWindow | null = null
let logger: Logger | null = null
let downloadManager: DownloadManager | null = null
let database: SqliteDatabase | null = null
let disposeIpc: (() => void) | null = null
let shuttingDown = false

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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
    if (!downloadManager || shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void downloadManager.shutdown().finally(() => {
      app.quit()
    })
  })

  app.on('will-quit', () => {
    disposeIpc?.()
    disposeIpc = null
    downloadManager = null
    database?.close()
    database = null
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (mainWindow) {
      focusMainWindow()
      return
    }
    if (logger) mainWindow = createMainWindow(isDev, logger)
  })

  void app
    .whenReady()
    .then(() => {
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
      })

      const registry = new EngineRegistry()
      const youtubeEngine = new YoutubeEngine()
      registry.register(youtubeEngine)
      registry.register(new HttpEngine())

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

      downloadManager = new DownloadManager({
        registry,
        jobs,
        settings,
        files: fileService,
        verifier: mediaVerifier,
        dependencies: dependencyService,
        previews: previewCache,
        logger: appLogger,
        onJobChanged: (job) => {
          getMainWindow()?.webContents.send(IPC.jobsChanged, job)
        },
        onJobRemoved: (jobId) => {
          getMainWindow()?.webContents.send(IPC.jobsRemoved, jobId)
        },
      })
      downloadManager.recoverInterruptedJobs()

      disposeIpc = registerIpc({
        getWindow: getMainWindow,
        settings,
        dependencies: dependencyService,
        previewService,
        youtubePreview,
        registry,
        downloadManager,
        logger: appLogger,
      })

      mainWindow = createMainWindow(isDev, appLogger)
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
