import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface SqliteLogger {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

export interface SqliteDatabaseOptions {
  filePath: string
  logger?: SqliteLogger
}

function isMemoryDatabase(filePath: string): boolean {
  return filePath === ':memory:'
}

/**
 * Small wrapper around Electron's built-in SQLite driver. Keeping the raw
 * driver behind this boundary makes the repository code testable and leaves a
 * single place to change if Node's experimental SQLite API evolves.
 */
export class SqliteDatabase {
  private database: DatabaseSync | null = null
  private transactionDepth = 0

  constructor(private readonly options: SqliteDatabaseOptions) {}

  get filePath(): string {
    return this.options.filePath
  }

  get raw(): DatabaseSync {
    return this.requireDatabase()
  }

  open(): void {
    if (this.database) return
    if (!isMemoryDatabase(this.options.filePath)) {
      mkdirSync(dirname(this.options.filePath), { recursive: true })
    }

    try {
      this.database = this.openDatabase(this.options.filePath)
    } catch (error) {
      if (isMemoryDatabase(this.options.filePath) || !existsSync(this.options.filePath)) {
        throw error
      }

      const corruptPath = `${this.options.filePath}.corrupt-${Date.now()}`
      try {
        this.moveCorruptFiles(corruptPath)
        this.database = this.openDatabase(this.options.filePath)
        this.options.logger?.warn('sqlite_database_replaced', {
          corruptPath,
          error: error instanceof Error ? error.message : String(error),
        })
      } catch (recoveryError) {
        this.options.logger?.warn('sqlite_database_recovery_failed', {
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        })
        throw error
      }
    }
  }

  close(): void {
    this.database?.close()
    this.database = null
  }

  exec(sql: string): void {
    this.requireDatabase().exec(sql)
  }

  prepare(sql: string) {
    return this.requireDatabase().prepare(sql)
  }

  get userVersion(): number {
    const row = this.requireDatabase().prepare('PRAGMA user_version').get() as
      { user_version?: unknown } | undefined
    return typeof row?.user_version === 'number' ? row.user_version : 0
  }

  setUserVersion(version: number): void {
    if (!Number.isInteger(version) || version < 0) {
      throw new Error('The SQLite schema version must be a non-negative integer.')
    }
    this.requireDatabase().exec(`PRAGMA user_version = ${version}`)
  }

  transaction<T>(operation: () => T): T {
    const database = this.requireDatabase()
    const depth = this.transactionDepth
    const savepoint = `nexfetch_sp_${depth}`

    if (depth === 0) {
      database.exec('BEGIN IMMEDIATE')
    } else {
      database.exec(`SAVEPOINT ${savepoint}`)
    }
    this.transactionDepth += 1

    try {
      const result = operation()
      if (depth === 0) {
        database.exec('COMMIT')
      } else {
        database.exec(`RELEASE SAVEPOINT ${savepoint}`)
      }
      return result
    } catch (error) {
      try {
        if (depth === 0) {
          database.exec('ROLLBACK')
        } else {
          database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        }
      } catch {
        // The original failure is more useful than a rollback failure.
      }
      throw error
    } finally {
      this.transactionDepth = depth
    }
  }

  /**
   * Creates a consistent copy of the database. Used before schema upgrades so
   * a failed migration never leaves the only copy unusable.
   */
  backupTo(targetPath: string): void {
    if (isMemoryDatabase(this.options.filePath)) return
    mkdirSync(dirname(targetPath), { recursive: true })
    const escaped = targetPath.replace(/'/g, "''")
    this.requireDatabase().exec(`VACUUM INTO '${escaped}'`)
  }

  private openDatabase(filePath: string): DatabaseSync {
    const database = new DatabaseSync(filePath)
    try {
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('PRAGMA busy_timeout = 5000')
      database.exec('PRAGMA synchronous = NORMAL')
      if (!isMemoryDatabase(filePath)) {
        database.exec('PRAGMA journal_mode = WAL')
      }
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  private moveCorruptFiles(targetBase: string): void {
    renameSync(this.options.filePath, targetBase)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${this.options.filePath}${suffix}`
      if (existsSync(sidecar)) {
        renameSync(sidecar, `${targetBase}${suffix}`)
      }
    }
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) {
      throw new Error('The SQLite database has not been opened.')
    }
    return this.database
  }
}
