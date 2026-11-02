import type { Session, WebContents } from 'electron'

function buildContentSecurityPolicy(isDev: boolean): string {
  const scriptSources = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
  const connectSources = isDev ? "'self' http://localhost:* ws://localhost:*" : "'self'"

  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://i.ytimg.com https://img.youtube.com",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function configureSession(session: Session, isDev: boolean): void {
  const csp = buildContentSecurityPolicy(isDev)

  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.setPermissionCheckHandler(() => false)

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}

export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
