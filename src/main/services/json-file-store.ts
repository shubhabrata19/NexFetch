import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Small dependency-free JSON store with atomic-ish replacement. The repository
 * interfaces around it allow a later migration to SQLite without touching the
 * rest of the application.
 */
export class JsonFileStore<T> {
  constructor(readonly filePath: string) {}

  read(): T | null {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      return JSON.parse(raw) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  write(value: T): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

    try {
      renameSync(temporaryPath, this.filePath)
    } catch {
      rmSync(this.filePath, { force: true })
      renameSync(temporaryPath, this.filePath)
    }
  }
}
