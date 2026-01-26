import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { VideoPlayerApp, PlaylistItem } from '../videoPlayerApp'
import type { CorePlayer } from '../core/corePlayer'
import { mountPathService } from '../services/mountPathService'
import { nasService } from '../services/nasService'

/**
 * IPC 协议适配层：只做路由、参数解析、调用 App 方法、event.reply
 * 不包含业务逻辑、不持有状态、不直接发送业务广播
 */
export function setupIpcHandlers(videoPlayerApp: VideoPlayerApp, corePlayer: CorePlayer) {
  // 设置挂载路径服务的主窗口
  const mainWindow = videoPlayerApp.windowManager.getWindow('main')
  if (mainWindow) {
    mountPathService.setMainWindow(mainWindow)
    nasService.setMainWindow(mainWindow)
  }
  
  // 监听主窗口创建事件（延迟设置，因为窗口可能还未创建）
  setTimeout(() => {
    const mainWindow = videoPlayerApp.windowManager.getWindow('main')
    if (mainWindow) {
      mountPathService.setMainWindow(mainWindow)
      nasService.setMainWindow(mainWindow)
    }
  }, 1000)
  // 文件选择（薄编排：dialog → 调用 App 方法）
  ipcMain.on('select-video-file', async () => {
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
      videoPlayerApp.handleFileSelected({ name: fileName, path: filePath })
    }
  })

  // 播放视频（路由到 App 的业务方法）
  ipcMain.on('play-video', async (_event, file: { name: string; path: string }) => {
    await videoPlayerApp.handlePlayVideo(file)
  })

  // 获取播放列表（reply）
  ipcMain.on('get-playlist', (event) => {
    event.reply('playlist-updated', videoPlayerApp.getList())
  })

  // 播放控制（路由到 App 方法）
  ipcMain.on('control-pause', async () => {
    await videoPlayerApp.pausePlayback()
  })

  ipcMain.on('control-play', async () => {
    await videoPlayerApp.handleControlPlay()
  })

  ipcMain.on('control-stop', async () => {
    await videoPlayerApp.stopPlayback()
  })

  ipcMain.on('control-seek', async (_event, time: number) => {
    await videoPlayerApp.seek(time)
  })

  ipcMain.on('control-volume', async (_event, volume: number) => {
    await videoPlayerApp.setVolume(volume)
  })

  ipcMain.on('control-hdr', async (_event, enabled: boolean) => {
    await videoPlayerApp.setHdrEnabled(enabled)
  })

  // URL 播放（路由到 App 的业务方法）
  ipcMain.on('play-url', async (_event, url: string) => {
    await videoPlayerApp.handlePlayUrl(url)
  })

  // 窗口操作（路由到 App 方法）
  ipcMain.on('control-toggle-fullscreen', () => {
    videoPlayerApp.toggleFullscreen()
  })

  ipcMain.on('control-window-action', (_event, action: 'close' | 'minimize' | 'maximize') => {
    videoPlayerApp.windowAction(action)
  })

  // 播放列表操作（路由到 App 方法）
  ipcMain.on('set-playlist', async (_event, items: PlaylistItem[]) => {
    videoPlayerApp.setList(items)
    videoPlayerApp.broadcastPlaylistUpdated()
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

  // 其他控制（路由到 App 或 CorePlayer）
  ipcMain.on('control-keypress', async (_event, key: string) => {
    await videoPlayerApp.sendKey(key)
  })

  ipcMain.on('debug-hdr-status', async () => {
    await corePlayer.debugVideoState()
    await corePlayer.debugHdrStatus()
  })

  // 转发消息（renderer → main → video window，路由到 App 方法）
  ipcMain.on('video-time-update', (_event, data: { currentTime: number; duration: number }) => {
    videoPlayerApp.forwardVideoTimeUpdate(data)
  })

  ipcMain.on('video-ended', () => {
    videoPlayerApp.forwardVideoEnded()
  })

  // 控制栏显示/隐藏（路由到 App 方法）
  ipcMain.on('control-bar-mouse-move', () => {
    videoPlayerApp.showControlBar()
  })

  ipcMain.on('control-bar-mouse-leave', () => {
    videoPlayerApp.scheduleHideControlBar()
  })

  // 挂载路径管理
  ipcMain.on('select-mount-path', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要挂载的文件夹'
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0]
      try {
        await mountPathService.addMountPath(path)
      } catch (error) {
        console.error('添加挂载路径失败:', error)
        const mainWindow = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('main'))
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mount-path-error', {
            message: `添加挂载路径失败: ${error instanceof Error ? error.message : String(error)}`
          })
        }
      }
    }
  })

  ipcMain.on('mount-path-add', async (_event, data: { path: string }) => {
    try {
      await mountPathService.addMountPath(data.path)
    } catch (error) {
      console.error('添加挂载路径失败:', error)
      _event.reply('mount-path-error', {
        message: `添加挂载路径失败: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  })

  ipcMain.on('mount-path-remove', (_event, data: { id: string }) => {
    mountPathService.removeMountPath(data.id)
  })

  ipcMain.on('mount-path-refresh', async (_event, data: { id: string }) => {
    try {
      await mountPathService.refreshMountPath(data.id)
    } catch (error) {
      console.error('刷新扫描失败:', error)
      _event.reply('mount-path-error', {
        message: `刷新扫描失败: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  })

  ipcMain.on('get-mount-paths', (event) => {
    const mountPaths = mountPathService.getAllMountPaths()
    event.reply('mount-paths-updated', { mountPaths })
  })

  // 扫描目录（独立功能，不挂载）
  ipcMain.on('scan-directory', async (event, data: { path: string }) => {
    try {
      // 使用mountPathService的内部方法扫描
      const mountPath = await mountPathService.addMountPath(data.path)
      if (mountPath) {
        // 获取扫描到的资源（通过mount-path-added事件已经发送）
        event.reply('directory-scanned', { path: data.path, mountPathId: mountPath.id })
      }
    } catch (error) {
      console.error('扫描目录失败:', error)
      event.reply('directory-scan-error', {
        message: `扫描目录失败: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  })

  // NAS 连接管理
  ipcMain.on('nas-test-connection', async (event, data: { config: any }) => {
    try {
      const result = await nasService.testConnection(data.config)
      event.reply('nas-test-connection-result', result)
    } catch (error) {
      console.error('测试 NAS 连接失败:', error)
      event.reply('nas-test-connection-result', {
        success: false,
        error: error instanceof Error ? error.message : '连接测试失败'
      })
    }
  })

  ipcMain.on('nas-add', async (event, data: { name: string; config: any }) => {
    try {
      await nasService.addNasConnection(data.name, data.config)
      // 成功消息通过 nas-connection-added 事件发送
    } catch (error) {
      console.error('添加 NAS 连接失败:', error)
      event.reply('nas-connection-error', {
        message: `添加 NAS 连接失败: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  })

  ipcMain.on('nas-remove', (_event, data: { id: string }) => {
    nasService.removeNasConnection(data.id)
  })

  ipcMain.on('nas-refresh', async (event, data: { id: string }) => {
    try {
      await nasService.refreshNasConnection(data.id)
      // 成功消息通过 nas-connection-scanned 事件发送
    } catch (error) {
      console.error('刷新扫描失败:', error)
      event.reply('nas-connection-error', {
        message: `刷新扫描失败: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  })

  ipcMain.on('get-nas-connections', (event) => {
    const connections = nasService.getAllNasConnections()
    event.reply('nas-connections-updated', { connections })
  })

  // NAS 文件系统操作
  ipcMain.on('nas-read-directory', async (event, data: { connectionId: string; path?: string }) => {
    try {
      const result = await nasService.readNasDirectory(data.connectionId, data.path)
      event.reply('nas-directory-read-result', result)
    } catch (error) {
      console.error('读取 NAS 目录失败:', error)
      event.reply('nas-directory-read-result', {
        items: [],
        error: error instanceof Error ? error.message : '读取目录失败'
      })
    }
  })

  // NAS 打开/挂载共享
  ipcMain.on('nas-open-share', async (event, data: { connectionId: string }) => {
    try {
      const result = await nasService.openSmbShare(data.connectionId)
      event.reply('nas-open-share-result', result)
    } catch (error) {
      console.error('打开 NAS 共享失败:', error)
      event.reply('nas-open-share-result', {
        success: false,
        error: error instanceof Error ? error.message : '打开共享失败'
      })
    }
  })

  // 测试（开发模式，路由到测试模块）
  ipcMain.on('test-semantic-refactoring', async () => {
    if (process.env.NODE_ENV === 'development') {
      try {
        const { testDomainModels } = await import('../../test_semantic_refactoring')
        await testDomainModels()
        console.log('[Test] ✅ 语义化重构测试完成，查看控制台输出')
      } catch (error) {
        console.error('[Test] ❌ 测试失败:', error)
      }
    }
  })
}
