import { EventEmitter } from 'events'
import * as path from 'path'

// 定义 native binding 的类型
interface MPVBinding {
  create(): number
  initialize(instanceId: number): boolean
  setOption(instanceId: number, name: string, value: string | number | boolean): boolean
  setWindowId(instanceId: number, windowId: number): boolean
  loadFile(instanceId: number, path: string): boolean
  getProperty(instanceId: number, name: string): any
  setProperty(instanceId: number, name: string, value: string | number | boolean): boolean
  command(instanceId: number, args: string[]): boolean
  // 事件现在会传递一个对象，包含 eventId / name / value 等
  setEventCallback(instanceId: number, callback: (event: any) => void): boolean
  attachView(instanceId: number, viewPtr: number): void
  setWindowSize(instanceId: number, width: number, height: number): void
  clearToBlack(instanceId: number): void
  destroy(instanceId: number): boolean
}

// 尝试加载 native binding
let mpvBinding: MPVBinding | null = null
try {
  // 尝试多个可能的路径（相对于编译后的 out/main 目录）
  // 在开发和生产环境中的不同路径
  const possiblePaths = [
    // 开发环境：从 out/main 到 native/build/Release
    path.join(__dirname, '../../native/build/Release/mpv_binding.node'),
    // 如果 native 在项目根目录
    path.join(__dirname, '../../../native/build/Release/mpv_binding.node'),
    // 生产环境可能的位置
    path.join(process.resourcesPath || __dirname, 'native/build/Release/mpv_binding.node'),
  ]
  
  for (const bindingPath of possiblePaths) {
    try {
      // @ts-ignore - native module
      mpvBinding = require(bindingPath)
      console.log('[libmpv] ✅ Native binding loaded from:', bindingPath)
      break
    } catch (e: any) {
      // 继续尝试下一个路径
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.warn('[libmpv] Error loading from', bindingPath, ':', e.message)
      }
    }
  }
  
  if (!mpvBinding) {
    console.warn('[libmpv] ⚠️ Native binding not found. Will use IPC mode.')
    console.warn('[libmpv] Tried paths:', possiblePaths)
  }
} catch (error: any) {
  console.warn('[libmpv] Native binding not available, falling back to IPC mode:', error.message)
}

export interface MPVStatus {
  paused: boolean
  position: number
  duration: number
  volume: number
  path: string | null
}

export class LibMPVController extends EventEmitter {
  private instanceId: number | null = null
  private currentStatus: MPVStatus = {
    paused: false,
    position: 0,
    duration: 0,
    volume: 100,
    path: null
  }

  constructor() {
    super()
    
    if (!mpvBinding) {
      throw new Error('libmpv native binding is not available. Please build the native module first.')
    }
  }

  /**
   * 初始化 MPV 实例
   */
  async initialize(): Promise<void> {
    if (this.instanceId !== null) {
      throw new Error('MPV instance already initialized')
    }

    try {
      // 创建实例（未初始化）
      this.instanceId = mpvBinding!.create()
      
      // 在初始化前设置选项（使用 render API 时，必须设置 vo=gpu，不能设置 wid）
      // 注意：libmpv 默认已经设置了 no-terminal，不需要再设置
      try {
        // 使用 GPU 渲染（render API 模式必需，这样 mpv 不会创建自己的窗口）
        await this.setOption('vo', 'libmpv')
        console.log('[libmpv] ✅ Set vo=libmpv for render API')
      } catch (error) {
        console.warn('[libmpv] Failed to set vo=libmpv:', error)
      }
      
      try {
        await this.setOption('no-osc', true)
      } catch (error) {
        // 忽略，可能不存在
      }
      
      // 启用 mpv 日志（verbose 级别，可以看到 letterbox 计算等详细信息）
      try {
        await this.setOption('log-level', 'v')
        console.log('[libmpv] ✅ Enabled mpv verbose logging')
      } catch (error) {
        console.warn('[libmpv] Failed to set log-level:', error)
      }
      
      try {
        await this.setOption('no-osd-bar', true)
      } catch (error) {
        // 忽略，可能不存在
      }
      
      // 现在初始化（初始化后不能再设置 vo 和 wid）
      mpvBinding!.initialize(this.instanceId)
      
      try {
        await this.setProperty('keepaspect', true)
        await this.setProperty('keepaspect-window', true)
        await this.setProperty('video-unscaled', 'no')
        await this.setProperty('video-aspect-override', '-1')
        await this.setProperty('panscan', 0)
        await this.setProperty('video-zoom', 0)
        await this.setProperty('video-scale-x', 1)
        await this.setProperty('video-scale-y', 1)
        console.log('[libmpv] ✅ Video scaling properties set')
      } catch (error) {
        console.warn('[libmpv] Failed to set video scaling properties:', error)
      }

      // 设置事件回调
      mpvBinding!.setEventCallback(this.instanceId, (event: any) => {
        // 处理日志消息
        if (event.eventId === 2 && event.logText) { // MPV_EVENT_LOG_MESSAGE = 2
          const prefix = event.logPrefix || ''
          const level = event.logLevel || ''
          const text = event.logText || ''
          // 只输出与视频渲染相关的日志（过滤掉太多噪音）
          if (text.includes('aspect') || text.includes('letterbox') || 
              text.includes('Video display') || text.includes('Window size') ||
              text.includes('Video borders') || text.includes('Video scale') ||
              text.includes('dst_rect') || text.includes('viewport') ||
              text.includes('resize') || text.includes('FBO') ||
              text.includes('OSD borders')) {
            console.log(`[mpv] [${level}] ${prefix}: ${text.trim()}`)
          }
        }
        // console.log('[libmpv] Event:', event)
        this.handleEvent(event)
      })
      
      this.emit('initialized')
    } catch (error) {
      throw new Error(`Failed to initialize MPV: ${error}`)
    }
  }

  /**
   * 设置窗口 ID（用于嵌入到 Electron 窗口）
   */
  async setWindowId(windowId: number): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      // B 方案：使用 render API，把 libmpv 绑定到 Electron 的 NSView 上
      mpvBinding!.attachView(this.instanceId, windowId)
      this.emit('window-set', windowId)
    } catch (error) {
      throw new Error(`Failed to set window ID: ${error}`)
    }
  }

  /**
   * 设置窗口尺寸（由 Electron 窗口大小变化时调用）
   * @param width 窗口宽度（像素）
   * @param height 窗口高度（像素）
   * 
   * 注意：新的 native 实现会自动处理 letterbox（保持宽高比），
   * 所以不需要手动设置 keepaspect 等属性。
   */
  async setWindowSize(width: number, height: number): Promise<void> {
    if (this.instanceId === null) {
      console.warn('[libmpv] Cannot set window size: MPV instance not initialized')
      return
    }

    try {
      // 调试：记录尺寸设置
      console.log(`[libmpv] Setting window size: ${width}x${height}`)
      
      // 获取当前视频尺寸用于调试
      try {
        const vidWidth = await this.getProperty('width')
        const vidHeight = await this.getProperty('height')
        if (vidWidth && vidHeight) {
          const vidAspect = Number(vidWidth) / Number(vidHeight)
          const winAspect = width / height
          console.log(`[libmpv] Video: ${vidWidth}x${vidHeight} (aspect=${vidAspect.toFixed(2)}), Window: ${width}x${height} (aspect=${winAspect.toFixed(2)})`)
          
          // 如果宽高比不匹配，确保 keepaspect 已设置
          if (Math.abs(vidAspect - winAspect) > 0.01) {
            console.log(`[libmpv] Aspect ratio mismatch, ensuring keepaspect is enabled`)
            await this.setProperty('keepaspect', true)
          }
        }
      } catch (e) {
        // 忽略，视频可能还没加载
      }
      
      // Native 实现会自动触发渲染，并处理 letterbox
      mpvBinding!.setWindowSize(this.instanceId, width, height)
    } catch (error) {
      console.error('[libmpv] Failed to set window size:', error)
    }
  }

  /**
   * 获取当前视频宽高比（如果已知）
   */
  async getVideoAspectRatio(): Promise<number | null> {
    if (this.instanceId === null) {
      return null
    }

    try {
      const width = await this.getProperty('width')
      const height = await this.getProperty('height')
      if (!width || !height) return null
      const w = Number(width)
      const h = Number(height)
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null
      return w / h
    } catch {
      return null
    }
  }

  /**
   * 设置选项
   */
  async setOption(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.setOption(this.instanceId, name, value)
    } catch (error) {
      throw new Error(`Failed to set option ${name}: ${error}`)
    }
  }

  /**
   * 加载文件
   */
  async loadFile(path: string): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.loadFile(this.instanceId, path)
      this.currentStatus.path = path
      this.emit('file-loaded', path)
    } catch (error) {
      throw new Error(`Failed to load file: ${error}`)
    }
  }

  /**
   * 获取属性
   */
  async getProperty(name: string): Promise<any> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      return mpvBinding!.getProperty(this.instanceId, name)
    } catch (error) {
      console.warn(`Failed to get property ${name}:`, error)
      return null
    }
  }

  /**
   * 调试工具：打印当前视频和窗口状态
   */
  async debugVideoState(): Promise<void> {
    if (this.instanceId === null) {
      console.warn('[libmpv] Cannot debug: MPV instance not initialized')
      return
    }

    try {
      const width = await this.getProperty('width')
      const height = await this.getProperty('height')
      const keepaspect = await this.getProperty('keepaspect')
      const videoUnscaled = await this.getProperty('video-unscaled')
      const videoAspectOverride = await this.getProperty('video-aspect-override')
      const panscan = await this.getProperty('panscan')
      const videoZoom = await this.getProperty('video-zoom')
      const videoScaleX = await this.getProperty('video-scale-x')
      const videoScaleY = await this.getProperty('video-scale-y')
      
      console.log('=== MPV Video State Debug ===')
      console.log(`Video size: ${width}x${height}`)
      if (width && height) {
        console.log(`Video aspect ratio: ${(Number(width) / Number(height)).toFixed(4)}`)
      }
      console.log(`keepaspect: ${keepaspect}`)
      console.log(`video-unscaled: ${videoUnscaled}`)
      console.log(`video-aspect-override: ${videoAspectOverride}`)
      console.log(`panscan: ${panscan}`)
      console.log(`video-zoom: ${videoZoom}`)
      console.log(`video-scale-x: ${videoScaleX}`)
      console.log(`video-scale-y: ${videoScaleY}`)
      console.log('============================')
    } catch (error) {
      console.error('[libmpv] Failed to debug video state:', error)
    }
  }

  /**
   * 设置属性
   */
  async setProperty(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.setProperty(this.instanceId, name, value)
    } catch (error) {
      throw new Error(`Failed to set property ${name}: ${error}`)
    }
  }

  /**
   * 执行命令
   */
  async command(...args: string[]): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.command(this.instanceId, args)
    } catch (error) {
      throw new Error(`Command failed: ${error}`)
    }
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    await this.setProperty('pause', true)
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    await this.setProperty('pause', false)
  }

  /**
   * 切换暂停/播放
   */
  async togglePause(): Promise<void> {
    await this.command('cycle', 'pause')
  }

  /**
   * 跳转到指定时间
   */
  async seek(time: number): Promise<void> {
    await this.setProperty('time-pos', time)
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    await this.setProperty('volume', Math.max(0, Math.min(100, volume)))
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    await this.command('stop')
    if (this.instanceId === null) {
      return
    }
    if (!mpvBinding) {
      return
    }
    try {
      mpvBinding.clearToBlack(this.instanceId)
    } catch (error) {
      console.warn('[libmpv] Failed to clear to black after stop:', error)
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): MPVStatus {
    return { ...this.currentStatus }
  }

  /**
   * 处理事件（来自 C++ 的 ThreadSafeFunction）
   */
  private handleEvent(event: any): void {
    // MPV 事件 ID 定义（从 client.h）
    const MPV_EVENT_PROPERTY_CHANGE = 22
    const MPV_EVENT_END_FILE = 7
    const MPV_EVENT_SHUTDOWN = 1

    const eventId: number = event?.eventId

    switch (eventId) {
      case MPV_EVENT_PROPERTY_CHANGE: {
        const name: string | undefined = event?.name
        const value = event?.value

        if (!name) {
          return
        }

        // 根据属性名更新 currentStatus
        switch (name) {
          case 'pause':
            this.currentStatus.paused = !!value
            break
          case 'time-pos':
            this.currentStatus.position = typeof value === 'number' ? value : 0
            break
          case 'duration':
            this.currentStatus.duration = typeof value === 'number' ? value : 0
            break
          case 'volume':
            this.currentStatus.volume = typeof value === 'number' ? value : 100
            break
        }

        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_END_FILE:
        this.emit('ended')
        if (this.instanceId !== null && mpvBinding) {
          try {
            mpvBinding.clearToBlack(this.instanceId)
          } catch (error) {
          }
        }
        break
      case MPV_EVENT_SHUTDOWN:
        this.emit('shutdown')
        break
    }
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    if (this.instanceId !== null) {
      try {
        // 通知 mpv 正常退出，释放所有资源和窗口
        mpvBinding!.destroy(this.instanceId)
      } catch (error) {
        console.error('Error destroying MPV instance:', error)
      }
      this.instanceId = null
    }

    this.emit('destroyed')
  }
}

/**
 * 检查 native binding 是否可用
 */
export function isLibMPVAvailable(): boolean {
  return mpvBinding !== null
}
