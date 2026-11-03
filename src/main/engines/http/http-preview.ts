import { DomainError } from '@shared/domain/errors'
import type { EngineContext, EnginePreviewData } from '@shared/domain/engine'
import type { HttpPreview } from '@shared/domain/http'
import { parseContentDisposition } from './content-disposition'
import { cancelBody, mapHttpStatus, requestFollowingRedirects } from './http-client'
import {
  displayUrl,
  parseHttpUrl,
  resolveHttpFilename,
  type ResolvedHttpFilename,
} from './http-url'

interface ContentRange {
  start: number
  end: number
  total: number | null
}

function parseContentLength(headers: Headers): number | null {
  const value = headers.get('content-length')
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseContentRange(value: string | null): ContentRange | null {
  if (!value) return null
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim())
  if (!match?.[1] || !match[2]) return null

  const start = Number(match[1])
  const end = Number(match[2])
  const total = match[3] === '*' ? null : Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (total !== null && !Number.isSafeInteger(total)) ||
    start < 0 ||
    end < start ||
    (total !== null && end >= total)
  ) {
    return null
  }
  return { start, end, total }
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return false
  return contentType === 'text/html' || contentType === 'application/xhtml+xml'
}

function hasUsableHead(response: Response): boolean {
  if (response.status === 405 || response.status === 501) return false
  if (response.status === 400 || response.status === 403) return false
  const contentLength = parseContentLength(response.headers)
  return response.ok && contentLength !== null && contentLength > 0
}

export async function previewHttp(
  urlValue: string,
  ctx: EngineContext,
): Promise<EnginePreviewData> {
  const url = parseHttpUrl(urlValue)

  const head = await requestFollowingRedirects({
    method: 'HEAD',
    url: url.href,
    signal: ctx.signal,
    timeoutMs: 30_000,
  })

  let response = head.response
  let finalUrl = head.finalUrl

  if (!hasUsableHead(response)) {
    await cancelBody(response)
    const ranged = await requestFollowingRedirects({
      method: 'GET',
      url: url.href,
      signal: ctx.signal,
      timeoutMs: 30_000,
      headers: { Range: 'bytes=0-0' },
    })
    response = ranged.response
    finalUrl = ranged.finalUrl
  }

  try {
    if (response.status === 204) {
      throw new DomainError('NOT_FOUND', 'The server did not return a downloadable file.')
    }
    if (!response.ok && response.status !== 206) {
      throw mapHttpStatus(response.status, response.headers.get('retry-after'))
    }

    const contentTypeHeader = response.headers.get('content-type')
    const contentType = contentTypeHeader?.split(';')[0]?.trim().toLowerCase() ?? null
    if (isHtml(contentType)) {
      throw new DomainError(
        'UNSUPPORTED_SOURCE',
        'This link points to a web page, not a downloadable file.',
      )
    }

    const contentRange = parseContentRange(response.headers.get('content-range'))
    const contentLength = contentRange?.total ?? parseContentLength(response.headers)
    const contentEncoding = response.headers.get('content-encoding')?.toLowerCase() ?? null
    const acceptRanges =
      response.status === 206 ||
      contentRange !== null ||
      (response.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes')

    const resolved: ResolvedHttpFilename = resolveHttpFilename({
      url: finalUrl,
      contentDispositionFilename: parseContentDisposition(
        response.headers.get('content-disposition'),
      ),
      contentType,
    })

    const preview: HttpPreview = {
      displayUrl: displayUrl(finalUrl),
      host: finalUrl.host,
      filename: resolved.filename,
      contentType,
      contentLength,
      acceptRanges,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      resumable:
        acceptRanges &&
        contentLength !== null &&
        (contentEncoding === null || contentEncoding === 'identity'),
    }

    return {
      engineId: 'http',
      source: { kind: 'http', url: finalUrl.href, host: finalUrl.host },
      title: resolved.filename,
      subtitle: finalUrl.host,
      thumbnailUrl: null,
      durationSeconds: null,
      data: preview,
    }
  } finally {
    await cancelBody(response)
  }
}

export { parseContentLength, parseContentRange }
