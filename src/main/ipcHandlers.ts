import { ipcMain, dialog, BrowserWindow } from 'electron'
import { windowManager, createVideoWindow } from './main'
import { mpvManager } from './mpvManager'

export function setupIpcHandlers() {
  // 处理文件选择
  ipcMain.on('select-video-file', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0]
      const fileName = filePath.split(/[/\\]/).pop() || '未知文件'
      
      // 发送到主窗口
      const mainWindow = windowManager.getWindow('main')
      if (mainWindow) {
        mainWindow.webContents.send('video-file-selected', {
          name: fileName,
          path: filePath
        })
      }
    }
  })

  // 处理播放视频
  ipcMain.on('play-video', async (event, file: { name: string; path: string }) => {
    // 创建视频窗口（用于显示控制面板）
    createVideoWindow()
    
    const videoWindow = windowManager.getWindow('video')
    
    if (videoWindow) {
      // 等待窗口完全加载
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // 先通知视频窗口更新标题
      videoWindow.webContents.send('play-video', file)
      
      // 设置视频窗口到 mpvManager（用于窗口管理）
      mpvManager.setVideoWindow(videoWindow)
      
      try {
        // 使用 mpv 播放视频（mpv 会创建自己的独立窗口）
        await mpvManager.playVideo(file.path)
        
        // 调整 mpv 窗口位置，使其与控制窗口协调
        // 注意：mpv 窗口由 mpv 自己管理，我们只能通过窗口标题找到它
        // 或者让 mpv 窗口位置跟随我们的控制窗口
        
        // 开始状态轮询并转发到视频窗口的控制面板
        const controller = mpvManager.getController()
        if (controller) {
          controller.on('status', (status) => {
            videoWindow.webContents.send('video-time-update', {
              currentTime: status.position,
              duration: status.duration
            })
          })
          
          controller.on('error', (error) => {
            console.error('MPV controller error:', error)
          })
        }
      } catch (error) {
        console.error('Failed to play video with mpv:', error)
        // 如果 mpv 失败，显示错误信息
        videoWindow.webContents.send('mpv-error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  })

  // 处理播放控制 - 暂停
  ipcMain.on('control-pause', async () => {
    await mpvManager.pause()
  })

  // 处理播放控制 - 播放
  ipcMain.on('control-play', async () => {
    await mpvManager.play()
  })

  // 处理播放控制 - 跳转
  ipcMain.on('control-seek', async (event, time: number) => {
    await mpvManager.seek(time)
  })

  // 处理音量控制
  ipcMain.on('control-volume', async (event, volume: number) => {
    await mpvManager.setVolume(volume)
  })

  // 视频时间更新 - 转发到视频窗口（控制面板已集成在视频窗口中）
  ipcMain.on('video-time-update', (event, data: { currentTime: number; duration: number }) => {
    const videoWindow = windowManager.getWindow('video')
    if (videoWindow) {
      videoWindow.webContents.send('video-time-update', data)
    }
  })

  // 视频结束 - 转发到视频窗口
  ipcMain.on('video-ended', () => {
    const videoWindow = windowManager.getWindow('video')
    if (videoWindow) {
      videoWindow.webContents.send('video-ended')
    }
  })
}

