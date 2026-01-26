/**
 * 媒体资源类型定义
 */

/**
 * 资源来源类型
 */
export type ResourceSource = 'local' | 'network' | 'nas' | 'mounted'

/**
 * 媒体资源接口
 */
export interface MediaResource {
  /** 资源唯一ID */
  id: string
  /** 显示名称 */
  name: string
  /** 资源路径（本地路径或URL） */
  path: string
  /** 资源来源 */
  source: ResourceSource
  /** 挂载路径（如果来源是mounted） */
  mountPath?: string
  /** 视频时长（秒） */
  duration?: number
  /** 文件大小（字节） */
  size?: number
  /** 缩略图路径 */
  thumbnail?: string
  /** 添加时间 */
  addedAt?: Date
  /** 最后播放时间 */
  lastPlayedAt?: Date
  /** 是否收藏 */
  isFavorite?: boolean
}

/**
 * 资源筛选类型
 */
export type ResourceFilter = 'all' | 'local' | 'network' | 'nas' | string

/**
 * 视图模式
 */
export type ViewMode = 'grid' | 'list'
