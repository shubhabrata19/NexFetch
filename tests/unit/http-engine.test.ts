import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomainError } from '@shared/domain/errors'
import type { EngineRunContext } from '@shared/domain/engine'
import type { HttpResolvedSelection } from '@shared/domain/http'
import type { DownloadJob } from '@shared/domain/job'
import { HttpEngine } from '@main/engines/http/http-engine'

const temporaryDirectories: string[] = []
const servers: Array<{ close: () => Promise<void> }> = []

function createWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nexfetch-http-'))
  temporaryDirectories.push(directory)
  return directory
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler)
  servers.push({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind a port')
  return `http://127.0.0.1:${address.port}`
}

function logger(): {
  info: () => void
  warn: () => void
  error: () => void
} {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}

function fakeJob(): DownloadJob {
  const now = new Date().toISOString()
  return {
    id: 'http-job',
    revision: 1,
    engineId: 'http',
    source: { kind: 'http', url: 'http://127.0.0.1/file', host: '127.0.0.1' },
    title: 'file',
    status: 'queued',
    progress: {
      downloadedBytes: null,
      totalBytes: null,
      percent: null,
      bytesPerSecond: null,
      etaSeconds: null,
    },
    destination: 'C:\\downloads',
    output: null,
    details: null,
    error: null,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    scheduledAt: null,
  }
}

async function createSelection(url: string, checksumExpectedHex?: string) {
  const engine = new HttpEngine()
  const preview = await engine.preview(
    { kind: 'http', url, host: new URL(url).host },
    {
      signal: new AbortController().signal,
      logger: logger(),
      dependencies: { resolve: () => null },
    },
  )
  return {
    engine,
    preview,
    selection: engine.resolveSelection(
      preview,
      checksumExpectedHex
        ? { checksum: { algorithm: 'sha256', expectedHex: checksumExpectedHex } }
        : {},
    ),
  }
}

function runContext(options: {
  selection: ReturnType<HttpEngine['resolveSelection']>
  workspaceDir: string
  signal: AbortSignal
  emit?: (event: unknown) => void
  rate?: number
}): EngineRunContext {
  return {
    job: fakeJob(),
    selection: options.selection,
    workspaceDir: options.workspaceDir,
    resume: false,
    concurrentFragments: 4,
    maxDownloadRateBytesPerSecond: options.rate ?? 0,
    signal: options.signal,
    logger: logger(),
    dependencies: { resolve: () => null },
    emit: (event) => options.emit?.(event),
  } as EngineRunContext
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    if (server) await server.close()
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('HTTP engine', () => {
  it('downloads a file with a known length and reports completion', async () => {
    const body = Buffer.from('hello from the local test server')
    const url = await startServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': body.length,
        'Accept-Ranges': 'bytes',
      })
      response.end(body)
    })

    const workspace = createWorkspace()
    const { engine, selection } = await createSelection(`${url}/file`)
    const events: Array<{ type?: string }> = []
    const result = await engine.start(
      fakeJob(),
      runContext({
        selection,
        workspaceDir: workspace,
        signal: new AbortController().signal,
        emit: (event) => events.push(event as { type?: string }),
      }),
    )

    expect(await readFile(result.output.path)).toEqual(body)
    expect(result.output.path.endsWith('file.txt')).toBe(true)
    expect(events.some((event) => event.type === 'progress')).toBe(true)
    expect(events.some((event) => event.type === 'phase')).toBe(true)
  })

  it('resumes from a partial file when the server honors Range', async () => {
    const body = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')
    const url = await startServer((request, response) => {
      const range = request.headers.range
      if (range) {
        const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0)
        const slice = body.subarray(start)
        response.writeHead(206, {
          'Content-Type': 'text/plain',
          'Content-Length': slice.length,
          'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`,
          'Accept-Ranges': 'bytes',
          ETag: '"v1"',
        })
        response.end(slice)
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': body.length,
        'Accept-Ranges': 'bytes',
        ETag: '"v1"',
      })
      response.end(body)
    })

    const workspace = createWorkspace()
    const { engine, selection, preview } = await createSelection(url)
    const data = selection.data as HttpResolvedSelection
    const partPath = join(workspace, 'download.part')
    const resumePath = join(workspace, 'resume.json')
    writeFileSync(partPath, body.subarray(0, 10))
    writeFileSync(
      resumePath,
      JSON.stringify({
        version: 1,
        url: data.url,
        etag: '"v1"',
        lastModified: null,
        totalBytes: body.length,
        contentType: 'text/plain',
        updatedAt: new Date().toISOString(),
      }),
    )

    expect(preview.data).toMatchObject({ contentLength: body.length, acceptRanges: true })
    const result = await engine.start(
      fakeJob(),
      runContext({
        selection,
        workspaceDir: workspace,
        signal: new AbortController().signal,
      }),
    )

    expect(await readFile(result.output.path)).toEqual(body)
  })

  it('restarts safely when the server ignores a Range request', async () => {
    const body = Buffer.from('the server ignores ranges and returns the whole file')
    let requests = 0
    const url = await startServer((_request, response) => {
      requests += 1
      response.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': body.length,
        'Accept-Ranges': 'bytes',
      })
      response.end(body)
    })

    const workspace = createWorkspace()
    const { engine, selection } = await createSelection(url)
    const data = selection.data as HttpResolvedSelection
    writeFileSync(join(workspace, 'download.part'), body.subarray(0, 10))
    writeFileSync(
      join(workspace, 'resume.json'),
      JSON.stringify({
        version: 1,
        url: data.url,
        etag: null,
        lastModified: null,
        totalBytes: body.length,
        contentType: 'text/plain',
        updatedAt: new Date().toISOString(),
      }),
    )

    const result = await engine.start(
      fakeJob(),
      runContext({
        selection,
        workspaceDir: workspace,
        signal: new AbortController().signal,
      }),
    )

    expect(await readFile(result.output.path)).toEqual(body)
    expect(requests).toBe(3)
  })

  it('uses the Content-Disposition filename and sanitizes it', async () => {
    const body = Buffer.from('%PDF-1.4')
    const url = await startServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': body.length,
        'Content-Disposition': 'attachment; filename="../quarterly report.pdf"',
      })
      response.end(body)
    })

    const workspace = createWorkspace()
    const { engine, selection, preview } = await createSelection(url)
    expect(preview.data).toMatchObject({ filename: 'quarterly report.pdf' })
    expect(selection.filenameBase).toBe('quarterly report')
    expect(selection.data).toMatchObject({ extension: '.pdf' })

    const result = await engine.start(
      fakeJob(),
      runContext({
        selection,
        workspaceDir: workspace,
        signal: new AbortController().signal,
      }),
    )

    expect(result.output.path.endsWith('quarterly report.pdf')).toBe(true)
    expect(await readFile(result.output.path)).toEqual(body)
  })

  it('verifies a matching SHA-256 checksum', async () => {
    const body = Buffer.from('checksum me')
    const expected = createHash('sha256').update(body).digest('hex')
    const url = await startServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length,
      })
      response.end(body)
    })

    const workspace = createWorkspace()
    const { engine, selection } = await createSelection(url, expected)
    const events: Array<{ type?: string; phase?: string }> = []
    const result = await engine.start(
      fakeJob(),
      runContext({
        selection,
        workspaceDir: workspace,
        signal: new AbortController().signal,
        emit: (event) => events.push(event as { type?: string; phase?: string }),
      }),
    )

    expect(await readFile(result.output.path)).toEqual(body)
    expect(events.some((event) => event.type === 'phase' && event.phase === 'verifying')).toBe(true)
  })

  it('fails and removes the partial file on a checksum mismatch', async () => {
    const body = Buffer.from('wrong bytes')
    const url = await startServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length,
      })
      response.end(body)
    })

    const workspace = createWorkspace()
    const { engine, selection } = await createSelection(url, '0'.repeat(64))
    await expect(
      engine.start(
        fakeJob(),
        runContext({
          selection,
          workspaceDir: workspace,
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
  })

  it('rejects an HTML page instead of downloading it as a file', async () => {
    const url = await startServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': 20,
      })
      response.end('<html>not a file</html>')
    })

    const engine = new HttpEngine()
    await expect(
      engine.preview(
        { kind: 'http', url, host: new URL(url).host },
        {
          signal: new AbortController().signal,
          logger: logger(),
          dependencies: { resolve: () => null },
        },
      ),
    ).rejects.toBeInstanceOf(DomainError)
  })
})
