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
