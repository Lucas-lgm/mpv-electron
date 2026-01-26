import { ipcMain, dialog, BrowserWindow } from 'electron'
import { windowManager } from './main'
import { videoPlayerApp, PlaylistItem } from './videoPlayerApp'
import { corePlayer } from './corePlayer'
import { handlePlayMedia } from './playbackController'

// 显式记录通过控制栏按钮进入的“播放器全屏模式”
// 这样不依赖 Electron 在透明/子窗口场景下的 isFullScreen() 实现细节
let isFullscreen = false

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
    const currentList = videoPlayerApp.playlist.getList()
    let nextList = currentList
    if (!currentList.some(item => item.path === file.path)) {
      nextList = [...currentList, { name: file.name, path: file.path }]
      videoPlayerApp.playlist.setList(nextList)
    }
    videoPlayerApp.playlist.setCurrentByPath(file.path)
    await handlePlayMedia(file)
    if (nextList.length > 0) {
      corePlayer.broadcastToPlaybackUIs('playlist-updated', nextList)
    }
  })

  ipcMain.on('get-playlist', (event) => {
    const result = videoPlayerApp.appService.getPlaylist({})
    const items = result.entries.map(e => ({
      path: e.media.uri,
      name: e.media.displayName
    }))
    event.reply('playlist-updated', items)
  })

  // 处理播放控制 - 暂停
  ipcMain.on('control-pause', async () => {
    await videoPlayerApp.appService.pausePlayback({})
  })

  // 处理播放控制 - 播放
  ipcMain.on('control-play', async () => {
    await videoPlayerApp.appService.resumePlayback({})
  })

  // 处理 URL 播放
  ipcMain.on('play-url', async (_event, url: string) => {
    const item: PlaylistItem = { path: url, name: url }
    videoPlayerApp.playlist.setList([item])
    videoPlayerApp.playlist.setCurrentByPath(item.path)
    await handlePlayMedia(item)
    corePlayer.broadcastToPlaybackUIs('playlist-updated', [item])
  })

  ipcMain.on('control-stop', async () => {
    await videoPlayerApp.appService.stopPlayback({})
  })

  // 处理播放控制 - 跳转
  ipcMain.on('control-seek', async (_event, time: number) => {
    await videoPlayerApp.appService.seek({ time })
  })

  // 处理音量控制
  ipcMain.on('control-volume', async (_event, volume: number) => {
    await videoPlayerApp.appService.setVolume({ volume })
    videoPlayerApp.config.setVolume(volume)
  })

  ipcMain.on('control-hdr', async (_event, enabled: boolean) => {
    await videoPlayerApp.setHdrEnabled(enabled)
  })

  // 全屏切换（来自控制栏按钮）
  ipcMain.on('control-toggle-fullscreen', () => {
    const videoWindow = windowManager.getWindow('video')
    if (!videoWindow) return

    const controlWindow = (videoPlayerApp as any).controlWindow as BrowserWindow | null

    // 仅由控制栏按钮维护的“播放器全屏模式”开关
    isFullscreen = !isFullscreen

    // 切换视频窗口全屏
    videoWindow.setFullScreen(isFullscreen)

    // Windows 双窗口模式下，控制窗口也需要同步全屏状态
    if (process.platform === 'win32' && controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.setFullScreen(isFullscreen)
    }
  })

  // 窗口控制（来自控制栏左侧三个按钮）
  ipcMain.on('control-window-action', (_event, action: 'close' | 'minimize' | 'maximize') => {
    const videoWindow = windowManager.getWindow('video')
    if (!videoWindow) return

    // Windows 双窗口模式下，优先使用控制窗口作为操作目标
    const controlWindow = (videoPlayerApp as any).controlWindow as BrowserWindow | null
    const targetForMaximize =
      process.platform === 'win32' && controlWindow && !controlWindow.isDestroyed()
        ? controlWindow
        : videoWindow

    switch (action) {
      case 'close':
        // 关闭视频窗口，由视频窗口的关闭逻辑统一处理控制窗口
        videoWindow.close()
        break
      case 'minimize':
        // 最小化视频窗口（父窗口），控制窗口会跟随
        if (videoWindow.isMinimizable()) {
          videoWindow.minimize()
        }
        break
      case 'maximize':
        // mac：直接最大化视频窗口
        // win：最大化控制窗口，由同步逻辑驱动视频窗口一起变化
        if (targetForMaximize.isMaximizable()) {
          if (targetForMaximize.isMaximized()) {
            targetForMaximize.unmaximize()
          } else {
            targetForMaximize.maximize()
          }
        }
        break
    }
  })

  ipcMain.on('set-playlist', async (_event, items: PlaylistItem[]) => {
    videoPlayerApp.playlist.setList(items)
    corePlayer.broadcastToPlaybackUIs('playlist-updated', items)
  })

  ipcMain.on('play-playlist-current', async () => {
    await videoPlayerApp.playCurrentFromPlaylist()
  })

  ipcMain.on('play-playlist-next', async () => {
    await videoPlayerApp.playNextFromPlaylist()
  })

  ipcMain.on('play-playlist-prev', async () => {
    await videoPlayerApp.playPrevFromPlaylist()
  })

  ipcMain.on('control-keypress', async (_event, key: string) => {
    await videoPlayerApp.sendKey(key)
  })

  ipcMain.on('debug-hdr-status', async () => {
    await corePlayer.debugVideoState()
    await corePlayer.debugHdrStatus()
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

  // 控制栏自动隐藏 - 鼠标移动
  ipcMain.on('control-bar-mouse-move', (event) => {
    // 转发到 ControlView（可能是 BrowserView 或 BrowserWindow）
    const videoWindow = windowManager.getWindow('video')
    if (!videoWindow) return
    
    if (process.platform === 'darwin') {
      // macOS: BrowserView 模式
      const controlView = (videoPlayerApp as any).controlView
      if (controlView && !controlView.webContents.isDestroyed()) {
        controlView.webContents.send('control-bar-show')
      }
    } else if (process.platform === 'win32') {
      // Windows: BrowserWindow 模式
      const controlWindow = (videoPlayerApp as any).controlWindow
      if (controlWindow && !controlWindow.isDestroyed() && controlWindow.webContents) {
        controlWindow.webContents.send('control-bar-show')
      }
    }
  })

  // 控制栏自动隐藏 - 鼠标离开
  ipcMain.on('control-bar-mouse-leave', (event) => {
    // 转发到 ControlView
    const videoWindow = windowManager.getWindow('video')
    if (!videoWindow) return
    
    if (process.platform === 'darwin') {
      // macOS: BrowserView 模式
      const controlView = (videoPlayerApp as any).controlView
      if (controlView && !controlView.webContents.isDestroyed()) {
        controlView.webContents.send('control-bar-schedule-hide')
      }
    } else if (process.platform === 'win32') {
      // Windows: BrowserWindow 模式
      const controlWindow = (videoPlayerApp as any).controlWindow
      if (controlWindow && !controlWindow.isDestroyed() && controlWindow.webContents) {
        controlWindow.webContents.send('control-bar-schedule-hide')
      }
    }
  })

  // 测试语义化重构的领域模型（开发模式）
  ipcMain.on('test-semantic-refactoring', async () => {
    if (process.env.NODE_ENV === 'development') {
      try {
        const { testDomainModels } = await import('./test_semantic_refactoring')
        await testDomainModels()
        console.log('[Test] ✅ 语义化重构测试完成，查看控制台输出')
      } catch (error) {
        console.error('[Test] ❌ 测试失败:', error)
      }
    }
  })
}
