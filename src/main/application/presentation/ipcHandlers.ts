import { ipcMain, dialog } from 'electron'
import type { VideoPlayerApp, PlaylistItem } from '../videoPlayerApp'
import type { CorePlayer } from '../core/corePlayer'

/**
 * IPC 协议适配层：只做路由、参数解析、调用 App 方法、event.reply
 * 不包含业务逻辑、不持有状态、不直接发送业务广播
 */
export function setupIpcHandlers(videoPlayerApp: VideoPlayerApp, corePlayer: CorePlayer) {
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
