import type { EngineSelection } from '@shared/domain/engine'
import type { DownloadJob } from '@shared/domain/job'
import { JsonFileStore } from '../services/json-file-store'

/**
 * Internal persisted job record. The engine-owned selection and workspace path
 * never cross the IPC boundary.
 */
export interface PersistedJobRecord extends DownloadJob {
  selection: EngineSelection | null
  workspaceDirectory: string | null
  /** Magnet trackers used for metadata resolution only; never sent to the UI. */
  lookupTrackers?: string[] | null
}

export interface JobRepository {
  list(): PersistedJobRecord[]
  get(id: string): PersistedJobRecord | null
  save(job: PersistedJobRecord): void
  remove(id: string): void
}

export function toJobView(job: PersistedJobRecord): DownloadJob {
  const { selection, workspaceDirectory, lookupTrackers, ...view } = job
  void selection
  void workspaceDirectory
  void lookupTrackers
  return view
}

export class JsonJobRepository implements JobRepository {
  private readonly store: JsonFileStore<PersistedJobRecord[]>
  private jobs: PersistedJobRecord[]

  constructor(filePath: string) {
    this.store = new JsonFileStore<PersistedJobRecord[]>(filePath)
    this.jobs = this.load()
  }

  list(): PersistedJobRecord[] {
    return this.jobs
  }

  get(id: string): PersistedJobRecord | null {
    return this.jobs.find((job) => job.id === id) ?? null
  }

  save(job: PersistedJobRecord): void {
    const index = this.jobs.findIndex((existing) => existing.id === job.id)
    if (index === -1) {
      this.jobs = [...this.jobs, job]
    } else {
      this.jobs = this.jobs.map((existing) => (existing.id === job.id ? job : existing))
    }
    this.store.write(this.jobs)
  }

  remove(id: string): void {
    this.jobs = this.jobs.filter((job) => job.id !== id)
    this.store.write(this.jobs)
  }

  private load(): PersistedJobRecord[] {
    try {
      return this.store.read() ?? []
    } catch {
      return []
    }
  }
}
