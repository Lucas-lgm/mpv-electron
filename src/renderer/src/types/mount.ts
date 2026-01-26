/**
 * 挂载路径类型定义
 */

/**
 * 挂载路径接口
 */
export interface MountPath {
  /** 挂载路径唯一ID */
  id: string
  /** 路径 */
  path: string
  /** 资源数量 */
  resourceCount: number
  /** 最后扫描时间 */
  lastScanned?: Date
  /** 是否启用自动扫描 */
  autoScan?: boolean
}

/**
 * NAS 协议类型
 */
export type NasProtocol = 'smb'

/**
 * NAS 配置接口
 */
export interface NasConfig {
  /** 协议类型 */
  protocol: NasProtocol
  /** 主机地址（IP 或域名） */
  host: string
  /** 共享名称 */
  share: string
  /** 用户名（可选） */
  username?: string
  /** 密码（可选，加密存储） */
  password?: string
  /** 端口（可选，默认 445 for SMB） */
  port?: number
  /** 路径（可选，共享内的子路径） */
  path?: string
}

/**
 * NAS 连接接口
 */
export interface NasConnection {
  /** NAS 连接唯一ID */
  id: string
  /** 显示名称 */
  name: string
  /** NAS 配置 */
  config: NasConfig
  /** 资源数量 */
  resourceCount: number
  /** 最后扫描时间 */
  lastScanned?: Date
  /** 是否启用自动扫描 */
  autoScan?: boolean
  /** 连接状态 */
  status?: 'connected' | 'disconnected' | 'error'
  /** 错误信息 */
  error?: string
}
