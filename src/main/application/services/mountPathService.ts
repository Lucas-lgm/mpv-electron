/**
 * 挂载路径管理服务
 */
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { BrowserWindow } from 'electron'

export interface MountPath {
  id: string
  path: string
  resourceCount: number
  lastScanned?: Date
  autoScan?: boolean
}

export interface ScannedResource {
  id: string
  name: string
  path: string
  duration?: number
  size?: number
}

/**
 * 视频文件扩展名
 */
const VIDEO_EXTENSIONS = [
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'ts', 'm2ts', 'mts', 'm3u8', 'mpg', 'mpeg', 'vob', 'ogv'
]

/**
 * 检查文件是否为视频文件
 */
function isVideoFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext ? VIDEO_EXTENSIONS.includes(ext) : false
}

/**
 * 递归扫描目录中的视频文件
 */
export async function scanDirectory(dirPath: string, maxDepth: number = 5, currentDepth: number = 0): Promise<ScannedResource[]> {
  if (currentDepth >= maxDepth) {
    return []
  }

  const resources: ScannedResource[] = []

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      try {
        if (entry.isDirectory()) {
          // 递归扫描子目录
          const subResources = await scanDirectory(fullPath, maxDepth, currentDepth + 1)
          resources.push(...subResources)
        } else if (entry.isFile() && isVideoFile(entry.name)) {
          // 是视频文件，添加到资源列表
          const stats = await stat(fullPath)
          resources.push({
            id: `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: entry.name,
            path: fullPath,
            size: stats.size
            // duration 需要通过播放器获取，这里先不设置
          })
        }
      } catch (error) {
        // 忽略无法访问的文件/目录
        console.warn(`无法访问 ${fullPath}:`, error)
      }
    }
  } catch (error) {
    console.error(`扫描目录失败 ${dirPath}:`, error)
  }

  return resources
}

/**
 * 挂载路径服务
 */
export class MountPathService {
  private mountPaths: Map<string, MountPath> = new Map()
  private mainWindow: BrowserWindow | null = null

  /**
   * 设置主窗口（用于发送IPC消息）
   */
  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
  }

  /**
   * 添加挂载路径
   */
  async addMountPath(path: string): Promise<MountPath> {
    const id = `mount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // 扫描目录
    const resources = await scanDirectory(path)
    
    const mountPath: MountPath = {
      id,
      path,
      resourceCount: resources.length,
      lastScanned: new Date(),
      autoScan: true
    }

    this.mountPaths.set(id, mountPath)

    // 发送IPC消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mount-path-added', {
        mountPath,
        resources
      })
    }

    return mountPath
  }

  /**
   * 移除挂载路径
   */
  removeMountPath(id: string): boolean {
    const removed = this.mountPaths.delete(id)
    
    if (removed && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mount-path-removed', { id })
    }

    return removed
  }

  /**
   * 刷新扫描挂载路径
   */
  async refreshMountPath(id: string): Promise<void> {
    const mountPath = this.mountPaths.get(id)
    if (!mountPath) {
      throw new Error(`挂载路径不存在: ${id}`)
    }

    // 重新扫描目录
    const resources = await scanDirectory(mountPath.path)
    
    // 更新挂载路径信息
    mountPath.resourceCount = resources.length
    mountPath.lastScanned = new Date()

    // 发送IPC消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mount-path-scanned', {
        id,
        resources
      })
    }
  }

  /**
   * 获取所有挂载路径
   */
  getAllMountPaths(): MountPath[] {
    return Array.from(this.mountPaths.values())
  }

  /**
   * 获取挂载路径
   */
  getMountPath(id: string): MountPath | undefined {
    return this.mountPaths.get(id)
  }
}

// 单例
export const mountPathService = new MountPathService()
