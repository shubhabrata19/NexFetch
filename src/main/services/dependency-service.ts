import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { delimiter, join } from 'node:path'
import type {
  DependencyId,
  DependencyInfo,
  DependencySource,
  DependencyStatus,
} from '@shared/ipc/contracts'

interface DependencyLogger {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

interface PinnedArchive {
  name: string
  url: string
  sha256: string
  member: string
}

interface PinnedBinary {
  file: string
  version?: string | null
  sha256: string | null
  source?: string
  license?: string
  note?: string
  archive?: PinnedArchive
}

interface BinaryManifest {
  schemaVersion: number
  platforms: Record<string, Partial<Record<DependencyId, PinnedBinary>>>
}

interface DependencyServiceOptions {
  bundledRoot: string
  allowEnvOverrides: boolean
  logger?: DependencyLogger
}

interface ResolvedExecutable {
  path: string
  source: DependencySource
}

interface IntegrityResult {
  ok: boolean
  reason: string | null
}

const BINARY_NAMES: Record<DependencyId, string> = {
  'yt-dlp': 'yt-dlp',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  'torrent-helper': 'nexfetch-torrent-helper',
}

const ENV_KEYS: Record<DependencyId, string> = {
  'yt-dlp': 'NXF_YTDLP_PATH',
  ffmpeg: 'NXF_FFMPEG_PATH',
  ffprobe: 'NXF_FFPROBE_PATH',
  'torrent-helper': 'NXF_TORRENT_HELPER_PATH',
}

const VERSION_ARGS: Record<DependencyId, string[]> = {
  'yt-dlp': ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  'torrent-helper': [],
}

const MANIFEST_FILENAME = 'binaries.manifest.json'

function executableName(id: DependencyId): string {
  return process.platform === 'win32' ? `${BINARY_NAMES[id]}.exe` : BINARY_NAMES[id]
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class DependencyService {
  private readonly manifest: BinaryManifest | null
  private readonly platformArtifacts: Partial<Record<DependencyId, PinnedBinary>>
  private readonly integrity = new Map<string, IntegrityResult>()
  private verification: Promise<void> | null = null

  constructor(private readonly options: DependencyServiceOptions) {
    this.manifest = this.loadManifest()
    this.platformArtifacts = this.manifest?.platforms[`${process.platform}-${process.arch}`] ?? {}
  }

  /**
   * Verifies every pinned bundled executable against the SHA-256 values in the
   * tracked manifest. Failures are remembered so `resolveExecutable` can refuse
   * to run a modified binary. Called once at startup before the window opens.
   */
  verifyIntegrity(): Promise<void> {
    this.verification ??= this.runIntegrityVerification()
    return this.verification
  }

  /**
   * Re-hashes bundled binaries after the user explicitly asks the app to
   * recheck dependencies (for example after running the fetch script).
   */
  async recheckIntegrity(): Promise<void> {
    this.verification = null
    this.integrity.clear()
    await this.verifyIntegrity()
  }

  resolve(id: DependencyId): { path: string; version: string | null } | null {
    const resolved = this.resolveExecutable(id)
    return resolved ? { path: resolved.path, version: null } : null
  }

  async getStatus(): Promise<DependencyStatus> {
    const [ytDlp, ffmpeg, ffprobe, torrentHelper] = await Promise.all([
      this.check('yt-dlp'),
      this.check('ffmpeg'),
      this.check('ffprobe'),
      this.check('torrent-helper'),
    ])
    return { ytDlp, ffmpeg, ffprobe, torrentHelper }
  }

  resolveExecutable(id: DependencyId): ResolvedExecutable | null {
    const envOverride = this.options.allowEnvOverrides ? process.env[ENV_KEYS[id]] : undefined
    const pinned = this.platformArtifacts[id]
    const bundledPath = this.bundledPath(id)

    // A pinned binary that no longer matches the manifest must never run, even
    // if another copy exists on PATH. Development overrides remain explicit.
    if (pinned?.sha256 && isExecutableFile(bundledPath) && !this.integrity.get(bundledPath)?.ok) {
      if (!envOverride) {
        this.logger().warn('binary_integrity_blocked', { id, path: bundledPath })
        return null
      }
    }

    const candidates: Array<{ path: string; source: DependencySource }> = []
    if (envOverride) candidates.push({ path: envOverride, source: 'env' })
    candidates.push({ path: bundledPath, source: 'bundled' })

    const pathValue = process.env.PATH ?? ''
    for (const directory of pathValue.split(delimiter)) {
      const normalized = directory.trim().replace(/^"(.*)"$/, '$1')
      if (normalized.length > 0) {
        candidates.push({ path: join(normalized, executableName(id)), source: 'system' })
      }
    }

    return candidates.find((candidate) => isExecutableFile(candidate.path)) ?? null
  }

  private async runIntegrityVerification(): Promise<void> {
    if (!this.manifest) return

    const pinnedEntries = Object.entries(this.platformArtifacts).filter(
      (entry): entry is [DependencyId, PinnedBinary] =>
        isRecord(entry[1]) && typeof entry[1].sha256 === 'string',
    )

    if (pinnedEntries.length === 0) {
      this.logger().warn('binary_manifest_platform_missing', {
        platform: `${process.platform}-${process.arch}`,
      })
      return
    }

    await Promise.all(
      pinnedEntries.map(async ([id, pinned]) => {
        const path = this.bundledPath(id)
        if (!isExecutableFile(path)) return

        try {
          const actual = await sha256File(path)
          const expected = pinned.sha256?.toLowerCase()
          if (actual.toLowerCase() === expected) {
            this.integrity.set(path, { ok: true, reason: null })
          } else {
            this.integrity.set(path, { ok: false, reason: 'checksum_mismatch' })
            this.logger().warn('binary_integrity_mismatch', {
              id,
              path,
              expected,
              actual,
            })
          }
        } catch (error) {
          this.integrity.set(path, { ok: false, reason: 'unreadable' })
          this.logger().warn('binary_integrity_unreadable', {
            id,
            path,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    )
  }

  private async check(id: DependencyId): Promise<DependencyInfo> {
    await this.verifyIntegrity()

    const pinned = this.platformArtifacts[id]
    const bundledPath = this.bundledPath(id)
    if (pinned?.sha256 && isExecutableFile(bundledPath) && !this.integrity.get(bundledPath)?.ok) {
      return { id, state: 'error', version: null, source: 'bundled' }
    }

    const resolved = this.resolveExecutable(id)
    if (!resolved) {
      return { id, state: 'missing', version: null, source: null }
    }

    // The torrent helper is a long-running JSON-lines process, not a CLI tool.
    if (id === 'torrent-helper') {
      return { id, state: 'ready', version: null, source: resolved.source }
    }

    const version = await this.readVersion(resolved.path, VERSION_ARGS[id])
    return {
      id,
      state: version ? 'ready' : 'error',
      version,
      source: resolved.source,
    }
  }

  private readVersion(executable: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let output = ''
      let settled = false

      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }

      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timer = setTimeout(() => {
        child.kill()
        finish(null)
      }, 5000)

      const collect = (chunk: Buffer): void => {
        if (output.length < 16_384) output += chunk.toString('utf8')
      }

      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.on('error', () => finish(null))
      child.on('close', () => {
        const line = output
          .split(/\r?\n/)
          .map((value) => value.trim())
          .find((value) => value.length > 0)
        finish(line ?? null)
      })
    })
  }

  private loadManifest(): BinaryManifest | null {
    const manifestPath = join(this.options.bundledRoot, MANIFEST_FILENAME)
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.platforms)) {
        this.logger().warn('binary_manifest_invalid', { path: manifestPath })
        return null
      }
      return parsed as unknown as BinaryManifest
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger().warn('binary_manifest_unreadable', {
          path: manifestPath,
          error: error instanceof Error ? error.message : String(error),
        })
      } else {
        this.logger().info('binary_manifest_missing', { path: manifestPath })
      }
      return null
    }
  }

  private bundledPath(id: DependencyId): string {
    return join(
      this.options.bundledRoot,
      'bin',
      `${process.platform}-${process.arch}`,
      executableName(id),
    )
  }

  private logger(): DependencyLogger {
    return this.options.logger ?? { info: () => undefined, warn: () => undefined }
  }
}
