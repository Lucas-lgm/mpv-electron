/**
 * IPC 相关常量定义
 * 
 * 集中管理所有 IPC 通道名称和配置常量，提高代码可维护性。
 */

/**
 * IPC 通道名称常量
 */
export const IPC_CHANNELS = {
  // 文件操作
  SELECT_VIDEO_FILE: 'select-video-file',
  PLAY_VIDEO: 'play-video',
  PLAY_URL: 'play-url',
  
  // 播放控制
  CONTROL_PAUSE: 'control-pause',
  CONTROL_PLAY: 'control-play',
  CONTROL_STOP: 'control-stop',
  CONTROL_SEEK: 'control-seek',
  CONTROL_VOLUME: 'control-volume',
  CONTROL_HDR: 'control-hdr',
  CONTROL_KEYPRESS: 'control-keypress',
  
  // 播放列表
  GET_PLAYLIST: 'get-playlist',
  SET_PLAYLIST: 'set-playlist',
  PLAY_PLAYLIST_CURRENT: 'play-playlist-current',
  PLAY_PLAYLIST_NEXT: 'play-playlist-next',
  PLAY_PLAYLIST_PREV: 'play-playlist-prev',
  
  // 窗口操作
  CONTROL_TOGGLE_FULLSCREEN: 'control-toggle-fullscreen',
  CONTROL_WINDOW_ACTION: 'control-window-action',
  
  // 视频事件
  VIDEO_TIME_UPDATE: 'video-time-update',
  VIDEO_ENDED: 'video-ended',
  
  // 控制栏
  CONTROL_BAR_MOUSE_MOVE: 'control-bar-mouse-move',
  CONTROL_BAR_MOUSE_LEAVE: 'control-bar-mouse-leave',
  
  // 挂载路径
  SELECT_MOUNT_PATH: 'select-mount-path',
  MOUNT_PATH_ADD: 'mount-path-add',
  MOUNT_PATH_REMOVE: 'mount-path-remove',
  MOUNT_PATH_REFRESH: 'mount-path-refresh',
  GET_MOUNT_PATHS: 'get-mount-paths',
  
  // 目录扫描
  SCAN_DIRECTORY: 'scan-directory',
  
  // NAS 连接
  NAS_TEST_CONNECTION: 'nas-test-connection',
  NAS_ADD: 'nas-add',
  NAS_REMOVE: 'nas-remove',
  NAS_REFRESH: 'nas-refresh',
  GET_NAS_CONNECTIONS: 'get-nas-connections',
  
  // NAS 文件系统
  NAS_READ_DIRECTORY: 'nas-read-directory',
  NAS_OPEN_SHARE: 'nas-open-share',
  NAS_DISCOVER_SERVERS: 'nas-discover-servers',
  NAS_LIST_SHARES: 'nas-list-shares',
  NAS_OPEN_NETWORK_BROWSER: 'nas-open-network-browser',
  
  // 调试
  DEBUG_HDR_STATUS: 'debug-hdr-status',
  TEST_SEMANTIC_REFACTORING: 'test-semantic-refactoring'
} as const

/**
 * IPC 响应通道名称常量
 */
export const IPC_RESPONSE_CHANNELS = {
  // 播放列表
  PLAYLIST_UPDATED: 'playlist-updated',
  
  // 挂载路径
  MOUNT_PATH_ERROR: 'mount-path-error',
  MOUNT_PATHS_UPDATED: 'mount-paths-updated',
  DIRECTORY_SCANNED: 'directory-scanned',
  DIRECTORY_SCAN_ERROR: 'directory-scan-error',
  
  // NAS 连接
  NAS_TEST_CONNECTION_RESULT: 'nas-test-connection-result',
  NAS_CONNECTION_ERROR: 'nas-connection-error',
  NAS_CONNECTIONS_UPDATED: 'nas-connections-updated',
  NAS_CONNECTION_ADDED: 'nas-connection-added',
  NAS_CONNECTION_SCANNED: 'nas-connection-scanned',
  
  // NAS 文件系统
  NAS_DIRECTORY_READ_RESULT: 'nas-directory-read-result',
  NAS_OPEN_SHARE_RESULT: 'nas-open-share-result',
  NAS_DISCOVER_SERVERS_RESULT: 'nas-discover-servers-result',
  NAS_LIST_SHARES_RESULT: 'nas-list-shares-result',
  NAS_OPEN_NETWORK_BROWSER_RESULT: 'nas-open-network-browser-result'
} as const

/**
 * 视频文件扩展名常量
 */
export const VIDEO_FILE_EXTENSIONS = [
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 
  'ts', 'm2ts', 'mts', 'm3u8'
] as const

/**
 * 窗口检查配置常量
 */
export const WINDOW_CHECK_CONFIG = {
  /** 最大重试次数 */
  MAX_RETRIES: 10,
  /** 重试间隔（毫秒） */
  RETRY_INTERVAL_MS: 100
} as const
