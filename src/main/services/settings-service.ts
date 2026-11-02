import { mkdirSync, renameSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Settings, SettingsPatch } from '@shared/ipc/contracts'
import { settingsSchema } from '@shared/validation/settings'
import { JsonFileStore } from './json-file-store'

export interface SettingsServiceOptions {
  filePath: string
  defaultDownloadDirectory: string
}

export class SettingsService {
  private readonly store: JsonFileStore<Settings>
  private readonly fallback: Settings
  private current: Settings

  constructor(options: SettingsServiceOptions) {
    this.store = new JsonFileStore<Settings>(options.filePath)
    this.fallback = {
      downloadDirectory: options.defaultDownloadDirectory,
      maxConcurrentDownloads: 2,
      concurrentFragments: 4,
      theme: 'system',
    }
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

    this.store.write(next)
    this.current = next
    return next
  }

  private load(): Settings {
    try {
      const stored = this.store.read()
      if (stored === null) {
        this.store.write(this.fallback)
        return this.fallback
      }

      // Merge defaults first so a settings file written by an older version
      // gains newly added fields instead of being treated as corrupt.
      const parsed = settingsSchema.safeParse({ ...this.fallback, ...stored })
      if (parsed.success) return parsed.data

      this.preserveCorruptFile()
      this.store.write(this.fallback)
      return this.fallback
    } catch {
      this.preserveCorruptFile()
      try {
        this.store.write(this.fallback)
      } catch {
        // The application can still run with in-memory defaults.
      }
      return this.fallback
    }
  }

  private preserveCorruptFile(): void {
    try {
      renameSync(this.store.filePath, `${this.store.filePath}.corrupt-${Date.now()}`)
    } catch {
      // Nothing to preserve, or the file could not be moved.
    }
  }
}
