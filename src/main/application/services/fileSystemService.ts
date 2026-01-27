/**
 * 文件系统服务
 */
import { readdir, stat } from 'fs/promises'
import { join, dirname, extname, basename } from 'path'
import { existsSync } from 'fs'
import { createLogger } from '../../infrastructure/logging'

const logger = createLogger('FileSystemService')

/**
 * 视频文件扩展名
 */
const VIDEO_EXTENSIONS = [
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'ts', 'm2ts', 'mts', 'm3u8', 'mpg', 'mpeg', 'vob', 'ogv',
  'rmvb', '3gp', 'asf', 'divx', 'xvid', 'f4v', 'rm', 'rmvb'
]

export interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: Date
  isVideo?: boolean
  extension?: string
}

export interface DirectoryInfo {
  path: string
  parentPath?: string
  items: FileItem[]
  accessible: boolean
  error?: string
}

/**
 * 检查文件扩展名是否为视频文件
 */
function isVideoFile(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase().slice(1) // 移除点号
  return VIDEO_EXTENSIONS.includes(ext)
}

/**
 * 读取目录内容
 */
export async function readDirectory(dirPath: string): Promise<DirectoryInfo> {
  const result: DirectoryInfo = {
    path: dirPath,
    items: [],
    accessible: false
  }

  try {
    // 检查路径是否存在
    if (!existsSync(dirPath)) {
      result.error = `路径不存在: ${dirPath}`
      return result
    }

    // 获取父目录路径
    const parentPath = dirname(dirPath)
    if (parentPath !== dirPath) {
      result.parentPath = parentPath
    }

    // 读取目录内容
    const entries = await readdir(dirPath, { withFileTypes: true })

    // 处理每个条目
    const items: FileItem[] = []
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      
      try {
        const stats = await stat(fullPath)
        const isDirectory = entry.isDirectory()
        
        const item: FileItem = {
          name: entry.name,
          path: fullPath,
          type: isDirectory ? 'directory' : 'file',
          modifiedAt: stats.mtime,
          extension: isDirectory ? undefined : extname(entry.name).toLowerCase().slice(1)
        }

        if (!isDirectory) {
          item.size = stats.size
          item.isVideo = isVideoFile(entry.name)
        }

        items.push(item)
      } catch (error) {
        // 忽略无法访问的文件/目录
        logger.debug('无法访问文件/目录', {
          path: fullPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // 排序：文件夹在前，然后按名称排序
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    result.items = items
    result.accessible = true
  } catch (error) {
    result.error = error instanceof Error ? error.message : '读取目录失败'
    logger.error('读取目录失败', {
      path: dirPath,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return result
}

/**
 * 文件系统服务类
 */
export class FileSystemService {
  /**
   * 读取目录内容
   */
  async readDirectory(path: string): Promise<DirectoryInfo> {
    return await readDirectory(path)
  }

  /**
   * 检查路径是否存在
   */
  pathExists(path: string): boolean {
    return existsSync(path)
  }

  /**
   * 检查是否为视频文件
   */
  isVideoFile(fileName: string): boolean {
    return isVideoFile(fileName)
  }
}

// 单例
export const fileSystemService = new FileSystemService()
