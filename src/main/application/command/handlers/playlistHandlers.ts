import { ipcMain } from 'electron'
import type { VideoPlayerApp, PlaylistItem } from '../../videoPlayerApp'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS, IPC_RESPONSE_CHANNELS } from '../ipcConstants'

/**
 * 播放列表相关的 IPC handlers
 */
export function setupPlaylistHandlers(videoPlayerApp: VideoPlayerApp): void {
  // 获取播放列表（reply）
  ipcMain.on(IPC_CHANNELS.GET_PLAYLIST, (event) => {
    event.reply(IPC_RESPONSE_CHANNELS.PLAYLIST_UPDATED, videoPlayerApp.getList())
  })

  // 播放列表操作（路由到 App 方法）
  // 注意：renderer 发送的是数组 items，而不是 { items: [...] }
  // 所以这里直接接收数组作为第一个参数
  ipcMain.on(IPC_CHANNELS.SET_PLAYLIST, createIpcHandler<[PlaylistItem[]]>(
    async (_event, items: PlaylistItem[]) => {
      // 确保 items 是数组
      if (!Array.isArray(items)) {
        throw new Error('Expected items to be an array')
      }
      videoPlayerApp.setList(items)
      videoPlayerApp.broadcastPlaylistUpdated()
    },
    undefined,
    IPC_CHANNELS.SET_PLAYLIST
  ))

  ipcMain.on(IPC_CHANNELS.PLAY_PLAYLIST_CURRENT, createIpcHandler(
    async () => {
      await videoPlayerApp.playCurrentFromPlaylist()
    },
    undefined,
    IPC_CHANNELS.PLAY_PLAYLIST_CURRENT
  ))

  ipcMain.on(IPC_CHANNELS.PLAY_PLAYLIST_NEXT, createIpcHandler(
    async () => {
      await videoPlayerApp.playNextFromPlaylist()
    },
    undefined,
    IPC_CHANNELS.PLAY_PLAYLIST_NEXT
  ))

  ipcMain.on(IPC_CHANNELS.PLAY_PLAYLIST_PREV, createIpcHandler(
    async () => {
      await videoPlayerApp.playPrevFromPlaylist()
    },
    undefined,
    IPC_CHANNELS.PLAY_PLAYLIST_PREV
  ))
}
