import { ipcMain, dialog, BrowserWindow } from 'electron'
import { windowManager, createVideoWindow } from './main'
import { mpvManager } from './mpvManager'

export function setupIpcHandlers() {
  // 处理文件选择
  ipcMain.on('select-video-file', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'm2ts', 'mts', 'm3u8'] },
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
    const timestamp = () => `[${new Date().toISOString()}]`;
    console.log(`${timestamp()} [EVENT] 'play-video' event triggered for file: ${file.path}`);

    // 记录主窗口状态
    const mainWindow = windowManager.getWindow('main');
    if (mainWindow) {
      console.log(`${timestamp()} [INFO] Main window status before playing: visible=${mainWindow.isVisible()}, destroyed=${mainWindow.isDestroyed()}`);
      // 通常在这里隐藏主窗口
      mainWindow.hide();
      console.log(`${timestamp()} [ACTION] Main window hidden.`);
    }

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
        // 使用 mpv 播放视频（会自动选择 libmpv 或 IPC 模式）
        console.log('[IPC] Starting MPV playback...')
        await mpvManager.play(file.path)
        
        // 通知窗口嵌入状态
        const isUsingLibMPV = mpvManager.isUsingLibMPV()
        videoWindow.webContents.send('mpv-embedded', {
          embedded: isUsingLibMPV, // libmpv 可以真正嵌入，IPC 模式在 macOS 上不能
          mode: isUsingLibMPV ? 'libmpv' : 'ipc'
        })
        
        console.log('[IPC] MPV started successfully, mode:', isUsingLibMPV ? 'libmpv (native)' : 'IPC (spawn)')
        
        // 延迟检查是否成功启动
        setTimeout(() => {
          const controller = mpvManager.getController()
          if (controller && controller.getStatus()) {
            console.log('[IPC] MPV status check passed')
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
          embedded: false,
          mode: 'none'
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
    await mpvManager.resume()
  })

  ipcMain.on('play-url', async (_event, url: string) => {
    const videoWindow = windowManager.getWindow('video')
    if (videoWindow) {
      mpvManager.setVideoWindow(videoWindow)
    }
    try {
      await mpvManager.play(url)
    } catch (error) {
      const targetWindow = videoWindow || windowManager.getWindow('main')
      if (targetWindow) {
        targetWindow.webContents.send('mpv-error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  })

  ipcMain.on('control-stop', async () => {
    await mpvManager.stop()
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
