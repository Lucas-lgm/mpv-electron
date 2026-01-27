import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { VideoPlayerApp, PlaylistItem } from '../videoPlayerApp'
import type { CorePlayer } from '../core/corePlayer'
import { mountPathService } from '../services/mountPathService'
import { nasService } from '../services/nasService'
import { createLogger } from '../../infrastructure/logging'
import { createIpcHandler } from './ipcErrorHandler'
import { IPC_CHANNELS, IPC_RESPONSE_CHANNELS, VIDEO_FILE_EXTENSIONS, WINDOW_CHECK_CONFIG } from './ipcConstants'
import type {
  PlayVideoRequest,
  SetPlaylistRequest,
  ControlSeekRequest,
  ControlVolumeRequest,
  ControlHdrRequest,
  ControlWindowActionRequest,
  MountPathAddRequest,
  MountPathRemoveRequest,
  MountPathRefreshRequest,
  ScanDirectoryRequest,
  NasTestConnectionRequest,
  NasAddRequest,
  NasRemoveRequest,
  NasRefreshRequest,
  NasReadDirectoryRequest,
  NasOpenShareRequest,
  NasListSharesRequest
} from './ipcTypes'

const logger = createLogger('IpcHandlers')

/**
 * 设置服务的主窗口
 * 
 * 当主窗口创建或准备好时，将窗口实例设置到相关服务中。
 * 
 * @param mainWindow 主窗口实例
 */
function setupServicesMainWindow(mainWindow: BrowserWindow | undefined): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  try {
    mountPathService.setMainWindow(mainWindow)
    nasService.setMainWindow(mainWindow)
    logger.debug('Services main window set successfully')
  } catch (error) {
    logger.error('Failed to set services main window', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * IPC 协议适配层：只做路由、参数解析、调用 App 方法、event.reply
 * 不包含业务逻辑、不持有状态、不直接发送业务广播
 */
export function setupIpcHandlers(videoPlayerApp: VideoPlayerApp, corePlayer: CorePlayer) {
  // 立即尝试设置主窗口（如果已创建）
  const mainWindow = videoPlayerApp.windowManager.getWindow('main')
  setupServicesMainWindow(mainWindow)
  
  // 监听主窗口创建事件，使用事件而不是硬编码延迟
  // 这样更可靠，避免了竞态条件和不确定的延迟时间
  const windowManager = videoPlayerApp.windowManager
  
  // 如果窗口还未创建，监听窗口创建事件
  if (!mainWindow) {
    // 通过监听 windowManager 的窗口创建来设置服务
    // 注意：这里假设 windowManager 会在窗口创建后立即设置
    // 如果 windowManager 没有事件机制，我们需要在窗口 ready-to-show 时设置
    
    // 使用轮询检查窗口是否已创建（临时方案，直到有更好的事件机制）
    // 但限制最大尝试次数，避免无限循环
    
    let retryCount = 0
    const checkWindow = setInterval(() => {
      retryCount++
      const window = windowManager.getWindow('main')
      
      if (window) {
        clearInterval(checkWindow)
        setupServicesMainWindow(window)
        
        // 监听窗口的 ready-to-show 事件，确保窗口完全准备好
        window.once('ready-to-show', () => {
          setupServicesMainWindow(window)
        })
      } else if (retryCount >= WINDOW_CHECK_CONFIG.MAX_RETRIES) {
        clearInterval(checkWindow)
        logger.warn('Main window not created after maximum retries', {
          maxRetries: WINDOW_CHECK_CONFIG.MAX_RETRIES
        })
      }
    }, WINDOW_CHECK_CONFIG.RETRY_INTERVAL_MS)
  } else {
    // 如果窗口已存在，监听 ready-to-show 事件确保完全准备好
    mainWindow.once('ready-to-show', () => {
      setupServicesMainWindow(mainWindow)
    })
  }
  // 文件选择（薄编排：dialog → 调用 App 方法）
  ipcMain.on(IPC_CHANNELS.SELECT_VIDEO_FILE, createIpcHandler(
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: '视频文件', extensions: [...VIDEO_FILE_EXTENSIONS] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const fileName = filePath.split(/[/\\]/).pop() || '未知文件'
        videoPlayerApp.handleFileSelected({ name: fileName, path: filePath })
      }
    },
    undefined,
    IPC_CHANNELS.SELECT_VIDEO_FILE
  ))

  // 播放视频（路由到 App 的业务方法）
  ipcMain.on(IPC_CHANNELS.PLAY_VIDEO, createIpcHandler<[PlayVideoRequest]>(
    async (_event, file: PlayVideoRequest) => {
      await videoPlayerApp.handlePlayVideo(file)
    },
    undefined,
    IPC_CHANNELS.PLAY_VIDEO
  ))

  // 获取播放列表（reply）
  ipcMain.on(IPC_CHANNELS.GET_PLAYLIST, (event) => {
    event.reply(IPC_RESPONSE_CHANNELS.PLAYLIST_UPDATED, videoPlayerApp.getList())
  })

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

  // URL 播放（路由到 App 的业务方法）
  ipcMain.on(IPC_CHANNELS.PLAY_URL, createIpcHandler<[string]>(
    async (_event, url: string) => {
      await videoPlayerApp.handlePlayUrl(url)
    },
    undefined,
    IPC_CHANNELS.PLAY_URL
  ))

  // 窗口操作（路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.CONTROL_TOGGLE_FULLSCREEN, createIpcHandler(
    () => {
      videoPlayerApp.toggleFullscreen()
    },
    undefined,
    IPC_CHANNELS.CONTROL_TOGGLE_FULLSCREEN
  ))

  ipcMain.on(IPC_CHANNELS.CONTROL_WINDOW_ACTION, createIpcHandler<[ControlWindowActionRequest]>(
    (_event, data: ControlWindowActionRequest) => {
      videoPlayerApp.windowAction(data.action)
    },
    undefined,
    IPC_CHANNELS.CONTROL_WINDOW_ACTION
  ))

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

  // 其他控制（路由到 App 或 CorePlayer）
  ipcMain.on(IPC_CHANNELS.CONTROL_KEYPRESS, createIpcHandler<[string]>(
    async (_event, key: string) => {
      await videoPlayerApp.sendKey(key)
    },
    undefined,
    IPC_CHANNELS.CONTROL_KEYPRESS
  ))

  ipcMain.on(IPC_CHANNELS.DEBUG_HDR_STATUS, createIpcHandler(
    async () => {
      await corePlayer.debugVideoState()
      await corePlayer.debugHdrStatus()
    },
    undefined,
    IPC_CHANNELS.DEBUG_HDR_STATUS
  ))

  // 转发消息（renderer → main → video window，路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.VIDEO_TIME_UPDATE, (_event, data: { currentTime: number; duration: number }) => {
    videoPlayerApp.forwardVideoTimeUpdate(data)
  })

  ipcMain.on(IPC_CHANNELS.VIDEO_ENDED, () => {
    videoPlayerApp.forwardVideoEnded()
  })

  // 控制栏显示/隐藏（路由到 App 方法）
  ipcMain.on(IPC_CHANNELS.CONTROL_BAR_MOUSE_MOVE, () => {
    videoPlayerApp.showControlBar()
  })

  ipcMain.on(IPC_CHANNELS.CONTROL_BAR_MOUSE_LEAVE, () => {
    videoPlayerApp.scheduleHideControlBar()
  })

  // 挂载路径管理
  ipcMain.on(IPC_CHANNELS.SELECT_MOUNT_PATH, createIpcHandler(
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择要挂载的文件夹'
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const path = result.filePaths[0]
        await mountPathService.addMountPath(path)
      }
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.SELECT_MOUNT_PATH
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_ADD, createIpcHandler<[MountPathAddRequest]>(
    async (_event, data: MountPathAddRequest) => {
      await mountPathService.addMountPath(data.path)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_ADD
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_REMOVE, createIpcHandler<[MountPathRemoveRequest]>(
    (_event, data: MountPathRemoveRequest) => {
      mountPathService.removeMountPath(data.id)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_REMOVE
  ))

  ipcMain.on(IPC_CHANNELS.MOUNT_PATH_REFRESH, createIpcHandler<[MountPathRefreshRequest]>(
    async (_event, data: MountPathRefreshRequest) => {
      await mountPathService.refreshMountPath(data.id)
    },
    IPC_RESPONSE_CHANNELS.MOUNT_PATH_ERROR,
    IPC_CHANNELS.MOUNT_PATH_REFRESH
  ))

  ipcMain.on(IPC_CHANNELS.GET_MOUNT_PATHS, (event) => {
    const mountPaths = mountPathService.getAllMountPaths()
    event.reply(IPC_RESPONSE_CHANNELS.MOUNT_PATHS_UPDATED, { mountPaths })
  })

  // 扫描目录（独立功能，不挂载）
  ipcMain.on(IPC_CHANNELS.SCAN_DIRECTORY, createIpcHandler<[ScanDirectoryRequest]>(
    async (event, data: ScanDirectoryRequest) => {
      // 使用mountPathService的内部方法扫描
      const mountPath = await mountPathService.addMountPath(data.path)
      if (mountPath) {
        // 获取扫描到的资源（通过mount-path-added事件已经发送）
        event.reply(IPC_RESPONSE_CHANNELS.DIRECTORY_SCANNED, { path: data.path, mountPathId: mountPath.id })
      }
    },
    IPC_RESPONSE_CHANNELS.DIRECTORY_SCAN_ERROR,
    IPC_CHANNELS.SCAN_DIRECTORY
  ))

  // NAS 连接管理
  ipcMain.on(IPC_CHANNELS.NAS_TEST_CONNECTION, createIpcHandler<[NasTestConnectionRequest]>(
    async (event, data: NasTestConnectionRequest) => {
      const result = await nasService.testConnection(data.config)
      event.reply(IPC_RESPONSE_CHANNELS.NAS_TEST_CONNECTION_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_TEST_CONNECTION_RESULT,
    IPC_CHANNELS.NAS_TEST_CONNECTION
  ))

  ipcMain.on(IPC_CHANNELS.NAS_ADD, createIpcHandler<[NasAddRequest]>(
    async (event, data: NasAddRequest) => {
      await nasService.addNasConnection(data.name, data.config)
      // 成功消息通过 nas-connection-added 事件发送
    },
    IPC_RESPONSE_CHANNELS.NAS_CONNECTION_ERROR,
    IPC_CHANNELS.NAS_ADD
  ))

  ipcMain.on(IPC_CHANNELS.NAS_REMOVE, createIpcHandler<[NasRemoveRequest]>(
    (_event, data: NasRemoveRequest) => {
      nasService.removeNasConnection(data.id)
    },
    IPC_RESPONSE_CHANNELS.NAS_CONNECTION_ERROR,
    IPC_CHANNELS.NAS_REMOVE
  ))

  ipcMain.on(IPC_CHANNELS.NAS_REFRESH, createIpcHandler<[NasRefreshRequest]>(
    async (event, data: NasRefreshRequest) => {
      await nasService.refreshNasConnection(data.id)
      // 成功消息通过 nas-connection-scanned 事件发送
    },
    IPC_RESPONSE_CHANNELS.NAS_CONNECTION_ERROR,
    IPC_CHANNELS.NAS_REFRESH
  ))

  ipcMain.on(IPC_CHANNELS.GET_NAS_CONNECTIONS, (event) => {
    const connections = nasService.getAllNasConnections()
    event.reply(IPC_RESPONSE_CHANNELS.NAS_CONNECTIONS_UPDATED, { connections })
  })

  // NAS 文件系统操作
  ipcMain.on(IPC_CHANNELS.NAS_READ_DIRECTORY, createIpcHandler<[NasReadDirectoryRequest]>(
    async (event, data: NasReadDirectoryRequest) => {
      const result = await nasService.readNasDirectory(data.connectionId, data.path)
      event.reply(IPC_RESPONSE_CHANNELS.NAS_DIRECTORY_READ_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_DIRECTORY_READ_RESULT,
    IPC_CHANNELS.NAS_READ_DIRECTORY
  ))

  // NAS 打开/挂载共享
  ipcMain.on(IPC_CHANNELS.NAS_OPEN_SHARE, createIpcHandler<[NasOpenShareRequest]>(
    async (event, data: NasOpenShareRequest) => {
      const result = await nasService.openSmbShare(data.connectionId)
      event.reply(IPC_RESPONSE_CHANNELS.NAS_OPEN_SHARE_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_OPEN_SHARE_RESULT,
    IPC_CHANNELS.NAS_OPEN_SHARE
  ))

  // NAS 网络发现
  ipcMain.on(IPC_CHANNELS.NAS_DISCOVER_SERVERS, createIpcHandler(
    async (event) => {
      const result = await nasService.discoverNetworkServers()
      event.reply(IPC_RESPONSE_CHANNELS.NAS_DISCOVER_SERVERS_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_DISCOVER_SERVERS_RESULT,
    IPC_CHANNELS.NAS_DISCOVER_SERVERS
  ))

  // NAS 列出服务器共享
  ipcMain.on(IPC_CHANNELS.NAS_LIST_SHARES, createIpcHandler<[NasListSharesRequest]>(
    async (event, data: NasListSharesRequest) => {
      const result = await nasService.listServerShares(
        data.protocol,
        data.host,
        data.username,
        data.password,
        data.useHttps,
        data.port
      )
      event.reply(IPC_RESPONSE_CHANNELS.NAS_LIST_SHARES_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_LIST_SHARES_RESULT,
    IPC_CHANNELS.NAS_LIST_SHARES
  ))

  // NAS 打开网络浏览
  ipcMain.on(IPC_CHANNELS.NAS_OPEN_NETWORK_BROWSER, createIpcHandler(
    async (event) => {
      const result = await nasService.openNetworkBrowser()
      event.reply(IPC_RESPONSE_CHANNELS.NAS_OPEN_NETWORK_BROWSER_RESULT, result)
    },
    IPC_RESPONSE_CHANNELS.NAS_OPEN_NETWORK_BROWSER_RESULT,
    IPC_CHANNELS.NAS_OPEN_NETWORK_BROWSER
  ))

  // 测试（开发模式，路由到测试模块）
  ipcMain.on(IPC_CHANNELS.TEST_SEMANTIC_REFACTORING, createIpcHandler(
    async () => {
      if (process.env.NODE_ENV === 'development') {
        const { testDomainModels } = await import('../../test_semantic_refactoring')
        await testDomainModels()
        logger.info('语义化重构测试完成，查看控制台输出')
      } else {
        logger.warn('测试功能仅在开发模式下可用')
      }
    },
    undefined,
    IPC_CHANNELS.TEST_SEMANTIC_REFACTORING
  ))
}
