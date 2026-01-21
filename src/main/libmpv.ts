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
  private dvFilterActive = false
  private dvFilterRetryTimer: NodeJS.Timeout | null = null
  private dvFilterRetryCount = 0
  private dvFilterUnsupportedForThisFile = false
  private lastMpvErrorLogLine: string | null = null
  private recentMpvLogLines: string[] = []
  private dvFilterCapability: 'unknown' | 'available' | 'unavailable' = 'unknown'
  private dvFilterUnavailableReason: string | null = null
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
      const vf = await this.getProperty('vf')
      const vfHasDv = typeof vf === 'string' ? vf.includes('@dv') : false
      console.log(
        `[debug-hdr-status] dvProfile=${dvProfile ?? '(null)'} dvFilterActive=${this.dvFilterActive ? 1 : 0} vfHasDv=${vfHasDv ? 1 : 0} dvFilterCapability=${this.dvFilterCapability} primaries=${primaries ?? '(null)'} gamma=${gamma ?? '(null)'}`
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
        this.pushRecentMpvLogLine(line)

        if (level === 'fatal' || level === 'error' || level === 'warn') {
          this.lastMpvErrorLogLine = line
          console.warn(line)
        }
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
        this.clearDolbyVisionFilter().catch(() => {})
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
        // this.refreshDolbyVisionFilter(this.fileLoadGeneration).catch(() => {})
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

  private async clearDolbyVisionFilter(): Promise<void> {
    if (this.instanceId === null) return
    this.dvFilterRetryCount = 0
    this.dvFilterUnsupportedForThisFile = false
    if (this.dvFilterRetryTimer) {
      clearTimeout(this.dvFilterRetryTimer)
      this.dvFilterRetryTimer = null
    }
    await this.removeDolbyVisionFilterIfPresent()
    this.dvFilterActive = false
  }

  private async refreshDolbyVisionFilter(expectedGeneration: number): Promise<void> {
    if (this.instanceId === null) return
    const instanceId = this.instanceId

    const currentDvProfileRaw = await this.getProperty('current-tracks/video/dolby-vision-profile')
    if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return

    const currentDvProfile = this.coerceNumber(currentDvProfileRaw)
    let hasDolbyVision = currentDvProfile !== null && currentDvProfile > 0

    if (!hasDolbyVision) {
      const trackCountRaw = await this.getProperty('track-list/count')
      if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return

      const trackCountNumber = this.coerceNumber(trackCountRaw)
      const trackCount = trackCountNumber !== null ? Math.max(0, Math.floor(trackCountNumber)) : 0

      for (let i = 0; i < trackCount; i++) {
        const type = await this.getProperty(`track-list/${i}/type`)
        if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return
        if (type !== 'video') continue

        const dvProfile = await this.getProperty(`track-list/${i}/dolby-vision-profile`)
        if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return
        const dvProfileNumber = this.coerceNumber(dvProfile)
        if (dvProfileNumber !== null && dvProfileNumber > 0) {
          hasDolbyVision = true
          break
        }
      }
    }

    if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return

    if (hasDolbyVision) {
      // 检查 Profile 8 (iPhone 等)，直接在此处拦截
      if (currentDvProfile === 8) {
         console.log('[libmpv] Skipping Dolby Vision filter for Profile 8 (handled in refresh).')
         // 确保清除可能残留的 filter
         await this.clearDolbyVisionFilter()
         return
      }
      
      // 检查旋转 (在 refresh 阶段快速检查)
      // 获取旧版 rotate 属性作为 fallback
      const rotateRaw = await this.getProperty('video-params/rotate')
      const rotateLegacyRaw = await this.getProperty('rotate') 
      let rotate = this.coerceNumber(rotateRaw)
      if (rotate === null) {
          rotate = this.coerceNumber(rotateLegacyRaw)
      }
      if (rotate !== null && rotate % 360 !== 0) {
          console.log(`[libmpv] Skipping Dolby Vision filter due to rotation (refresh check): ${rotate}`)
          await this.clearDolbyVisionFilter()
          return
      }

      await this.ensureDolbyVisionFilterEnabled(expectedGeneration)
    } else {
      if (this.dvFilterActive) {
        await this.clearDolbyVisionFilter()
        console.log('[libmpv] Dolby Vision reshaping disabled (vf=@dv)')
      } else {
        await this.clearDolbyVisionFilter()
      }
    }
  }

  private async ensureDolbyVisionFilterEnabled(expectedGeneration: number): Promise<void> {
    if (this.instanceId === null) return
    const instanceId = this.instanceId

    if (this.dvFilterUnsupportedForThisFile) return
    if (this.dvFilterCapability === 'unavailable') return

    // 检查视频旋转角度
    // 如果视频有旋转（如手机竖屏拍摄），应用 libplacebo filter 会导致画面尺寸异常或翻转错误
    // 这种情况下优先保证几何形状正确，跳过 DV filter
    
    // 1. 获取 DV Profile
    // iPhone 拍摄的 Dolby Vision 通常是 Profile 8.4 (HLG base)。
    // Profile 8 是向下兼容的，即使不应用 apply_dolbyvision filter，也能正确显示色彩（作为 HLG/HDR10）。
    // 相比之下，Profile 5 (流媒体) 必须应用 filter 否则色彩错误 (绿/紫)。
    // 鉴于 Profile 8 常用于手机拍摄（常有旋转），且 filter 容易破坏旋转，我们对 Profile 8 默认跳过 filter。
    const dvProfileRaw = await this.getProperty('video-params/dolby-vision-profile') // 或者从 refresh 传入
    const dvProfile = this.coerceNumber(dvProfileRaw)
    
    // 如果是 Profile 8 (iPhone 等)，为了避免旋转 bug，直接跳过
    if (dvProfile === 8) {
       console.log(`[libmpv] Skipping Dolby Vision filter for Profile 8 to avoid rotation issues.`)
       this.dvFilterUnsupportedForThisFile = true
       return
    }

    const rotateRaw = await this.getProperty('video-params/rotate')
    // 尝试获取旧版 rotate 属性作为 fallback
    const rotateLegacyRaw = await this.getProperty('rotate') 
    
    if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return
    
    let rotate = this.coerceNumber(rotateRaw)
    if (rotate === null) {
        rotate = this.coerceNumber(rotateLegacyRaw)
    }
    
    // 检查 display width/height 是否与 raw width/height 交换
    // 这通常意味着有 90/270 度的旋转
    const wRaw = await this.getProperty('width')
    const hRaw = await this.getProperty('height')
    const dwRaw = await this.getProperty('dwidth')
    const dhRaw = await this.getProperty('dheight')
    
    if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return

    const w = this.coerceNumber(wRaw)
    const h = this.coerceNumber(hRaw)
    const dw = this.coerceNumber(dwRaw)
    const dh = this.coerceNumber(dhRaw)

    console.log(`[libmpv] DV Check: profile=${dvProfile} rotate=${rotate} size=${w}x${h} display=${dw}x${dh}`)

    const hasRotationProperty = rotate !== null && rotate % 360 !== 0
    let hasSwappedDimensions = false
    
    if (w !== null && h !== null && dw !== null && dh !== null) {
      // 简单的长宽比检查：如果不一致，说明可能有旋转
      const rawAspect = w / h
      const displayAspect = dw / dh
      
      // 容差 0.01
      if (Math.abs(rawAspect - displayAspect) > 0.01) {
         // 如果 raw 是宽屏 (aspect > 1) 但 display 是竖屏 (aspect < 1)，或者反之
         // 这强有力地暗示了旋转
         if ((rawAspect > 1 && displayAspect < 1) || (rawAspect < 1 && displayAspect > 1)) {
            hasSwappedDimensions = true
         }
      }
    }

    if (hasRotationProperty || hasSwappedDimensions) {
      console.log(`[libmpv] Skipping Dolby Vision filter due to rotation (rotate=${rotate}, swapped=${hasSwappedDimensions})`)
      this.dvFilterUnsupportedForThisFile = true
      return
    }

    const vf = await this.getProperty('vf')
    if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return

    const hasDvInVf = typeof vf === 'string' ? vf.includes('@dv') : false
    if (hasDvInVf) {
      this.dvFilterActive = true
      this.dvFilterCapability = 'available'
      this.dvFilterRetryCount = 0
      if (this.dvFilterRetryTimer) {
        clearTimeout(this.dvFilterRetryTimer)
        this.dvFilterRetryTimer = null
      }
      return
    }

    try {
      await this.command('vf', 'add', '@dv:lavfi=[libplacebo=apply_dolbyvision=1]')
    } catch (error) {
      this.dvFilterActive = false
      this.scheduleDolbyVisionFilterRetry(expectedGeneration, error)
      return
    }

    const vfAfter = await this.getProperty('vf')
    if (expectedGeneration !== this.fileLoadGeneration || this.instanceId !== instanceId) return

    const hasDvAfter = typeof vfAfter === 'string' ? vfAfter.includes('@dv') : false
    this.dvFilterActive = hasDvAfter
    if (hasDvAfter) {
      console.log('[libmpv] Dolby Vision reshaping enabled (vf=@dv)')
      this.dvFilterCapability = 'available'
      this.dvFilterRetryCount = 0
      if (this.dvFilterRetryTimer) {
        clearTimeout(this.dvFilterRetryTimer)
        this.dvFilterRetryTimer = null
      }
    } else {
      this.scheduleDolbyVisionFilterRetry(expectedGeneration, null)
    }
  }

  private scheduleDolbyVisionFilterRetry(expectedGeneration: number, error: unknown): void {
    if (this.instanceId === null) return
    if (expectedGeneration !== this.fileLoadGeneration) return

    const unsupportedReason = this.findDolbyVisionFilterUnsupportedReason()
    if (unsupportedReason) {
      this.dvFilterUnsupportedForThisFile = true
      this.dvFilterCapability = 'unavailable'
      this.dvFilterUnavailableReason = unsupportedReason
      if (this.dvFilterRetryTimer) {
        clearTimeout(this.dvFilterRetryTimer)
        this.dvFilterRetryTimer = null
      }
      console.warn('[libmpv] Dolby Vision reshaping unavailable (vf=@dv)')
      console.warn(unsupportedReason)
      return
    }

    this.dvFilterRetryCount++
    if (this.dvFilterRetryCount > 10) {
      console.warn('[libmpv] Dolby Vision reshaping enable failed (vf=@dv)', error ?? '')
      if (this.lastMpvErrorLogLine) {
        console.warn(this.lastMpvErrorLogLine)
      }
      return
    }

    if (this.dvFilterRetryTimer) {
      clearTimeout(this.dvFilterRetryTimer)
      this.dvFilterRetryTimer = null
    }

    this.dvFilterRetryTimer = setTimeout(() => {
      this.ensureDolbyVisionFilterEnabled(expectedGeneration).catch(() => {})
    }, 200)
  }

  private async removeDolbyVisionFilterIfPresent(): Promise<void> {
    if (this.instanceId === null) return
    try {
      const vf = await this.getProperty('vf')
      const hasDv = typeof vf === 'string' ? vf.includes('@dv') : false
      if (!hasDv) return
    } catch {
      return
    }

    try {
      await this.command('vf', 'remove', '@dv')
    } catch {
    }
  }

  private pushRecentMpvLogLine(line: string): void {
    this.recentMpvLogLines.push(line)
    if (this.recentMpvLogLines.length > 50) {
      this.recentMpvLogLines.splice(0, this.recentMpvLogLines.length - 50)
    }
  }

  private findDolbyVisionFilterUnsupportedReason(): string | null {
    for (let i = this.recentMpvLogLines.length - 1; i >= 0; i--) {
      const line = this.recentMpvLogLines[i]
      const s = line.toLowerCase()
      if (!s.includes('libplacebo')) continue

      if (s.includes("no such filter: 'libplacebo'") || s.includes('no such filter: "libplacebo"')) {
        return line
      }

      if (s.includes('option') && s.includes('apply_dolbyvision') && (s.includes('not found') || s.includes('unknown'))) {
        return line
      }

      if (s.includes('failed') && (s.includes('lavfi') || s.includes('avfiltergraph') || s.includes('filter graph'))) {
        return line
      }
    }
    return null
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
