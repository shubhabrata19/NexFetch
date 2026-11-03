import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, Readable, Transform } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { DomainError } from '@shared/domain/errors'
import type {
  DownloadEngine,
  EngineCapabilities,
  EngineContext,
  EngineEvent,
  EngineMatch,
  EnginePreviewData,
  EngineResult,
  EngineRunContext,
  EngineSelection,
  SourceInput,
} from '@shared/domain/engine'
import type { HttpPreview } from '@shared/domain/http'
import type { HttpJobDetails } from '@shared/domain/job'
import type { DownloadJob, DownloadSource } from '@shared/domain/job'
import { httpSelectionSchema } from '@shared/validation/jobs'
import { cancelBody, mapHttpStatus, requestFollowingRedirects } from './http-client'
import { parseContentLength, parseContentRange, previewHttp } from './http-preview'
import { splitHttpFilename } from './http-url'
import { createThrottle } from './rate-limiter'
import {
  readResumeState,
  removeResumeState,
  writeResumeState,
  type ResumeState,
} from './resume-state'

const CAPABILITIES: EngineCapabilities = {
  preview: true,
  selectableFormats: false,
  fileSelection: false,
  audioOnly: false,
  pauseResume: true,
  resumeAfterRestart: true,
  directOutput: false,
  checksumVerification: true,
  seeding: false,
  liveSpeed: true,
  eta: true,
  peerStats: false,
  parallelFragmentDownloads: false,
}

const PART_FILENAME = 'download.part'
const RESUME_FILENAME = 'resume.json'
const DISK_MARGIN_BYTES = 64 * 1024 * 1024

function isHtml(contentType: string | null): boolean {
  return contentType === 'text/html' || contentType === 'application/xhtml+xml'
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

async function freeBytes(path: string): Promise<number | null> {
  try {
    const info = await statfs(path)
    return Number(info.bavail) * Number(info.bsize)
  } catch {
    return null
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function resetPartial(partPath: string, resumePath: string): Promise<void> {
  await rm(partPath, { force: true })
  await removeResumeState(resumePath)
}

function resumeStateMatches(state: ResumeState, selection: { url: string }): boolean {
  return state.url === selection.url
}

interface ProgressStreamOptions {
  initialBytes: number
  totalBytes: number | null
  emit: (event: EngineEvent) => void
}

function createProgressStream(options: ProgressStreamOptions): {
  stream: Transform
  currentBytes: () => number
} {
  let downloadedBytes = options.initialBytes
  let lastEmitAt = 0
  let lastSampleAt = Date.now()
  let lastSampleBytes = options.initialBytes

  const emitProgress = (): void => {
    const now = Date.now()
    const elapsedSeconds = (now - lastSampleAt) / 1000
    const deltaBytes = downloadedBytes - lastSampleBytes
    const bytesPerSecond =
      elapsedSeconds > 0 && deltaBytes > 0 ? Math.round(deltaBytes / elapsedSeconds) : null
    const remaining =
      options.totalBytes !== null ? Math.max(0, options.totalBytes - downloadedBytes) : null

    options.emit({
      type: 'progress',
      downloadedBytes,
      totalBytes: options.totalBytes,
      bytesPerSecond,
      etaSeconds:
        remaining !== null && bytesPerSecond !== null && bytesPerSecond > 0
          ? Math.round(remaining / bytesPerSecond)
          : null,
    })

    lastEmitAt = now
    lastSampleAt = now
    lastSampleBytes = downloadedBytes
  }

  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length
      if (Date.now() - lastEmitAt >= 250) emitProgress()
      callback(null, chunk)
    },
    flush(callback) {
      emitProgress()
      callback()
    },
  })

  return { stream, currentBytes: () => downloadedBytes }
}

export class HttpEngine implements DownloadEngine {
  readonly id = 'http'
  readonly displayName = 'Direct file'
  readonly capabilities = CAPABILITIES

  match(input: SourceInput): EngineMatch | null {
    if (input.kind !== 'text') return null

    let url: URL
    try {
      url = new URL(input.value.trim())
    } catch {
      return null
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        kind: 'unsupported',
        reason: 'Only HTTP and HTTPS links are supported for direct downloads.',
        priority: 10,
      }
    }

    return {
      kind: 'supported',
      source: { kind: 'http', url: url.href, host: url.host },
      priority: 10,
    }
  }

  async preview(source: DownloadSource, ctx: EngineContext): Promise<EnginePreviewData> {
    if (source.kind !== 'http') {
      throw new DomainError('INVALID_REQUEST', 'The source is not an HTTP link.')
    }
    return previewHttp(source.url, ctx)
  }

  resolveSelection(preview: EnginePreviewData, selection: unknown): EngineSelection {
    if (preview.source.kind !== 'http') {
      throw new DomainError('INVALID_REQUEST', 'The preview is not for an HTTP download.')
    }

    const parsed = httpSelectionSchema.safeParse(selection ?? {})
    if (!parsed.success) {
      throw new DomainError('INVALID_REQUEST', 'The HTTP download options are invalid.')
    }

    const data = preview.data as HttpPreview
    const filename = splitHttpFilename(data.filename)
    const checksum = parsed.data.checksum
      ? {
          algorithm: 'sha256' as const,
          expectedHex: parsed.data.checksum.expectedHex.toLowerCase(),
        }
      : null

    return {
      engineId: this.id,
      data: {
        url: preview.source.url,
        displayUrl: data.displayUrl,
        host: data.host,
        filename: filename.filename,
        filenameBase: filename.filenameBase,
        extension: filename.extension,
        contentType: data.contentType,
        contentLength: data.contentLength,
        acceptRanges: data.acceptRanges,
        etag: data.etag,
        lastModified: data.lastModified,
        checksum,
      },
      requiredDependencies: [],
      filenameBase: filename.filenameBase,
      details: {
        engineId: 'http',
        host: data.host,
        displayUrl: data.displayUrl,
        contentType: data.contentType,
        contentLength: data.contentLength,
        acceptRanges: data.acceptRanges,
        resumable: data.resumable,
        etag: data.etag,
        lastModified: data.lastModified,
        checksum: checksum ? { ...checksum, verified: null } : null,
      },
      verification: null,
    }
  }

  async start(job: DownloadJob, ctx: EngineRunContext): Promise<EngineResult> {
    const selection = ctx.selection.data as {
      url?: unknown
      displayUrl?: unknown
      host?: unknown
      filenameBase?: unknown
      extension?: unknown
      contentType?: unknown
      contentLength?: unknown
      acceptRanges?: unknown
      etag?: unknown
      lastModified?: unknown
      checksum?: unknown
    }

    if (
      typeof selection.url !== 'string' ||
      typeof selection.filenameBase !== 'string' ||
      typeof selection.extension !== 'string'
    ) {
      throw new DomainError('INVALID_REQUEST', 'The HTTP download selection is invalid.')
    }

    const partPath = join(ctx.workspaceDir, PART_FILENAME)
    const resumePath = join(ctx.workspaceDir, RESUME_FILENAME)
    const checksum =
      selection.checksum &&
      typeof selection.checksum === 'object' &&
      'expectedHex' in selection.checksum &&
      typeof selection.checksum.expectedHex === 'string'
        ? selection.checksum.expectedHex.toLowerCase()
        : null

    ctx.logger.info('http_download_started', {
      jobId: job.id,
      host: typeof selection.host === 'string' ? selection.host : null,
    })
    ctx.emit({ type: 'phase', phase: 'downloading' })

    let state = await readResumeState(resumePath)
    let offset = await fileSize(partPath)

    if (state && !resumeStateMatches(state, { url: selection.url })) {
      await resetPartial(partPath, resumePath)
      state = null
      offset = 0
    }
    if (offset > 0 && !state) {
      // A partial file without a validator cannot be resumed safely.
      await resetPartial(partPath, resumePath)
      offset = 0
    }

    const alreadyComplete =
      state !== null && state.totalBytes !== null && offset === state.totalBytes && offset > 0

    let downloadedBytes = offset
    let totalBytes =
      state?.totalBytes ??
      (typeof selection.contentLength === 'number' ? selection.contentLength : null)

    ctx.emit({
      type: 'progress',
      downloadedBytes,
      totalBytes,
      bytesPerSecond: null,
      etaSeconds: null,
    })

    if (!alreadyComplete) {
      const transferred = await this.transfer({
        selection: {
          url: selection.url,
          contentType: selection.contentType,
          contentLength: selection.contentLength,
          acceptRanges: selection.acceptRanges,
          etag: selection.etag,
          lastModified: selection.lastModified,
        },
        partPath,
        resumePath,
        initialOffset: offset,
        initialState: state,
        ctx,
      })
      downloadedBytes = transferred.downloadedBytes
      totalBytes = transferred.totalBytes
    }

    if (checksum) {
      ctx.emit({ type: 'phase', phase: 'verifying' })
      let actual: string
      try {
        actual = await sha256File(partPath)
      } catch {
        throw new DomainError('VERIFICATION_FAILED', 'The downloaded file could not be read.')
      }

      if (actual.toLowerCase() !== checksum) {
        await resetPartial(partPath, resumePath)
        ctx.emit({
          type: 'details',
          patch: {
            engineId: 'http',
            checksum: {
              algorithm: 'sha256',
              expectedHex: checksum,
              verified: false,
            },
          } as Partial<HttpJobDetails>,
        })
        throw new DomainError(
          'CHECKSUM_MISMATCH',
          'The downloaded file did not match the expected SHA-256 checksum.',
        )
      }

      ctx.emit({
        type: 'details',
        patch: {
          engineId: 'http',
          checksum: {
            algorithm: 'sha256',
            expectedHex: checksum,
            verified: true,
          },
        } as Partial<HttpJobDetails>,
      })
    }

    const finalPath = join(ctx.workspaceDir, `${selection.filenameBase}${selection.extension}`)
    await rm(finalPath, { force: true })
    await rename(partPath, finalPath)
    await removeResumeState(resumePath)

    return {
      output: { kind: 'file', path: finalPath },
      totalBytes: totalBytes ?? downloadedBytes,
    }
  }

  private async transfer(options: {
    selection: {
      url: string
      contentType?: unknown
      contentLength?: unknown
      acceptRanges?: unknown
      etag?: unknown
      lastModified?: unknown
    }
    partPath: string
    resumePath: string
    initialOffset: number
    initialState: ResumeState | null
    ctx: EngineRunContext
  }): Promise<{ downloadedBytes: number; totalBytes: number | null }> {
    let offset = options.initialOffset
    let state = options.initialState

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers: Record<string, string> = {}
      if (offset > 0) {
        headers.Range = `bytes=${offset}-`
        const validator = state?.etag ?? state?.lastModified ?? null
        if (validator) headers['If-Range'] = validator
      }

      const request = await requestFollowingRedirects({
        method: 'GET',
        url: options.selection.url,
        signal: options.ctx.signal,
        headers,
      })
      const response = request.response

      if (response.status === 416 && offset > 0) {
        await cancelBody(response)
        if (
          state?.totalBytes !== null &&
          state?.totalBytes !== undefined &&
          offset === state.totalBytes
        ) {
          return { downloadedBytes: offset, totalBytes: offset }
        }
        await resetPartial(options.partPath, options.resumePath)
        offset = 0
        state = null
        continue
      }

      if (!response.ok) {
        await cancelBody(response)
        throw mapHttpStatus(response.status, response.headers.get('retry-after'))
      }

      const contentType =
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null
      if (isHtml(contentType)) {
        await cancelBody(response)
        throw new DomainError(
          'UNSUPPORTED_SOURCE',
          'This link points to a web page, not a downloadable file.',
        )
      }

      const contentRange = parseContentRange(response.headers.get('content-range'))
      if (offset > 0) {
        const validResume =
          response.status === 206 && contentRange !== null && contentRange.start === offset
        const totalChanged =
          state?.totalBytes !== null &&
          state?.totalBytes !== undefined &&
          contentRange?.total !== null &&
          contentRange?.total !== undefined &&
          state.totalBytes !== contentRange.total

        if (!validResume || totalChanged) {
          // The server ignored the range or the file changed. Restart cleanly
          // rather than appending bytes to the wrong file.
          await cancelBody(response)
          await resetPartial(options.partPath, options.resumePath)
          offset = 0
          state = null
          continue
        }
      }

      const contentLength = parseContentLength(response.headers)
      const totalBytes =
        contentRange?.total ??
        (response.status === 200 ? contentLength : null) ??
        state?.totalBytes ??
        (typeof options.selection.contentLength === 'number'
          ? options.selection.contentLength
          : null)
      const contentEncoding = response.headers.get('content-encoding')?.toLowerCase() ?? null
      const canResume =
        Boolean(options.selection.acceptRanges) &&
        totalBytes !== null &&
        (contentEncoding === null || contentEncoding === 'identity')

      if (canResume) {
        const nextState: ResumeState = {
          version: 1,
          url: options.selection.url,
          etag:
            response.headers.get('etag') ??
            (typeof options.selection.etag === 'string' ? options.selection.etag : null),
          lastModified:
            response.headers.get('last-modified') ??
            (typeof options.selection.lastModified === 'string'
              ? options.selection.lastModified
              : null),
          totalBytes,
          contentType,
          updatedAt: new Date().toISOString(),
        }
        await writeResumeState(options.resumePath, nextState)
      } else {
        await removeResumeState(options.resumePath)
      }

      const free = await freeBytes(options.ctx.workspaceDir)
      if (free !== null && totalBytes !== null && totalBytes - offset + DISK_MARGIN_BYTES > free) {
        await cancelBody(response)
        throw new DomainError(
          'DISK_FULL',
          'There is not enough free space for this download. Free some space and retry.',
          true,
        )
      }

      const body = response.body
      if (!body) {
        await cancelBody(response)
        throw new DomainError('NETWORK_ERROR', 'The server returned an empty response.', true)
      }

      const progress = createProgressStream({
        initialBytes: offset,
        totalBytes,
        emit: options.ctx.emit,
      })
      const throttle =
        createThrottle(options.ctx.maxDownloadRateBytesPerSecond, options.ctx.signal) ??
        new PassThrough()
      const writeStream = createWriteStream(options.partPath, {
        flags: offset > 0 ? 'a' : 'w',
      })
      const source = Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>)

      try {
        await pipeline(source, progress.stream, throttle, writeStream, {
          signal: options.ctx.signal,
        })
      } catch (error) {
        if (options.ctx.signal.aborted) {
          await this.handleAbort(options.partPath, options.resumePath, options.ctx)
          throw new DomainError('CANCELLED', 'Download cancelled.')
        }
        if ((await fileSize(options.partPath)) === 0) {
          await resetPartial(options.partPath, options.resumePath)
        }
        if (error instanceof DomainError) throw error
        throw new DomainError(
          'NETWORK_ERROR',
          'The connection ended before the file finished. Retry to resume.',
          true,
        )
      }

      const downloadedBytes = progress.currentBytes()
      if (totalBytes !== null && downloadedBytes < totalBytes) {
        throw new DomainError(
          'NETWORK_ERROR',
          'The connection ended before the file finished. Retry to resume.',
          true,
        )
      }

      return { downloadedBytes, totalBytes }
    }

    throw new DomainError(
      'NETWORK_ERROR',
      'The server did not honor the resume request. Retry to start again.',
      true,
    )
  }

  private async handleAbort(
    partPath: string,
    resumePath: string,
    ctx: EngineRunContext,
  ): Promise<void> {
    const reason = ctx.signal.reason
    if (reason === 'cancel') {
      await resetPartial(partPath, resumePath)
      return
    }
    // Pause and shutdown preserve the partial file when a validator exists.
    if ((await fileSize(partPath)) === 0) {
      await resetPartial(partPath, resumePath)
    }
  }
}
