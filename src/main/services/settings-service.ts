import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Settings, SettingsPatch } from '@shared/ipc/contracts'
import { settingsSchema } from '@shared/validation/settings'
import { JsonSettingsRepository } from '../storage/settings-repository'
import type { SettingsRepository } from '../storage/settings-repository'

export interface SettingsLogger {
  warn(message: string, context?: Record<string, unknown>): void
}

export interface SettingsServiceOptions {
  defaultDownloadDirectory: string
  repository?: SettingsRepository
  filePath?: string
  /** JSON settings file from a pre-SQLite release, imported once. */
  legacyFilePath?: string
  logger?: SettingsLogger
}

export function createDefaultSettings(defaultDownloadDirectory: string): Settings {
  return {
    downloadDirectory: defaultDownloadDirectory,
    maxConcurrentDownloads: 2,
    concurrentFragments: 4,
    maxDownloadRateBytesPerSecond: 0,
    maxUploadRateBytesPerSecond: 0,
    torrentConnectionProfile: 'high',
    torrentNATMapping: true,
    torrentSeedAfterComplete: false,
    resumeIncompleteDownloads: true,
    theme: 'system',
  }
}

export class SettingsService {
  private readonly repository: SettingsRepository
  private readonly fallback: Settings
  private current: Settings

  constructor(private readonly options: SettingsServiceOptions) {
    if (!options.repository && !options.filePath) {
      throw new Error('SettingsService requires a repository or a JSON file path.')
    }

    this.repository = options.repository ?? new JsonSettingsRepository(options.filePath as string)
    this.fallback = createDefaultSettings(options.defaultDownloadDirectory)
    this.current = this.load()
  }

  get(): Settings {
    return this.current
  }

  update(patch: SettingsPatch): Settings {
    const next = settingsSchema.parse({ ...this.current, ...patch })
    if (!isAbsolute(next.downloadDirectory)) {
      throw new Error('The download directory must be an absolute path.')
    }

    if (next.downloadDirectory !== this.current.downloadDirectory) {
      mkdirSync(next.downloadDirectory, { recursive: true })
    }

    this.repository.write(next)
    this.current = next
    return next
  }

  private load(): Settings {
    try {
      const stored = this.repository.read()
      if (stored === null) {
        const legacy = this.readLegacySettings()
        if (legacy) {
          this.repository.write(legacy)
          this.renameLegacySettings('migrated')
          return legacy
        }

        this.repository.write(this.fallback)
        return this.fallback
      }

      // Merge defaults first so a settings file written by an older version
      // gains newly added fields instead of being treated as corrupt.
      const parsed = settingsSchema.safeParse({ ...this.fallback, ...stored })
      if (parsed.success) return parsed.data

      this.preserveCorruptSettings()
      this.repository.write(this.fallback)
      return this.fallback
    } catch {
      this.preserveCorruptSettings()
      try {
        this.repository.write(this.fallback)
      } catch {
        // The application can still run with in-memory defaults.
      }
      return this.fallback
    }
  }

  private readLegacySettings(): Settings | null {
    const legacyPath = this.options.legacyFilePath
    if (!legacyPath || !existsSync(legacyPath)) return null

    try {
      const raw = readFileSync(legacyPath, 'utf8')
      const parsed = settingsSchema.safeParse({ ...this.fallback, ...JSON.parse(raw) })
      if (parsed.success) return parsed.data
      this.renameLegacySettings('corrupt')
    } catch {
      this.renameLegacySettings('corrupt')
    }
    return null
  }

  private preserveCorruptSettings(): void {
    if (this.repository instanceof JsonSettingsRepository) {
      this.preservePath(this.repository.filePath)
      return
    }
    this.renameLegacySettings('corrupt')
  }

  private renameLegacySettings(suffix: 'corrupt' | 'migrated'): void {
    const legacyPath = this.options.legacyFilePath
    if (!legacyPath) return
    this.preservePath(legacyPath, suffix)
  }

  private preservePath(filePath: string, suffix = 'corrupt'): void {
    try {
      renameSync(filePath, `${filePath}.${suffix}-${Date.now()}`)
    } catch {
      // Nothing to preserve, or the file could not be moved.
    }
  }
}
