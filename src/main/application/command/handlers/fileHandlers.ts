import { ipcMain, dialog } from 'electron'
import type { VideoPlayerApp } from '../../videoPlayerApp'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS, VIDEO_FILE_EXTENSIONS } from '../ipcConstants'

/**
 * 文件选择相关的 IPC handlers
 */
export function setupFileHandlers(videoPlayerApp: VideoPlayerApp): void {
  // 文件选择（薄编排：dialog → 调用 App 方法）
  ipcMain.on(IPC_CHANNELS.SELECT_VIDEO_FILE, createIpcHandler(
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: '视频文件', extensions: [...VIDEO_FILE_EXTENSIONS] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const fileName = filePath.split(/[/\\]/).pop() || '未知文件'
        videoPlayerApp.handleFileSelected({ name: fileName, path: filePath })
      }
    },
    undefined,
    IPC_CHANNELS.SELECT_VIDEO_FILE
  ))
}
