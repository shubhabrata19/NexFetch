import type { AppInfo, DependencyStatus, Result, Settings, SettingsPatch } from './contracts'

export type Unsubscribe = () => void

export interface NexFetchApi {
  app: {
    getInfo(): Promise<Result<AppInfo>>
  }
  settings: {
    get(): Promise<Result<Settings>>
    update(patch: SettingsPatch): Promise<Result<Settings>>
    onChanged(listener: (settings: Settings) => void): Unsubscribe
  }
  system: {
    chooseDirectory(): Promise<Result<string | null>>
    openDestination(): Promise<Result<null>>
    openLogs(): Promise<Result<null>>
  }
  dependencies: {
    getStatus(): Promise<Result<DependencyStatus>>
    recheck(): Promise<Result<DependencyStatus>>
    onChanged(listener: (status: DependencyStatus) => void): Unsubscribe
  }
}
