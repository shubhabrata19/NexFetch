import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ZodType } from 'zod'
import { DomainError } from '@shared/domain/errors'
import type { ErrorCode } from '@shared/domain/errors'
import type { AppInfo, DownloadJob, Result } from '@shared/ipc/contracts'
import { IPC } from '@shared/ipc/channels'
import {
  createJobRequestSchema,
  jobIdRequestSchema,
  openLocationRequestSchema,
  youtubeCancelPreviewSchema,
  youtubePreviewRequestSchema,
} from '@shared/validation/jobs'
import { settingsPatchSchema } from '@shared/validation/settings'
import type { DownloadManager } from '../download/download-manager'
import type { YoutubePreviewService } from '../download/youtube-preview-service'
import type { DependencyService } from '../services/dependency-service'
import type { Logger } from '../services/logger'
import type { SettingsService } from '../services/settings-service'

interface IpcDependencies {
  getWindow: () => BrowserWindow | null
  settings: SettingsService
  dependencies: DependencyService
  youtubePreview: YoutubePreviewService
  downloadManager: DownloadManager
  logger: Logger
}

const INVOKE_CHANNELS = [
  IPC.appInfo,
  IPC.settingsGet,
  IPC.settingsUpdate,
  IPC.chooseDirectory,
  IPC.openDestination,
  IPC.openLogs,
  IPC.dependenciesStatus,
  IPC.dependenciesRecheck,
  IPC.youtubePreview,
  IPC.youtubeCancelPreview,
  IPC.jobsCreate,
  IPC.jobsList,
  IPC.jobsCancel,
  IPC.jobsRetry,
  IPC.jobsRemove,
  IPC.jobsOpenLocation,
] as const

function success<T>(data: T): Result<T> {
  return { ok: true, data }
}

function failure(
  code: ErrorCode,
  message: string,
  logger: Logger,
  context: Record<string, unknown>,
): Result<never> {
  const diagnosticId = randomUUID()
  logger.warn('request_failed', { code, message, diagnosticId, ...context })
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: code === 'NETWORK_ERROR' || code === 'INTERNAL_ERROR',
      diagnosticId,
    },
  }
}

export function registerIpc(dependencies: IpcDependencies): () => void {
  const {
    getWindow,
    settings,
    dependencies: dependencyService,
    youtubePreview,
    downloadManager,
    logger,
  } = dependencies
  const previewControllers = new Map<string, AbortController>()

  const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return false
    return event.sender.id === window.webContents.id && event.senderFrame === event.sender.mainFrame
  }

  function handle<TRequest, TResponse>(
    channel: string,
    schema: ZodType<TRequest> | null,
    handler: (request: TRequest) => Promise<TResponse> | TResponse,
  ): void {
    ipcMain.handle(channel, async (event, rawInput: unknown) => {
      if (!isTrustedSender(event)) {
        return failure('PERMISSION_DENIED', 'This request was rejected.', logger, { channel })
      }

      let request: TRequest
      if (schema) {
        const parsed = schema.safeParse(rawInput)
        if (!parsed.success) {
          return failure('INVALID_REQUEST', 'The request was invalid.', logger, {
            channel,
            issueCount: parsed.error.issues.length,
          })
        }
        request = parsed.data
      } else {
        request = rawInput as TRequest
      }

      try {
        return success(await handler(request))
      } catch (error) {
        if (error instanceof DomainError) {
          return failure(error.code, error.message, logger, { channel })
        }

        const diagnosticId = randomUUID()
        logger.error('ipc_handler_failed', {
          channel,
          diagnosticId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'The operation could not be completed. Check the local logs for details.',
            retryable: true,
            diagnosticId,
          },
        }
      }
    })
  }

  handle<void, AppInfo>(IPC.appInfo, null, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  }))

  handle<void, ReturnType<SettingsService['get']>>(IPC.settingsGet, null, () => settings.get())

  handle(IPC.settingsUpdate, settingsPatchSchema, async (patch) => {
    if (patch.downloadDirectory !== undefined) {
      if (!isAbsolute(patch.downloadDirectory)) {
        throw new DomainError('INVALID_REQUEST', 'Choose an absolute download folder.')
      }
      try {
        await mkdir(patch.downloadDirectory, { recursive: true })
      } catch {
        throw new DomainError(
          'PERMISSION_DENIED',
          'The selected download folder could not be created.',
        )
      }
    }

    const updated = settings.update(patch)
    nativeTheme.themeSource = updated.theme
    getWindow()?.webContents.send(IPC.settingsChanged, updated)
    downloadManager.refreshQueue()
    logger.info('settings_updated', { keys: Object.keys(patch).sort() })
    return updated
  })

  handle<void, string | null>(IPC.chooseDirectory, null, async () => {
    const window = getWindow()
    if (!window) throw new DomainError('INTERNAL_ERROR', 'The application window is unavailable.')

    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a download folder',
      defaultPath: settings.get().downloadDirectory,
      properties: ['openDirectory', 'createDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  handle<void, null>(IPC.openDestination, null, async () => {
    const directory = settings.get().downloadDirectory
    await mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) {
      logger.warn('open_destination_failed', { error })
      throw new DomainError('PERMISSION_DENIED', 'The download folder could not be opened.')
    }
    return null
  })

  handle<void, null>(IPC.openLogs, null, async () => {
    const error = await shell.openPath(logger.directory)
    if (error) {
      logger.warn('open_logs_failed', { error })
      throw new DomainError('PERMISSION_DENIED', 'The log folder could not be opened.')
    }
    return null
  })

  handle<void, Awaited<ReturnType<DependencyService['getStatus']>>>(
    IPC.dependenciesStatus,
    null,
    () => dependencyService.getStatus(),
  )

  handle<void, Awaited<ReturnType<DependencyService['getStatus']>>>(
    IPC.dependenciesRecheck,
    null,
    async () => {
      const status = await dependencyService.getStatus()
      getWindow()?.webContents.send(IPC.dependenciesChanged, status)
      logger.info('dependencies_rechecked', {
        ytDlp: status.ytDlp.state,
        ffmpeg: status.ffmpeg.state,
        ffprobe: status.ffprobe.state,
      })
      return status
    },
  )

  handle(IPC.youtubePreview, youtubePreviewRequestSchema, async ({ url, requestId }) => {
    for (const [existingId, controller] of previewControllers) {
      if (existingId !== requestId) {
        controller.abort()
        previewControllers.delete(existingId)
      }
    }

    const controller = new AbortController()
    previewControllers.set(requestId, controller)
    try {
      return await youtubePreview.preview(url, controller.signal)
    } finally {
      previewControllers.delete(requestId)
    }
  })

  handle(IPC.youtubeCancelPreview, youtubeCancelPreviewSchema, ({ requestId }) => {
    previewControllers.get(requestId)?.abort()
    previewControllers.delete(requestId)
    return null
  })

  handle(IPC.jobsCreate, createJobRequestSchema, (request) => downloadManager.createJob(request))

  handle<void, DownloadJob[]>(IPC.jobsList, null, () => downloadManager.listJobs())

  handle(IPC.jobsCancel, jobIdRequestSchema, ({ jobId }) => downloadManager.cancelJob(jobId))

  handle(IPC.jobsRetry, jobIdRequestSchema, ({ jobId }) => downloadManager.retryJob(jobId))

  handle(IPC.jobsRemove, jobIdRequestSchema, async ({ jobId }) => {
    await downloadManager.removeJob(jobId)
    return null
  })

  handle(IPC.jobsOpenLocation, openLocationRequestSchema, async ({ jobId, revealFile }) => {
    const job = downloadManager.getJob(jobId)
    if (!job) throw new DomainError('INVALID_REQUEST', 'The download job was not found.')

    if (job.output) {
      if (revealFile && job.output.files[0]) {
        shell.showItemInFolder(job.output.files[0].path)
        return null
      }
      const error = await shell.openPath(job.output.directory)
      if (error) {
        logger.warn('open_job_destination_failed', { error })
        throw new DomainError('PERMISSION_DENIED', 'The download folder could not be opened.')
      }
      return null
    }

    await mkdir(job.destination, { recursive: true })
    const error = await shell.openPath(job.destination)
    if (error) {
      logger.warn('open_job_destination_failed', { error })
      throw new DomainError('PERMISSION_DENIED', 'The download folder could not be opened.')
    }
    return null
  })

  return () => {
    for (const controller of previewControllers.values()) controller.abort()
    previewControllers.clear()
    for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel)
  }
}
