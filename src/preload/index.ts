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
    openDestination: () => invoke(IPC.openDestination),
    openLogs: () => invoke(IPC.openLogs),
  },
  dependencies: {
    getStatus: () => invoke(IPC.dependenciesStatus),
    recheck: () => invoke(IPC.dependenciesRecheck),
    onChanged: (listener) => subscribe(IPC.dependenciesChanged, listener),
  },
}

contextBridge.exposeInMainWorld('nexfetch', Object.freeze(api))
