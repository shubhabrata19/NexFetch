import { extname } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import { sanitizeFilenameBase } from '@shared/security/filename'

const MIME_EXTENSIONS: Record<string, string> = {
  'application/7z-compressed': '.7z',
  'application/gzip': '.gz',
  'application/json': '.json',
  'application/octet-stream': '.bin',
  'application/pdf': '.pdf',
  'application/rar': '.rar',
  'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/x-bzip2': '.bz2',
  'application/x-rar-compressed': '.rar',
  'application/x-tar': '.tar',
  'application/xml': '.xml',
  'application/zip': '.zip',
  'audio/flac': '.flac',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/webm': '.weba',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'video/mp2t': '.ts',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
}

export interface ResolvedHttpFilename {
  filename: string
  filenameBase: string
  extension: string
}

export function parseHttpUrl(value: string): URL {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) {
    throw new DomainError('INVALID_URL', 'Enter a valid HTTP or HTTPS link.')
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new DomainError('INVALID_URL', 'Enter a valid HTTP or HTTPS link.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DomainError('UNSUPPORTED_SOURCE', 'Only HTTP and HTTPS links are supported.')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new DomainError(
      'INVALID_URL',
      'Links with embedded usernames or passwords are not supported.',
    )
  }
  if (url.hostname.length === 0) {
    throw new DomainError('INVALID_URL', 'The link does not contain a valid host.')
  }

  url.hash = ''
  return url
}

export function displayUrl(url: URL): string {
  const path = url.pathname.length > 0 ? url.pathname : '/'
  return `${url.origin}${path}`
}

export function contentTypeExtension(contentType: string | null | undefined): string | null {
  if (!contentType) return null
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_EXTENSIONS[normalized] ?? null
}

function normalizeExtension(value: string | null): string {
  if (!value) return '.bin'
  const normalized = value.toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(normalized) ? normalized : '.bin'
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function cleanFilename(value: string): string {
  return sanitizeFilenameBase(value, 'download').replace(/^[. ]+/g, '') || 'download'
}

export function resolveHttpFilename(options: {
  url: URL
  contentDispositionFilename?: string | null
  contentType?: string | null
}): ResolvedHttpFilename {
  const pathSegment = options.url.pathname.split('/').filter(Boolean).pop()
  const candidate =
    options.contentDispositionFilename?.trim() ||
    (pathSegment ? decodePathSegment(pathSegment) : '') ||
    'download'

  const cleaned = cleanFilename(candidate)
  const originalExtension = extname(cleaned)
  const base = originalExtension
    ? cleanFilename(cleaned.slice(0, -originalExtension.length))
    : cleaned
  const extension = normalizeExtension(
    originalExtension || contentTypeExtension(options.contentType),
  )

  return {
    filename: `${base}${extension}`,
    filenameBase: base,
    extension,
  }
}

export function splitHttpFilename(filename: string): ResolvedHttpFilename {
  const cleaned = cleanFilename(filename)
  const originalExtension = extname(cleaned)
  const base = originalExtension
    ? cleanFilename(cleaned.slice(0, -originalExtension.length))
    : cleaned
  const extension = normalizeExtension(originalExtension)
  return {
    filename: `${base}${extension}`,
    filenameBase: base,
    extension,
  }
}
