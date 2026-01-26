/**
 * 挂载路径管理服务
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { readdir, stat, open } from 'fs/promises'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'

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
 * 视频文件扩展名（用于快速预筛选）
 */
const VIDEO_EXTENSIONS = [
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  'ts', 'm2ts', 'mts', 'm3u8', 'mpg', 'mpeg', 'vob', 'ogv',
  'rmvb', '3gp', 'asf', 'divx', 'xvid', 'f4v', 'rm', 'rmvb'
]

/**
 * 非视频文件扩展名黑名单（避免不必要的文件读取）
 */
const NON_VIDEO_EXTENSIONS = [
  'asar', 'app', 'dmg', 'pkg', 'zip', 'rar', '7z', 'tar', 'gz',
  'exe', 'dll', 'so', 'dylib', 'framework', 'bundle',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'ico', 'webp',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma',
  'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts',
  'db', 'sqlite', 'sqlite3', 'log', 'lock'
]

/**
 * 视频文件的 MIME 类型
 */
const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/x-msvideo', // AVI
  'video/x-matroska', // MKV
  'video/quicktime', // MOV
  'video/x-ms-wmv', // WMV
  'video/x-flv', // FLV
  'video/webm', // WebM
  'video/mp2t', // TS
  'video/mpeg', // MPEG
  'video/x-msvideo', // AVI
  'application/vnd.apple.mpegurl', // M3U8
  'application/x-mpegURL', // M3U8
  'video/3gpp', // 3GP
  'video/x-ms-asf', // ASF
  'video/ogg', // OGV
  'video/x-msvideo' // AVI
]

/**
 * 视频文件的文件头（Magic Bytes）
 * 格式: [文件头字节数组, MIME类型]
 */
const VIDEO_FILE_SIGNATURES: Array<[number[], string]> = [
  // MP4 (ftyp box)
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  [[0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70], 'video/mp4'],
  // AVI (RIFF...AVI)
  [[0x52, 0x49, 0x46, 0x46], 'video/x-msvideo'], // 需要检查偏移量
  // MKV (1A 45 DF A3)
  [[0x1A, 0x45, 0xDF, 0xA3], 'video/x-matroska'],
  // MOV/QuickTime (ftyp)
  [[0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], 'video/quicktime'],
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], 'video/quicktime'],
  // WMV (30 26 B2 75 8E 66 CF 11)
  [[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11], 'video/x-ms-wmv'],
  // FLV (46 4C 56)
  [[0x46, 0x4C, 0x56, 0x01], 'video/x-flv'],
  // WebM (1A 45 DF A3)
  [[0x1A, 0x45, 0xDF, 0xA3], 'video/webm'],
  // MPEG (00 00 01 BA 或 00 00 01 B3)
  [[0x00, 0x00, 0x01, 0xBA], 'video/mpeg'],
  [[0x00, 0x00, 0x01, 0xB3], 'video/mpeg'],
  // TS (47开头，每188字节一个包)
  [[0x47], 'video/mp2t'],
  // 3GP (00 00 00 20 66 74 79 70 33 67)
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67], 'video/3gpp'],
  // OGV (OggS)
  [[0x4F, 0x67, 0x67, 0x53], 'video/ogg'],
  // RM/RMVB (2E 52 4D 46)
  [[0x2E, 0x52, 0x4D, 0x46], 'video/vnd.rn-realvideo'],
  // ASF (30 26 B2 75 8E 66 CF 11)
  [[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11], 'video/x-ms-asf']
]

/**
 * 读取文件的前几个字节（用于检测文件类型）
 */
async function readFileHeader(filePath: string, bytes: number = 64): Promise<Buffer | null> {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    fileHandle = await open(filePath, 'r')
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await fileHandle.read(buffer, 0, bytes, 0)
    return bytesRead > 0 ? buffer.slice(0, bytesRead) : null
  } catch (error) {
    // 静默处理错误，不输出警告（可能是 .asar 等特殊文件）
    return null
  } finally {
    if (fileHandle !== null) {
      await fileHandle.close()
    }
  }
}

/**
 * 通过文件头检测 MIME 类型
 */
async function detectMimeType(filePath: string): Promise<string | null> {
  const header = await readFileHeader(filePath, 64)
  if (!header) {
    return null
  }

  const headerBytes = Array.from(header)

  // 检查所有已知的视频文件签名
  for (const [signature, mimeType] of VIDEO_FILE_SIGNATURES) {
    if (headerBytes.length < signature.length) {
      continue
    }

    // 对于 AVI，需要检查偏移量 8 处是否为 "AVI "
    if (mimeType === 'video/x-msvideo' && signature[0] === 0x52) {
      if (headerBytes[0] === 0x52 && headerBytes[1] === 0x49 && 
          headerBytes[2] === 0x46 && headerBytes[3] === 0x46 &&
          headerBytes.length >= 12 &&
          headerBytes[8] === 0x41 && headerBytes[9] === 0x56 && 
          headerBytes[10] === 0x49 && headerBytes[11] === 0x20) {
        return mimeType
      }
      continue
    }

    // 对于 TS，检查前几个字节是否为 0x47（TS 包同步字节）
    if (mimeType === 'video/mp2t' && signature[0] === 0x47) {
      // TS 文件通常以 0x47 开头，且每 188 字节重复
      if (headerBytes[0] === 0x47 && 
          (headerBytes.length < 188 || headerBytes[188] === 0x47)) {
        return mimeType
      }
      continue
    }

    // 对于 MP4/MOV，检查 ftyp box
    if ((mimeType === 'video/mp4' || mimeType === 'video/quicktime') && 
        signature[4] === 0x66 && signature[5] === 0x74 && 
        signature[6] === 0x79 && signature[7] === 0x70) {
      // 检查前4个字节是否为 box size，第5-8字节是否为 "ftyp"
      const boxSize = (headerBytes[0] << 24) | (headerBytes[1] << 16) | 
                     (headerBytes[2] << 8) | headerBytes[3]
      if (boxSize > 0 && boxSize <= 64 &&
          headerBytes[4] === 0x66 && headerBytes[5] === 0x74 && 
          headerBytes[6] === 0x79 && headerBytes[7] === 0x70) {
        // 检查 brand（第9-12字节）
        const brand = String.fromCharCode(
          headerBytes[8], headerBytes[9], headerBytes[10], headerBytes[11]
        )
        if (brand === 'qt  ' || brand === 'isom' || brand === 'mp41' || 
            brand === 'mp42' || brand === 'avc1' || brand === 'M4V ') {
          return mimeType
        }
      }
      continue
    }

    // 标准匹配：检查签名是否匹配
    let matches = true
    for (let i = 0; i < signature.length; i++) {
      if (headerBytes[i] !== signature[i]) {
        matches = false
        break
      }
    }
    if (matches) {
      return mimeType
    }
  }

  return null
}

/**
 * 检查文件是否为视频文件（通过扩展名和 MIME 类型）
 */
async function isVideoFile(filePath: string, fileName: string): Promise<boolean> {
  // 首先快速检查扩展名（性能优化）
  const ext = fileName.split('.').pop()?.toLowerCase()
  
  // 如果扩展名在黑名单中，直接返回 false（避免不必要的文件读取）
  if (ext && NON_VIDEO_EXTENSIONS.includes(ext)) {
    return false
  }
  
  if (ext && VIDEO_EXTENSIONS.includes(ext)) {
    // 如果扩展名匹配，再通过 MIME 类型确认（更准确）
    try {
      const mimeType = await detectMimeType(filePath)
      if (mimeType && VIDEO_MIME_TYPES.includes(mimeType)) {
        return true
      }
    } catch (error) {
      // 如果 MIME 类型检测失败（如 .asar 文件），但扩展名匹配，仍然认为是视频文件
      // （可能是文件头损坏或格式特殊，或者是无法读取的特殊文件）
    }
    // 如果扩展名匹配但 MIME 类型检测失败，仍然认为是视频文件
    // （可能是文件头损坏或格式特殊）
    return true
  }

  // 如果扩展名不匹配，尝试通过 MIME 类型检测
  try {
    const mimeType = await detectMimeType(filePath)
    if (mimeType && VIDEO_MIME_TYPES.includes(mimeType)) {
      return true
    }
  } catch (error) {
    // 如果无法读取文件（如 .asar），返回 false
    return false
  }

  return false
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
        } else if (entry.isFile()) {
          // 通过 MIME 类型检测是否为视频文件
          const isVideo = await isVideoFile(fullPath, entry.name)
          if (isVideo) {
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
  private readonly configPath: string

  constructor() {
    // 获取配置文件路径
    const userData = app.getPath('userData')
    this.configPath = join(userData, 'mount-paths.json')
    
    // 加载已保存的挂载路径
    this.loadMountPaths()
  }

  /**
   * 加载已保存的挂载路径
   */
  private loadMountPaths(): void {
    try {
      if (!existsSync(this.configPath)) {
        return
      }
      const raw = readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.mountPaths)) {
        data.mountPaths.forEach((mp: any) => {
          // 转换日期字符串为 Date 对象
          const mountPath: MountPath = {
            id: mp.id,
            path: mp.path,
            resourceCount: mp.resourceCount || 0,
            lastScanned: mp.lastScanned ? new Date(mp.lastScanned) : undefined,
            autoScan: mp.autoScan !== undefined ? mp.autoScan : true
          }
          this.mountPaths.set(mountPath.id, mountPath)
        })
      }
    } catch (error) {
      console.error('加载挂载路径失败:', error)
    }
  }

  /**
   * 保存挂载路径到文件
   */
  private saveMountPaths(): void {
    try {
      const mountPathsArray = Array.from(this.mountPaths.values())
      const data = {
        mountPaths: mountPathsArray.map(mp => ({
          id: mp.id,
          path: mp.path,
          resourceCount: mp.resourceCount,
          lastScanned: mp.lastScanned?.toISOString(),
          autoScan: mp.autoScan
        }))
      }
      writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error('保存挂载路径失败:', error)
    }
  }

  /**
   * 设置主窗口（用于发送IPC消息）
   */
  setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window
    // 窗口设置后，发送当前挂载路径列表
    if (window && !window.isDestroyed()) {
      const mountPaths = this.getAllMountPaths()
      window.webContents.send('mount-paths-updated', { mountPaths })
    }
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
    
    // 保存到文件
    this.saveMountPaths()

    // 发送IPC消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mount-path-added', {
        mountPath,
        resources
      })
      // 同时发送更新后的列表
      this.mainWindow.webContents.send('mount-paths-updated', {
        mountPaths: this.getAllMountPaths()
      })
    }

    return mountPath
  }

  /**
   * 移除挂载路径
   */
  removeMountPath(id: string): boolean {
    const removed = this.mountPaths.delete(id)
    
    if (removed) {
      // 保存到文件
      this.saveMountPaths()
      
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('mount-path-removed', { id })
        // 同时发送更新后的列表
        this.mainWindow.webContents.send('mount-paths-updated', {
          mountPaths: this.getAllMountPaths()
        })
      }
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
    
    // 保存到文件
    this.saveMountPaths()

    // 发送IPC消息到渲染进程
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mount-path-scanned', {
        id,
        resources
      })
      // 同时发送更新后的列表
      this.mainWindow.webContents.send('mount-paths-updated', {
        mountPaths: this.getAllMountPaths()
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
