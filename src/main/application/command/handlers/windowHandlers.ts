import { ipcMain } from 'electron'
import type { VideoPlayerApp } from '../../videoPlayerApp'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS } from '../ipcConstants'

/**
 * 窗口操作相关的 IPC handlers
 */
export function setupWindowHandlers(videoPlayerApp: VideoPlayerApp): void {
  // 窗口操作（路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.CONTROL_TOGGLE_FULLSCREEN, createIpcHandler(
    () => {
      videoPlayerApp.toggleFullscreen()
    },
    undefined,
    IPC_CHANNELS.CONTROL_TOGGLE_FULLSCREEN
  ))

  // 注意：renderer 发送的是字符串 action，而不是 { action: string }
  ipcMain.on(IPC_CHANNELS.CONTROL_WINDOW_ACTION, createIpcHandler<[string]>(
    (_event, action: string) => {
      // 验证 action 是有效的值
      if (action !== 'close' && action !== 'minimize' && action !== 'maximize') {
        throw new Error(`Invalid window action: ${action} (must be 'close', 'minimize', or 'maximize')`)
      }
      videoPlayerApp.windowAction(action as 'close' | 'minimize' | 'maximize')
    },
    undefined,
    IPC_CHANNELS.CONTROL_WINDOW_ACTION
  ))
}
