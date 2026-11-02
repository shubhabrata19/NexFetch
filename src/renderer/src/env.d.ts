/// <reference types="vite/client" />

import type { NexFetchApi } from '@shared/ipc/api'

declare global {
  interface Window {
    nexfetch: NexFetchApi
  }
}

export {}
