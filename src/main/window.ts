import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { Logger } from './services/logger'

export function createMainWindow(isDev: boolean, logger: Logger): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'NexFetch',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1015' : '#f5f7fa',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      spellcheck: false,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    logger.info('window_closed')
  })

  window.webContents.on('did-finish-load', () => {
    logger.info('renderer_loaded')
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    logger.warn('renderer_failed_to_load', {
      errorCode,
      errorDescription,
      url: validatedUrl.slice(0, 200),
    })
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && rendererUrl) {
    void window.loadURL(rendererUrl).catch((error: unknown) => {
      logger.error('renderer_load_url_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html')).catch((error: unknown) => {
      logger.error('renderer_load_file_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return window
}
