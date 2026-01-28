/**
 * MPV 相关类型定义
 */

/**
 * Native binding 接口（内部使用，不导出）
 */
export interface MPVBinding {
  create(): number
  initialize(instanceId: number): boolean
  setOption(instanceId: number, name: string, value: string | number | boolean): boolean
  setWindowId(instanceId: number, windowId: number): boolean
  loadFile(instanceId: number, path: string): boolean
  getProperty(instanceId: number, name: string): any
  setProperty(instanceId: number, name: string, value: string | number | boolean): boolean
  command(instanceId: number, args: string[]): boolean
  setEventCallback(instanceId: number, callback: (event: any) => void): boolean
  attachView(instanceId: number, viewPtr: number): void
  setWindowSize(instanceId: number, width: number, height: number): void
  setForceBlackMode(instanceId: number, enabled: boolean): void
  setHdrMode(instanceId: number, enabled: boolean): void
  debugHdrStatus(instanceId: number): void
  setJsDrivenRenderMode(instanceId: number, enabled: boolean): void
  getJsDrivenRenderMode(instanceId: number): boolean
  requestRender(instanceId: number): void
  destroy(instanceId: number): boolean
}

/**
 * MPV 内部状态接口
 */
export interface MPVStatus {
  position: number
  duration: number
  volume: number
  path: string | null
  phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  isSeeking?: boolean
  isNetworkBuffering?: boolean
  networkBufferingPercent?: number
  /** 最近一次 mpv 错误的简要信息（单行，人类可读） */
  errorMessage?: string
  /** 最近一次错误相关的若干日志行（技术详情，可选） */
  errorLogSnippet?: string[]
}
