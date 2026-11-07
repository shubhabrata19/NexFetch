import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DownloadJob } from '@shared/domain/job'
import type { TorrentFileEntry, TorrentJobDetails } from '@shared/domain/torrent'
import { FileService } from '@main/services/file-service'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nexfetch-delete-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function torrentDetails(
  files: Array<Partial<TorrentFileEntry> & { path: string }>,
): TorrentJobDetails {
  return {
    engineId: 'torrent',
    infoHash: 'a'.repeat(40),
    hashVersion: 1,
    isPrivate: false,
    files: files.map((file, index) => ({
      index,
      path: file.path,
      name: file.name ?? file.path.split('/').pop() ?? file.path,
      sizeBytes: file.sizeBytes ?? 5,
      selected: file.selected ?? true,
      executable: false,
      downloadedBytes: null,
    })),
    trackers: [],
    peers: [],
    seedsConnected: null,
    seedsAvailable: null,
    peersConnected: null,
    peersAvailable: null,
    downloadRateBytesPerSecond: null,
    uploadRateBytesPerSecond: null,
    uploadedBytes: null,
    ratio: null,
    downloadLimitBytesPerSecond: null,
    uploadLimitBytesPerSecond: null,
    maxConnections: null,
    seedAfterComplete: false,
    discovery: {
      dht: true,
      pex: true,
      lsd: true,
      natMapping: false,
      natStatus: null,
      listenPort: null,
      incomingConnections: false,
      dhtNodes: null,
      webSeeds: 'disabled',
    },
  }
}

function torrentJob(
  destination: string,
  details: TorrentJobDetails,
  overrides: Partial<DownloadJob> = {},
): DownloadJob {
  const now = new Date().toISOString()
  return {
    id: 'job-1',
    revision: 1,
    engineId: 'torrent',
    source: {
      kind: 'torrent',
      infoHash: 'a'.repeat(40),
      hashVersion: 1,
      sourceKind: 'infohash',
      displayName: 'Test torrent',
    },
    title: 'Test torrent',
    status: 'completed',
    progress: {
      downloadedBytes: 10,
      totalBytes: 10,
      percent: 100,
      bytesPerSecond: null,
      etaSeconds: null,
    },
    destination,
    output: null,
    details,
    error: null,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
    scheduledAt: null,
    ...overrides,
  }
}

describe('FileService.deleteTorrentFiles', () => {
  it('deletes selected multi-file payloads, prunes empty folders, and keeps neighbours', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const downloads = join(root, 'downloads')
    const destination = join(downloads, 'Sintel')
    await mkdir(join(destination, 'sub'), { recursive: true })
    await writeFile(join(destination, 'a.mkv'), 'video')
    await writeFile(join(destination, 'sub', 'b.srt'), 'subs')
    await writeFile(join(downloads, 'other.txt'), 'keep me')

    const job = torrentJob(
      destination,
      torrentDetails([{ path: 'Sintel/a.mkv' }, { path: 'Sintel/sub/b.srt' }]),
    )

    const result = await service.deleteTorrentFiles(job)

    expect(result).toEqual({ deletedFiles: 2, deletedBytes: 9, failures: [] })
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(join(downloads, 'other.txt'))).toBe(true)
    expect(existsSync(downloads)).toBe(true)
  })

  it('deletes a single-file torrent payload and keeps the destination folder', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const destination = join(root, 'downloads', 'Movie')
    await mkdir(destination, { recursive: true })
    const payload = join(destination, 'movie.mkv')
    await writeFile(payload, 'video')

    const job = torrentJob(destination, torrentDetails([{ path: 'movie.mkv' }]), {
      output: { directory: destination, files: [{ path: payload, bytes: 5 }] },
    })

    const result = await service.deleteTorrentFiles(job)

    expect(result.deletedFiles).toBe(1)
    expect(existsSync(payload)).toBe(false)
    // The destination may be a user-chosen folder, so it is never removed.
    expect(existsSync(destination)).toBe(true)
  })

  it('never deletes payload entries that escape the save root', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const downloads = join(root, 'downloads')
    const destination = join(downloads, 'Sintel')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'a.mkv'), 'video')
    const outside = join(root, 'evil.txt')
    await writeFile(outside, 'do not delete')

    const job = torrentJob(
      destination,
      torrentDetails([{ path: 'Sintel/a.mkv' }, { path: '../evil.txt' }]),
    )

    const result = await service.deleteTorrentFiles(job)

    expect(result.deletedFiles).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(existsSync(outside)).toBe(true)
  })

  it('leaves unselected files alone', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const downloads = join(root, 'downloads')
    const destination = join(downloads, 'Sintel')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'a.mkv'), 'video')
    await writeFile(join(destination, 'skipped.mkv'), 'other')

    const job = torrentJob(
      destination,
      torrentDetails([
        { path: 'Sintel/a.mkv', selected: true },
        { path: 'Sintel/skipped.mkv', selected: false },
      ]),
      { status: 'paused', output: null },
    )
    // The payload must look newer than the job start for the fallback path.
    const now = new Date()
    await utimes(join(destination, 'a.mkv'), now, now)

    const result = await service.deleteTorrentFiles(job)

    expect(result.deletedFiles).toBe(1)
    expect(existsSync(join(destination, 'a.mkv'))).toBe(false)
    expect(existsSync(join(destination, 'skipped.mkv'))).toBe(true)
  })

  it('does not delete pre-existing files that merely share a name with the payload', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const destination = join(root, 'downloads')
    await mkdir(destination, { recursive: true })
    const payload = join(destination, 'movie.mkv')
    await writeFile(payload, 'user file')
    const old = new Date('2020-01-01T00:00:00.000Z')
    await utimes(payload, old, old)

    const job = torrentJob(destination, torrentDetails([{ path: 'movie.mkv' }]), {
      status: 'paused',
      startedAt: new Date().toISOString(),
      output: null,
    })

    const result = await service.deleteTorrentFiles(job)

    expect(result.deletedFiles).toBe(0)
    expect(result.failures).toEqual([])
    expect(existsSync(payload)).toBe(true)
  })

  it('is idempotent when the payload is already gone', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const destination = join(root, 'downloads', 'Sintel')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'a.mkv'), 'video')

    const job = torrentJob(destination, torrentDetails([{ path: 'a.mkv' }]))

    const first = await service.deleteTorrentFiles(job)
    const second = await service.deleteTorrentFiles(job)

    expect(first.deletedFiles).toBe(1)
    expect(second).toEqual({ deletedFiles: 0, deletedBytes: 0, failures: [] })
  })

  it('ignores jobs that are not torrents', async () => {
    const service = new FileService()
    const root = temporaryDirectory()
    const job = torrentJob(join(root, 'downloads'), torrentDetails([{ path: 'a.mkv' }]), {
      engineId: 'http',
      details: {
        engineId: 'http',
        host: 'example.com',
        displayUrl: 'example.com/file',
        contentType: null,
        contentLength: null,
        acceptRanges: false,
        resumable: false,
        etag: null,
        lastModified: null,
        checksum: null,
      },
    })

    await expect(service.deleteTorrentFiles(job)).resolves.toEqual({
      deletedFiles: 0,
      deletedBytes: 0,
      failures: [],
    })
  })
})
