import { ipcMain } from 'electron'
import type { VideoPlayerApp } from '../../videoPlayerApp'
import type { CorePlayer } from '../../core/corePlayer'
import { createIpcHandler } from '../ipcErrorHandler'
import { IPC_CHANNELS } from '../ipcConstants'
import type { PlayVideoRequest } from '../ipcTypes'

/**
 * 播放控制相关的 IPC handlers
 */
export function setupPlaybackHandlers(videoPlayerApp: VideoPlayerApp, corePlayer: CorePlayer): void {
  // 播放视频（路由到 App 的业务方法）
  ipcMain.on(IPC_CHANNELS.PLAY_VIDEO, createIpcHandler<[PlayVideoRequest]>(
    async (_event, file: PlayVideoRequest) => {
      await videoPlayerApp.handlePlayVideo(file)
    },
    undefined,
    IPC_CHANNELS.PLAY_VIDEO
  ))

  // URL 播放（路由到 App 的业务方法）
  ipcMain.on(IPC_CHANNELS.PLAY_URL, createIpcHandler<[string]>(
    async (_event, url: string) => {
      await videoPlayerApp.handlePlayUrl(url)
    },
    undefined,
    IPC_CHANNELS.PLAY_URL
  ))

  // 播放控制（路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.CONTROL_PAUSE, createIpcHandler(
    async () => {
      await videoPlayerApp.pausePlayback()
    },
    undefined,
    IPC_CHANNELS.CONTROL_PAUSE
  ))

  ipcMain.on(IPC_CHANNELS.CONTROL_PLAY, createIpcHandler(
    async () => {
      await videoPlayerApp.handleControlPlay()
    },
    undefined,
    IPC_CHANNELS.CONTROL_PLAY
  ))

  ipcMain.on(IPC_CHANNELS.CONTROL_STOP, createIpcHandler(
    async () => {
      await videoPlayerApp.stopPlayback()
    },
    undefined,
    IPC_CHANNELS.CONTROL_STOP
  ))

  // 注意：renderer 发送的是数字 time，而不是 { time: number }
  // 所以这里直接接收数字作为第一个参数
  ipcMain.on(IPC_CHANNELS.CONTROL_SEEK, createIpcHandler<[number]>(
    async (_event, time: number) => {
      // 确保 time 是有效的数字
      if (typeof time !== 'number' || isNaN(time) || time < 0) {
        throw new Error(`Invalid seek time: ${time}`)
      }
      await videoPlayerApp.seek(time)
    },
    undefined,
    IPC_CHANNELS.CONTROL_SEEK
  ))

  // 注意：renderer 发送的是数字 volume，而不是 { volume: number }
  ipcMain.on(IPC_CHANNELS.CONTROL_VOLUME, createIpcHandler<[number]>(
    async (_event, volume: number) => {
      // 确保 volume 是有效的数字
      if (typeof volume !== 'number' || isNaN(volume) || volume < 0 || volume > 100) {
        throw new Error(`Invalid volume: ${volume} (must be between 0 and 100)`)
      }
      await videoPlayerApp.setVolume(volume)
    },
    undefined,
    IPC_CHANNELS.CONTROL_VOLUME
  ))

  // 注意：renderer 发送的是布尔值 enabled，而不是 { enabled: boolean }
  ipcMain.on(IPC_CHANNELS.CONTROL_HDR, createIpcHandler<[boolean]>(
    async (_event, enabled: boolean) => {
      // 确保 enabled 是布尔值
      if (typeof enabled !== 'boolean') {
        throw new Error(`Invalid HDR enabled value: ${enabled} (must be boolean)`)
      }
      await videoPlayerApp.setHdrEnabled(enabled)
    },
    undefined,
    IPC_CHANNELS.CONTROL_HDR
  ))

  // 其他控制（路由到 App 或 CorePlayer）
  ipcMain.on(IPC_CHANNELS.CONTROL_KEYPRESS, createIpcHandler<[string]>(
    async (_event, key: string) => {
      await videoPlayerApp.sendKey(key)
    },
    undefined,
    IPC_CHANNELS.CONTROL_KEYPRESS
  ))
}
