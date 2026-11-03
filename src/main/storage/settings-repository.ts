import type { StatementSync } from 'node:sqlite'
import type { Settings } from '@shared/ipc/contracts'
import { JsonFileStore } from '../services/json-file-store'
import type { SqliteDatabase } from './sqlite-database'

export interface SettingsRepository {
  read(): Settings | null
  write(settings: Settings): void
}

export class JsonSettingsRepository implements SettingsRepository {
  private readonly store: JsonFileStore<Settings>

  constructor(readonly filePath: string) {
    this.store = new JsonFileStore<Settings>(filePath)
  }

  read(): Settings | null {
    return this.store.read()
  }

  write(settings: Settings): void {
    this.store.write(settings)
  }
}

export class SqliteSettingsRepository implements SettingsRepository {
  private readonly selectOne: StatementSync
  private readonly upsert: StatementSync

  constructor(database: SqliteDatabase) {
    this.selectOne = database.prepare('SELECT payload FROM settings WHERE id = 1')
    this.upsert = database.prepare(`
      INSERT INTO settings (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `)
  }

  read(): Settings | null {
    const row = this.selectOne.get() as { payload?: unknown } | undefined
    if (!row || typeof row.payload !== 'string') return null
    try {
      return JSON.parse(row.payload) as Settings
    } catch {
      return null
    }
  }

  write(settings: Settings): void {
    this.upsert.run(JSON.stringify(settings), new Date().toISOString())
  }
}
