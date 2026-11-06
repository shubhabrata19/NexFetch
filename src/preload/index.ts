import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { Result } from '@shared/ipc/contracts'
import type { NexFetchApi, Unsubscribe } from '@shared/ipc/api'
import { IPC } from '@shared/ipc/channels'

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Result<T>>
}

function subscribe<T>(channel: string, listener: (value: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: NexFetchApi = {
  app: {
    getInfo: () => invoke(IPC.appInfo),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    onChanged: (listener) => subscribe(IPC.settingsChanged, listener),
  },
  system: {
    chooseDirectory: () => invoke(IPC.chooseDirectory),
    readClipboardText: () => invoke(IPC.readClipboardText),
    openDestination: () => invoke(IPC.openDestination),
    openLogs: () => invoke(IPC.openLogs),
    openReleases: () => invoke(IPC.openReleases),
  },
  dependencies: {
    getStatus: () => invoke(IPC.dependenciesStatus),
    recheck: () => invoke(IPC.dependenciesRecheck),
    onChanged: (listener) => subscribe(IPC.dependenciesChanged, listener),
  },
  preview: {
    request: (url, requestId) => invoke(IPC.previewRequest, { url, requestId }),
    cancel: (requestId) => invoke(IPC.previewCancel, { requestId }),
  },
  engines: {
    list: () => invoke(IPC.enginesList),
  },
  youtube: {
    preview: (url, requestId) => invoke(IPC.youtubePreview, { url, requestId }),
    cancelPreview: (requestId) => invoke(IPC.youtubeCancelPreview, { requestId }),
  },
  torrent: {
    chooseFile: () => invoke(IPC.torrentChooseFile),
    previewFile: (path, requestId) => invoke(IPC.torrentPreviewFile, { path, requestId }),
    previewBytes: (requestId, name, dataBase64) =>
      invoke(IPC.torrentPreviewBytes, { requestId, name, dataBase64 }),
    lookup: (infoHash) => invoke(IPC.torrentLookup, { infoHash }),
    cancelPreview: (requestId) => invoke(IPC.torrentCancelPreview, { requestId }),
  },
  jobs: {
    create: (request) => invoke(IPC.jobsCreate, request),
    startSetup: (request) => invoke(IPC.jobsStartSetup, request),
    list: () => invoke(IPC.jobsList),
    cancel: (request) => invoke(IPC.jobsCancel, request),
    retry: (request) => invoke(IPC.jobsRetry, request),
    pause: (request) => invoke(IPC.jobsPause, request),
    resume: (request) => invoke(IPC.jobsResume, request),
    startSeeding: (request) => invoke(IPC.jobsStartSeeding, request),
    stopSeeding: (request) => invoke(IPC.jobsStopSeeding, request),
    setTorrentLimits: (request) => invoke(IPC.torrentsSetLimits, request),
    findMorePeers: (request) => invoke(IPC.torrentsFindMorePeers, request),
    verifyTorrent: (request) => invoke(IPC.torrentsVerify, request),
    remove: (request) => invoke(IPC.jobsRemove, request),
    openLocation: (request) => invoke(IPC.jobsOpenLocation, request),
    onChanged: (listener) => subscribe(IPC.jobsChanged, listener),
    onRemoved: (listener) => subscribe(IPC.jobsRemoved, listener),
  },
}

contextBridge.exposeInMainWorld('nexfetch', Object.freeze(api))
