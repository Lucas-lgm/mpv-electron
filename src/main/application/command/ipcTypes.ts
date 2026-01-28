/**
 * IPC 消息类型定义
 * 
 * 定义所有 IPC 消息的请求和响应类型，确保类型安全。
 */

/**
 * 文件选择 IPC 消息
 */
export interface SelectVideoFileRequest {
  // 无参数
}

/**
 * 播放视频 IPC 消息
 */
export interface PlayVideoRequest {
  name: string
  path: string
  /**
   * 起播时间（秒，可选）
   * - 由前端传入，用于记忆播放 / 继续播放
   */
  startTime?: number
}

/**
 * 播放列表项类型
 */
export interface PlaylistItem {
  id: string
  name: string
  path: string
  source: 'local' | 'network' | 'nas' | 'mounted'
}

/**
 * 设置播放列表 IPC 消息
 */
export interface SetPlaylistRequest {
  items: PlaylistItem[]
}

/**
 * 控制操作 IPC 消息
 */
export interface ControlSeekRequest {
  time: number
}

export interface ControlVolumeRequest {
  volume: number
}

export interface ControlHdrRequest {
  enabled: boolean
}

export interface ControlWindowActionRequest {
  action: 'close' | 'minimize' | 'maximize'
}

/**
 * 挂载路径 IPC 消息
 */
export interface MountPathAddRequest {
  path: string
}

export interface MountPathRemoveRequest {
  id: string
}

export interface MountPathRefreshRequest {
  id: string
}

/**
 * 扫描目录 IPC 消息
 */
export interface ScanDirectoryRequest {
  path: string
}

/**
 * NAS 配置类型
 */
export interface NasConfig {
  protocol: 'smb' | 'webdav'
  host: string
  share?: string // SMB 协议必需，WebDAV 协议不需要
  username?: string
  password?: string
  port?: number // 默认 445 for SMB, 80/443 for WebDAV
  path?: string
  useHttps?: boolean // WebDAV 协议，是否使用 HTTPS
}

/**
 * NAS 连接 IPC 消息
 */
export interface NasTestConnectionRequest {
  config: NasConfig
}

export interface NasAddRequest {
  name: string
  config: NasConfig
}

export interface NasRemoveRequest {
  id: string
}

export interface NasRefreshRequest {
  id: string
}

export interface NasReadDirectoryRequest {
  connectionId: string
  path?: string
}

export interface NasOpenShareRequest {
  connectionId: string
}

export interface NasListSharesRequest {
  protocol: 'smb' | 'webdav'
  host: string
  username?: string
  password?: string
  useHttps?: boolean
  port?: number
}
