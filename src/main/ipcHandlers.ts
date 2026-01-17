import { ipcMain, dialog } from 'electron'
import { windowManager } from './main'
import { videoPlayerApp, PlaylistItem } from './videoPlayerApp'
import { corePlayer } from './corePlayer'
import { handlePlayMedia } from './playbackController'

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
    const items = videoPlayerApp.playlist.getList()
    event.reply('playlist-updated', items)
  })

  // 处理播放控制 - 暂停
  ipcMain.on('control-pause', async () => {
    await videoPlayerApp.pause()
  })

  // 处理播放控制 - 播放
  ipcMain.on('control-play', async () => {
    await videoPlayerApp.resume()
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
    await videoPlayerApp.stop()
  })

  // 处理播放控制 - 跳转
  ipcMain.on('control-seek', async (_event, time: number) => {
    await videoPlayerApp.seek(time)
  })

  // 处理音量控制
  ipcMain.on('control-volume', async (_event, volume: number) => {
    await videoPlayerApp.setVolume(volume)
  })

  ipcMain.on('control-hdr', async (_event, enabled: boolean) => {
    await videoPlayerApp.setHdrEnabled(enabled)
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
