/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    platform: string
    send: (channel: string, data?: any) => void
    on: (channel: string, callback: (data: any) => void) => void
    removeListener: (channel: string, callback: (data: any) => void) => void
  }
}

