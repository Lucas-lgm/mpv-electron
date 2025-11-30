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
      // 确保窗口显示在前台并聚焦
      if (!videoWindow.isVisible()) {
        videoWindow.show()
      }
      videoWindow.focus()
      videoWindow.moveTop() // 移到最前面
      
      console.log('[IPC] Video window created and shown:', {
        visible: videoWindow.isVisible(),
        destroyed: videoWindow.isDestroyed(),
        bounds: videoWindow.getBounds()
      })
      
      // 等待窗口完全加载和渲染
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // 再次确保窗口可见
      if (!videoWindow.isVisible()) {
        videoWindow.show()
        videoWindow.focus()
      }
      
      // 设置视频窗口到 mpvManager（必须在播放之前设置，用于获取窗口句柄）
      mpvManager.setVideoWindow(videoWindow)
      console.log('[IPC] ✅ Video window set to mpvManager before starting playback')
      console.log('[IPC] Video window details:', {
        exists: !!videoWindow,
        destroyed: videoWindow.isDestroyed(),
        visible: videoWindow.isVisible(),
        bounds: videoWindow.getBounds()
      })
      
      // 先通知视频窗口更新标题
      videoWindow.webContents.send('play-video', file)
      
      try {
        // 使用 mpv 播放视频（会将窗口句柄传给 MPV）
        console.log('[IPC] Starting MPV playback, window handle should be passed...')
        await mpvManager.playVideo(file.path)
        
        // 通知窗口嵌入状态（假设成功，实际状态会在启动时确定）
        // 如果嵌入失败，会自动回退到独立窗口模式
        videoWindow.webContents.send('mpv-embedded', {
          embedded: true // 假设成功，实际情况可能不同
        })
        
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
            videoWindow.webContents.send('mpv-error', {
              message: error instanceof Error ? error.message : 'Unknown error'
            })
          })

          controller.on('stopped', () => {
            console.log('MPV stopped')
          })
        }

        // 延迟检查是否成功启动（给 MPV 一些时间）
        setTimeout(() => {
          if (controller && controller.getStatus()) {
            console.log('[IPC] MPV started successfully')
          } else {
            console.warn('[IPC] MPV may not have started correctly')
          }
        }, 1000)
      } catch (error) {
        console.error('Failed to play video with mpv:', error)
        // 如果 mpv 失败，显示错误信息
        videoWindow.webContents.send('mpv-error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
        videoWindow.webContents.send('mpv-embedded', {
          embedded: false
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

