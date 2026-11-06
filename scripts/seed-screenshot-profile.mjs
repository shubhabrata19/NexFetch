#!/usr/bin/env node
/**
 * Creates an isolated Electron user-data directory populated with realistic
 * synthetic jobs for README screenshots. Never touches the real profile.
 *
 * Usage: node scripts/seed-screenshot-profile.mjs <profile-directory>
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const directory = process.argv[2]
if (!directory) {
  console.error('Usage: node scripts/seed-screenshot-profile.mjs <profile-directory>')
  process.exit(1)
}

mkdirSync(directory, { recursive: true })
const databasePath = join(directory, 'nexfetch.sqlite')
const downloads = String.raw`C:\Users\Demo\Downloads\NexFetch`
const now = Date.now()
const iso = (offsetMinutes) => new Date(now - offsetMinutes * 60_000).toISOString()

const database = new DatabaseSync(databasePath)
database.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    engine_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    destination TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    scheduled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    downloaded_bytes INTEGER,
    total_bytes INTEGER,
    percent REAL,
    bytes_per_second INTEGER,
    eta_seconds INTEGER,
    error_code TEXT,
    payload TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs (status, created_at);
  CREATE INDEX IF NOT EXISTS jobs_created ON jobs (created_at DESC);
  CREATE INDEX IF NOT EXISTS jobs_scheduled ON jobs (scheduled_at) WHERE scheduled_at IS NOT NULL;

  CREATE TABLE IF NOT EXISTS job_attempts (
    job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    PRIMARY KEY (job_id, attempt),
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  PRAGMA user_version = 1;
`)

const settings = {
  downloadDirectory: downloads,
  maxConcurrentDownloads: 3,
  concurrentFragments: 8,
  maxDownloadRateBytesPerSecond: 5 * 1024 * 1024,
  maxUploadRateBytesPerSecond: 512 * 1024,
  torrentConnectionProfile: 'high',
  torrentNATMapping: true,
  torrentSeedAfterComplete: false,
  resumeIncompleteDownloads: true,
  theme: 'dark',
}

database
  .prepare('INSERT INTO settings (id, payload, updated_at) VALUES (1, ?, ?)')
  .run(JSON.stringify(settings), iso(5))

const insertJob = database.prepare(`
  INSERT INTO jobs (
    id, revision, engine_id, source_kind, title, status, destination, attempt,
    scheduled_at, created_at, updated_at, started_at, completed_at,
    downloaded_bytes, total_bytes, percent, bytes_per_second, eta_seconds,
    error_code, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertAttempt = database.prepare(`
  INSERT INTO job_attempts (job_id, attempt, status, started_at, completed_at, error_code)
  VALUES (?, ?, ?, ?, ?, ?)
`)

function addJob(job) {
  const record = {
    revision: 7,
    attempt: 1,
    error: null,
    scheduledAt: null,
    workspaceDirectory: null,
    selection: null,
    ...job,
  }

  insertJob.run(
    record.id,
    record.revision,
    record.engineId,
    record.source.kind,
    record.title,
    record.status,
    record.destination,
    record.attempt,
    record.scheduledAt,
    record.createdAt,
    record.updatedAt,
    record.startedAt ?? null,
    record.completedAt ?? null,
    record.progress.downloadedBytes ?? null,
    record.progress.totalBytes ?? null,
    record.progress.percent ?? null,
    record.progress.bytesPerSecond ?? null,
    record.progress.etaSeconds ?? null,
    record.error?.code ?? null,
    JSON.stringify(record),
  )
  insertAttempt.run(
    record.id,
    record.attempt,
    record.status,
    record.startedAt ?? null,
    record.completedAt ?? null,
    record.error?.code ?? null,
  )
}

const youtubeId = 'aqz-KE-bpKQ'
addJob({
  id: randomUUID(),
  engineId: 'youtube',
  source: {
    kind: 'youtube',
    videoId: youtubeId,
    canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
  },
  title: 'Big Buck Bunny — 4K',
  status: 'completed',
  progress: {
    downloadedBytes: 276_000_000,
    totalBytes: 276_000_000,
    percent: 100,
    bytesPerSecond: null,
    etaSeconds: null,
  },
  destination: downloads,
  output: {
    directory: downloads,
    files: [{ path: String.raw`${downloads}\Big Buck Bunny — 4K.mkv`, bytes: 276_000_000 }],
  },
  details: {
    engineId: 'youtube',
    videoId: youtubeId,
    channel: 'Blender',
    thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    selectedVideo: {
      formatId: '315',
      label: '2160p · VP9',
      ext: 'webm',
      sizeBytes: 270_000_000,
    },
    selectedAudio: {
      formatId: '251',
      label: 'Opus · 160 kbps',
      ext: 'webm',
      sizeBytes: 6_000_000,
    },
    container: 'mkv',
  },
  createdAt: iso(150),
  updatedAt: iso(112),
  startedAt: iso(148),
  completedAt: iso(112),
})

addJob({
  id: randomUUID(),
  engineId: 'http',
  source: {
    kind: 'http',
    url: 'https://downloads.example.com/sample-dataset.zip',
    host: 'downloads.example.com',
  },
  title: 'sample-dataset.zip',
  status: 'completed',
  progress: {
    downloadedBytes: 734_003_200,
    totalBytes: 734_003_200,
    percent: 100,
    bytesPerSecond: null,
    etaSeconds: null,
  },
  destination: downloads,
  output: {
    directory: downloads,
    files: [{ path: String.raw`${downloads}\sample-dataset.zip`, bytes: 734_003_200 }],
  },
  details: {
    engineId: 'http',
    host: 'downloads.example.com',
    displayUrl: 'downloads.example.com/sample-dataset.zip',
    contentType: 'application/zip',
    contentLength: 734_003_200,
    acceptRanges: true,
    resumable: true,
    etag: '"sample-8f3c"',
    lastModified: 'Thu, 05 Nov 2026 08:00:00 GMT',
    checksum: {
      algorithm: 'sha256',
      expectedHex: 'a'.repeat(64),
      verified: true,
    },
  },
  createdAt: iso(1_560),
  updatedAt: iso(1_500),
  startedAt: iso(1_555),
  completedAt: iso(1_500),
})

const infoHash = 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'
addJob({
  id: randomUUID(),
  engineId: 'torrent',
  source: {
    kind: 'torrent',
    infoHash,
    hashVersion: 1,
    sourceKind: 'infohash',
    displayName: 'Big Buck Bunny (2008)',
  },
  title: 'Big Buck Bunny (2008)',
  status: 'completed',
  progress: {
    downloadedBytes: 276_000_000,
    totalBytes: 276_000_000,
    percent: 100,
    bytesPerSecond: null,
    etaSeconds: null,
  },
  destination: String.raw`${downloads}\Big Buck Bunny`,
  output: {
    directory: String.raw`${downloads}\Big Buck Bunny`,
    files: [
      {
        path: String.raw`${downloads}\Big Buck Bunny\Big.Buck.Bunny.2160p.mkv`,
        bytes: 276_000_000,
      },
    ],
  },
  details: {
    engineId: 'torrent',
    infoHash,
    hashVersion: 1,
    isPrivate: false,
    files: [
      {
        index: 0,
        path: 'Big Buck Bunny/Big.Buck.Bunny.2160p.mkv',
        name: 'Big.Buck.Bunny.2160p.mkv',
        sizeBytes: 276_000_000,
        selected: true,
        executable: false,
        downloadedBytes: 276_000_000,
      },
    ],
    trackers: [
      {
        url: 'https://tracker.example.com/announce',
        tier: 0,
        status: 'working',
        message: null,
        seeds: 24,
        peers: 7,
        nextAnnounceSeconds: 1_800,
      },
    ],
    peers: [
      {
        address: '203.0.113.24:51413',
        client: 'qBittorrent 5.0',
        progress: 0.87,
        downloadRateBytesPerSecond: 0,
        uploadRateBytesPerSecond: 0,
        seed: true,
        flags: 'seed',
      },
    ],
    seedsConnected: 2,
    seedsAvailable: 24,
    peersConnected: 3,
    peersAvailable: 7,
    downloadRateBytesPerSecond: 0,
    uploadRateBytesPerSecond: 0,
    uploadedBytes: 32_000_000,
    ratio: 0.12,
    downloadLimitBytesPerSecond: null,
    uploadLimitBytesPerSecond: 512 * 1024,
    maxConnections: 100,
    seedAfterComplete: false,
    discovery: {
      dht: true,
      pex: true,
      lsd: true,
      natMapping: true,
      natStatus: 'mapped',
      listenPort: 51_413,
      incomingConnections: true,
      dhtNodes: 340,
      webSeeds: 'disabled',
    },
  },
  createdAt: iso(4_320),
  updatedAt: iso(4_180),
  startedAt: iso(4_310),
  completedAt: iso(4_180),
})

addJob({
  id: randomUUID(),
  engineId: 'http',
  source: {
    kind: 'http',
    url: 'https://downloads.example.com/release-notes.pdf',
    host: 'downloads.example.com',
  },
  title: 'release-notes.pdf',
  status: 'failed',
  progress: {
    downloadedBytes: 1_840_000,
    totalBytes: 4_200_000,
    percent: 43.8,
    bytesPerSecond: null,
    etaSeconds: null,
  },
  destination: downloads,
  output: null,
  details: {
    engineId: 'http',
    host: 'downloads.example.com',
    displayUrl: 'downloads.example.com/release-notes.pdf',
    contentType: 'application/pdf',
    contentLength: 4_200_000,
    acceptRanges: true,
    resumable: true,
    etag: '"sample-release"',
    lastModified: 'Wed, 04 Nov 2026 08:00:00 GMT',
    checksum: null,
  },
  error: {
    code: 'NETWORK_ERROR',
    message: 'The connection ended before the file finished. Retry to resume.',
    retryable: true,
    diagnosticId: randomUUID(),
  },
  createdAt: iso(48),
  updatedAt: iso(47),
  startedAt: iso(48),
  completedAt: iso(47),
})

database.close()
console.log(`Seeded screenshot profile at ${databasePath}`)
