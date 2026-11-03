import type {
  AppInfo,
  CreateJobRequest,
  DependencyStatus,
  DownloadJob,
  EngineInfo,
  JobIdRequest,
  OpenLocationRequest,
  Result,
  Settings,
  SettingsPatch,
  SourcePreviewEnvelope,
  YoutubePreviewEnvelope,
} from './contracts'

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
  preview: {
    request(url: string, requestId: string): Promise<Result<SourcePreviewEnvelope>>
    cancel(requestId: string): Promise<Result<null>>
  }
  engines: {
    list(): Promise<Result<EngineInfo[]>>
  }
  youtube: {
    preview(url: string, requestId: string): Promise<Result<YoutubePreviewEnvelope>>
    cancelPreview(requestId: string): Promise<Result<null>>
  }
  jobs: {
    create(request: CreateJobRequest): Promise<Result<DownloadJob>>
    list(): Promise<Result<DownloadJob[]>>
    cancel(request: JobIdRequest): Promise<Result<DownloadJob>>
    retry(request: JobIdRequest): Promise<Result<DownloadJob>>
    pause(request: JobIdRequest): Promise<Result<DownloadJob>>
    resume(request: JobIdRequest): Promise<Result<DownloadJob>>
    remove(request: JobIdRequest): Promise<Result<null>>
    openLocation(request: OpenLocationRequest): Promise<Result<null>>
    onChanged(listener: (job: DownloadJob) => void): Unsubscribe
    onRemoved(listener: (jobId: string) => void): Unsubscribe
  }
}
