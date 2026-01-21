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
  setForceBlackMode(instanceId: number, enabled: boolean): void
  setHdrMode(instanceId: number, enabled: boolean): void
  debugHdrStatus(instanceId: number): void
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
  position: number
  duration: number
  volume: number
  path: string | null
  phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  isSeeking?: boolean
  isCoreIdle?: boolean
  isIdleActive?: boolean
  isNetworkBuffering?: boolean
  networkBufferingPercent?: number
}

export class LibMPVController extends EventEmitter {
  private instanceId: number | null = null
  private hdrEnabled = true
  private fileLoadGeneration = 0
  private lastMpvErrorLogLine: string | null = null
  private recentMpvLogLines: string[] = []
  private currentStatus: MPVStatus = {
    position: 0,
    duration: 0,
    volume: 100,
    path: null,
    phase: 'idle',
    isSeeking: false,
    isCoreIdle: false,
    isIdleActive: false,
    isNetworkBuffering: false,
    networkBufferingPercent: 0
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
      // try {
      //   await this.setOption('log-level', 'v')
      //   console.log('[libmpv] ✅ Enabled mpv verbose logging')
      // } catch (error) {
      //   console.warn('[libmpv] Failed to set log-level:', error)
      // }
      
      try {
        await this.setOption('no-osd-bar', true)
      } catch (error) {
        // 忽略，可能不存在
      }
      
      try {
        await this.setOption('input-default-bindings', true)
        await this.setOption('input-vo-keyboard', true)
        await this.setOption('input-media-keys', true)
      } catch (error) {
        // 忽略
      }
      
      // 配置音频直通（passthrough）支持
      // 支持的格式：ac3, dts, dts-hd, eac3, truehd
      // 注意：macOS 的 coreaudio 驱动支持 AC3/DTS 直通，但需要硬件支持（如 HDMI 输出到 A/V 接收器）
      try {
        // 启用常见格式的直通：AC3, DTS, DTS-HD, E-AC3, TrueHD
        await this.setOption('audio-spdif', 'ac3,dts,dts-hd,eac3,truehd')
        console.log('[libmpv] ✅ Enabled audio passthrough for AC3/DTS/E-AC3/TrueHD')
      } catch (error) {
        console.warn('[libmpv] Failed to set audio-spdif:', error)
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
      mpvBinding!.setHdrMode(this.instanceId, this.hdrEnabled)
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
      // 获取当前视频尺寸用于调试
      try {
        const vidWidth = await this.getProperty('width')
        const vidHeight = await this.getProperty('height')
        if (vidWidth && vidHeight) {
          const vidAspect = Number(vidWidth) / Number(vidHeight)
          const winAspect = width / height
          
          // 如果宽高比不匹配，确保 keepaspect 已设置
          if (Math.abs(vidAspect - winAspect) > 0.01) {
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

  setHdrEnabled(enabled: boolean): void {
    this.hdrEnabled = enabled
    if (!mpvBinding || this.instanceId === null) return
    mpvBinding.setHdrMode(this.instanceId, enabled)
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
      this.currentStatus.position = 0
      this.currentStatus.duration = 0
      this.currentStatus.isSeeking = false
      this.currentStatus.isNetworkBuffering = false
      this.currentStatus.networkBufferingPercent = 0
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
      const pixFmt = await this.getProperty('pixel-format')
      const keepaspect = await this.getProperty('keepaspect')
      const videoUnscaled = await this.getProperty('video-unscaled')
      const videoAspectOverride = await this.getProperty('video-aspect-override')
      const panscan = await this.getProperty('panscan')
      const videoZoom = await this.getProperty('video-zoom')
      const videoScaleX = await this.getProperty('video-scale-x')
      const videoScaleY = await this.getProperty('video-scale-y')
      // HDR / 色彩相关
      const primaries = await this.getProperty('video-params/primaries')
      const gamma = await this.getProperty('video-params/gamma')
      const colormatrix = await this.getProperty('video-params/colormatrix')
      const bitdepth = await this.getProperty('video-params/bit-depth')
      const colorlevels = await this.getProperty('video-params/color-levels')
      const toneMapping = await this.getProperty('tone-mapping')
      const hdrComputePeak = await this.getProperty('hdr-compute-peak')
      const targetPeak = await this.getProperty('target-peak')
      const targetTrc = await this.getProperty('target-trc')
      const targetPrim = await this.getProperty('target-prim')
      const targetColorspaceHint = await this.getProperty('target-colorspace-hint')
      
      console.log('=== MPV Video State Debug ===')
      console.log(`Video size: ${width}x${height}`)
      if (width && height) {
        console.log(`Video aspect ratio: ${(Number(width) / Number(height)).toFixed(4)}`)
      }
      console.log(`pixel-format: ${pixFmt}`)
      console.log(`keepaspect: ${keepaspect}`)
      console.log(`video-unscaled: ${videoUnscaled}`)
      console.log(`video-aspect-override: ${videoAspectOverride}`)
      console.log(`panscan: ${panscan}`)
      console.log(`video-zoom: ${videoZoom}`)
      console.log(`video-scale-x: ${videoScaleX}`)
      console.log(`video-scale-y: ${videoScaleY}`)
      console.log('--- Color / HDR ---')
      console.log(`primaries: ${primaries}`)
      console.log(`gamma (transfer): ${gamma}`)
      console.log(`colormatrix: ${colormatrix}`)
      console.log(`bit-depth: ${bitdepth}`)
      console.log(`color-levels: ${colorlevels}`)
      console.log(`tone-mapping: ${toneMapping}`)
      console.log(`hdr-compute-peak: ${hdrComputePeak}`)
      console.log(`target-peak: ${targetPeak}`)
      console.log(`target-trc: ${targetTrc}`)
      console.log(`target-prim: ${targetPrim}`)
      console.log(`target-colorspace-hint: ${targetColorspaceHint}`)
      console.log('============================')
    } catch (error) {
      console.error('[libmpv] Failed to debug video state:', error)
    }
  }

  async debugHdrStatus(): Promise<void> {
    if (this.instanceId === null) {
      console.warn('[libmpv] Cannot debug HDR: MPV instance not initialized')
      return
    }

    try {
      const dvProfile = await this.getProperty('current-tracks/video/dolby-vision-profile')
      const primaries = await this.getProperty('video-params/primaries')
      const gamma = await this.getProperty('video-params/gamma')
      console.log(
        `[debug-hdr-status] dvProfile=${dvProfile ?? '(null)'} primaries=${primaries ?? '(null)'} gamma=${gamma ?? '(null)'}`
      )
      mpvBinding!.debugHdrStatus(this.instanceId)
    } catch (error) {
      console.warn('[libmpv] Failed to debug HDR status:', error)
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
   * 发送按键事件
   */
  async keypress(key: string): Promise<void> {
    if (this.instanceId === null) {
      console.warn('[libmpv] Cannot send keypress: MPV instance not initialized')
      return
    }
    try {
      await this.command('keypress', key)
    } catch (error) {
      console.warn(`[libmpv] Failed to send keypress ${key}:`, error)
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

  setForceBlackMode(enabled: boolean): void {
    if (this.instanceId === null || !mpvBinding) {
      return
    }
    try {
      mpvBinding.setForceBlackMode(this.instanceId, enabled)
    } catch (error) {
    }
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    await this.command('stop')
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
    const MPV_EVENT_LOG_MESSAGE = 2
    const MPV_EVENT_PROPERTY_CHANGE = 22
    const MPV_EVENT_END_FILE = 7
    const MPV_EVENT_START_FILE = 6
    const MPV_EVENT_FILE_LOADED = 8
    const MPV_EVENT_SHUTDOWN = 1
    const MPV_EVENT_SEEK = 20
    const MPV_EVENT_PLAYBACK_RESTART = 21
    const MPV_END_FILE_REASON_EOF = 0
    const MPV_END_FILE_REASON_STOP = 2
    const MPV_END_FILE_REASON_QUIT = 3
    const MPV_END_FILE_REASON_ERROR = 4
    const MPV_END_FILE_REASON_REDIRECT = 5

    const eventId: number = event?.eventId

    switch (eventId) {
      case MPV_EVENT_LOG_MESSAGE: {
        const logPrefix = event?.logPrefix
        const logLevel = event?.logLevel
        const logText = event?.logText

        const prefix = typeof logPrefix === 'string' ? logPrefix : ''
        const level = typeof logLevel === 'string' ? logLevel : ''
        const text = typeof logText === 'string' ? logText.trim() : ''

        if (!text) break

        const line = `[mpv:${level || 'unknown'}:${prefix || 'core'}] ${text}`
        // Keep recent log lines for debugging
        this.recentMpvLogLines.push(line)
        if (this.recentMpvLogLines.length > 50) {
          this.recentMpvLogLines.splice(0, this.recentMpvLogLines.length - 50)
        }

        console.log(line)

        // if (level === 'fatal' || level === 'error' || level === 'warn') {
        //   this.lastMpvErrorLogLine = line
        //   console.warn(line)
        // }
        break
      }
      case MPV_EVENT_PROPERTY_CHANGE: {
        const name: string | undefined = event?.name
        const value = event?.value

        if (!name) {
          return
        }

        switch (name) {
          case 'pause':
            if (this.currentStatus.path) {
              this.currentStatus.phase = value ? 'paused' : 'playing'
              if (!value) {
                this.currentStatus.isNetworkBuffering = false
                this.currentStatus.networkBufferingPercent = 0
              }
            }
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
          case 'core-idle':
            this.currentStatus.isCoreIdle = !!value
            break
          case 'idle-active':
            this.currentStatus.isIdleActive = !!value
            break
          case 'paused-for-cache':
            this.currentStatus.isNetworkBuffering = !!value
            break
          case 'cache-buffering-state':
            this.currentStatus.networkBufferingPercent =
              typeof value === 'number' ? value : this.currentStatus.networkBufferingPercent
            break
        }

        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_START_FILE: {
        this.fileLoadGeneration++
        this.currentStatus.isSeeking = false
        this.currentStatus.isNetworkBuffering = false
        this.currentStatus.networkBufferingPercent = 0
        this.currentStatus.phase = 'loading'
        this.setForceBlackMode(false)
        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_FILE_LOADED: {
        this.currentStatus.isSeeking = false
        this.currentStatus.isNetworkBuffering = false
        this.currentStatus.networkBufferingPercent = 0
        if (this.currentStatus.phase !== 'paused') {
          this.currentStatus.phase = 'playing'
        }
        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_SEEK: {
        this.currentStatus.isSeeking = true
        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_PLAYBACK_RESTART: {
        this.currentStatus.isSeeking = false
        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_END_FILE: {
        const reason: number | null =
          typeof event?.endFileReason === 'number' ? event.endFileReason : null
        if (reason === MPV_END_FILE_REASON_STOP) {
          this.currentStatus.phase = 'stopped'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          this.emit('stopped')
          this.setForceBlackMode(true)
        } else if (reason === MPV_END_FILE_REASON_EOF) {
          this.currentStatus.phase = 'ended'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          this.emit('ended')
        } else if (reason === MPV_END_FILE_REASON_ERROR) {
          this.currentStatus.phase = 'error'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          this.emit('ended')
        } else {
          this.currentStatus.phase = 'stopped'
          this.currentStatus.isSeeking = false
          this.currentStatus.isNetworkBuffering = false
          this.currentStatus.networkBufferingPercent = 0
          this.emit('status', { ...this.currentStatus })
          this.emit('ended')
        }
        break
      }
      case MPV_EVENT_SHUTDOWN:
        this.currentStatus.phase = 'idle'
        this.currentStatus.path = null
        this.currentStatus.position = 0
        this.currentStatus.duration = 0
        this.currentStatus.isSeeking = false
        this.currentStatus.isNetworkBuffering = false
        this.currentStatus.networkBufferingPercent = 0
        this.emit('status', { ...this.currentStatus })
        this.emit('shutdown')
        break
    }
  }


  private coerceNumber(value: unknown): number | null {
    if (typeof value === 'number') return isFinite(value) ? value : null
    if (typeof value === 'string') {
      const n = Number(value)
      return isFinite(n) ? n : null
    }
    return null
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
