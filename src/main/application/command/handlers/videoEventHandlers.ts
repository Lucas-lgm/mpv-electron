import { ipcMain } from 'electron'
import type { VideoPlayerApp } from '../../videoPlayerApp'
import { IPC_CHANNELS } from '../ipcConstants'

/**
 * 视频事件转发相关的 IPC handlers
 * 
 * 这些 handlers 用于转发从 renderer 到 video window 的消息
 */
export function setupVideoEventHandlers(videoPlayerApp: VideoPlayerApp): void {
  // 转发消息（renderer → main → video window，路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.VIDEO_TIME_UPDATE, (_event, data: { currentTime: number; duration: number }) => {
    videoPlayerApp.forwardVideoTimeUpdate(data)
  })

  ipcMain.on(IPC_CHANNELS.VIDEO_ENDED, () => {
    videoPlayerApp.forwardVideoEnded()
  })
}
