import type { VideoPlayerApp } from '../videoPlayerApp'
import type { CorePlayer } from '../core/corePlayer'
import { setupServices } from './handlers/serviceSetup'
import { setupFileHandlers } from './handlers/fileHandlers'
import { setupPlaybackHandlers } from './handlers/playbackHandlers'
import { setupPlaylistHandlers } from './handlers/playlistHandlers'
import { setupWindowHandlers } from './handlers/windowHandlers'
import { setupVideoEventHandlers } from './handlers/videoEventHandlers'
import { setupControlBarHandlers } from './handlers/controlBarHandlers'
import { setupMountPathHandlers } from './handlers/mountPathHandlers'
import { setupNasHandlers } from './handlers/nasHandlers'
import { setupDebugHandlers } from './handlers/debugHandlers'

/**
 * IPC 协议适配层：只做路由、参数解析、调用 App 方法、event.reply
 * 不包含业务逻辑、不持有状态、不直接发送业务广播
 * 
 * 按功能域拆分为多个 handler 模块，主文件作为统一注册入口
 */
export function setupIpcHandlers(videoPlayerApp: VideoPlayerApp, corePlayer: CorePlayer) {
  // 初始化服务的主窗口设置
  setupServices(videoPlayerApp)

  // 按功能域注册所有 handlers
  setupFileHandlers(videoPlayerApp)
  setupPlaybackHandlers(videoPlayerApp, corePlayer)
  setupPlaylistHandlers(videoPlayerApp)
  setupWindowHandlers(videoPlayerApp)
  setupVideoEventHandlers(videoPlayerApp)
  setupControlBarHandlers(videoPlayerApp)
  setupMountPathHandlers()
  setupNasHandlers()
  setupDebugHandlers(corePlayer)
}
