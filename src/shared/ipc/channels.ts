export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  chooseDirectory: 'system:choose-directory',
  openDestination: 'system:open-destination',
  openLogs: 'diagnostics:open-logs',
  dependenciesStatus: 'dependencies:status',
  dependenciesRecheck: 'dependencies:recheck',
  dependenciesChanged: 'dependencies:changed',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
