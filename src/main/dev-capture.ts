import type { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULT_VIEWS = ['downloads:youtube', 'torrents', 'history', 'settings']
const READY_TIMEOUT_MS = 20_000
const VIEW_SETTLE_MS = 900

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForRenderer(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const ready = await window.webContents.executeJavaScript(
        "Boolean(window.nexfetch && document.querySelector('.app-shell'))",
      )
      if (ready === true) return
    } catch {
      // The renderer may still be loading; retry until the deadline.
    }
    await delay(200)
  }
  throw new Error('The renderer did not become ready for screenshots.')
}

/**
 * Development-only screenshot harness. The caller must gate this on
 * `!app.isPackaged` and NEXFETCH_CAPTURE=1. The renderer listens for the
 * `nexfetch:capture-view` event only in development builds.
 */
export async function captureViews(window: BrowserWindow, outDir: string): Promise<string[]> {
  const views = (process.env.NEXFETCH_CAPTURE_VIEWS ?? DEFAULT_VIEWS.join(','))
    .split(',')
    .map((view) => view.trim())
    .filter((view) => view.length > 0)

  await mkdir(outDir, { recursive: true })
  await waitForRenderer(window)
  await delay(600)

  const written: string[] = []
  for (const view of views) {
    await window.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('nexfetch:capture-view', { detail: ${JSON.stringify(
        view,
      )} }))`,
    )
    await delay(VIEW_SETTLE_MS)
    const image = await window.webContents.capturePage()
    const name = view.replace(/[^a-z0-9-]+/gi, '-')
    const path = join(outDir, `${name}.png`)
    await writeFile(path, image.toPNG())
    written.push(path)
  }

  return written
}
