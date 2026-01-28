import { ipcMain } from 'electron'
import type { VideoPlayerApp } from '../../videoPlayerApp'
import { IPC_CHANNELS } from '../ipcConstants'

/**
 * 控制栏显示/隐藏相关的 IPC handlers
 */
export function setupControlBarHandlers(videoPlayerApp: VideoPlayerApp): void {
  // 控制栏显示/隐藏（路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.CONTROL_BAR_MOUSE_MOVE, () => {
    videoPlayerApp.showControlBar()
  })

  ipcMain.on(IPC_CHANNELS.CONTROL_BAR_MOUSE_LEAVE, () => {
    videoPlayerApp.scheduleHideControlBar()
  })
}
