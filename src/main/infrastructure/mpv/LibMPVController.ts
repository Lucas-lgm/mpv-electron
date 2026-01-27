import { EventEmitter } from 'events'
import * as path from 'path'
import { existsSync } from 'fs'
import type { MPVBinding, MPVStatus } from './types'
import { createLogger } from '../logging'

// Native binding 实例（延迟加载）
let mpvBinding: MPVBinding | null = null
let bindingLoadAttempted = false

const logger = createLogger('LibMPVController')

/**
 * 加载 native binding
 * @returns 是否成功加载
 */
export function loadMPVBinding(): boolean {
  if (bindingLoadAttempted) {
    return mpvBinding !== null
  }
  
  bindingLoadAttempted = true

  // Set DLL search path for Windows (must be before native module loading)
  if (process.platform === 'win32') {
    const dllPath = path.join(__dirname, '../../vendor/mpv/win32-x64/lib')
    if (existsSync(dllPath)) {
      process.env.PATH = `${dllPath};${process.env.PATH}`
      logger.info('[DLL] Added to PATH', { dllPath })
    } else {
      logger.warn('[DLL] DLL path not found', { dllPath })
    }
  }

  // 尝试加载 native binding
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
        return true
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
  
  return mpvBinding !== null
}

/**
 * 获取 native binding（供 LibMPVController 使用）
 */
function getMPVBinding(): MPVBinding | null {
  return mpvBinding
}

/**
 * 检查 native binding 是否可用
 * 如果还未尝试加载，会先尝试加载
 */
export function isLibMPVAvailable(): boolean {
  if (!bindingLoadAttempted) {
    loadMPVBinding()
  }
  return mpvBinding !== null
}

/**
 * LibMPV 控制器：封装 MPV 实例的操作
 */
export class LibMPVController extends EventEmitter {
  private instanceId: number | null = null
  private hdrEnabled = true
  private fileLoadGeneration = 0
  private lastMpvErrorLogLine: string | null = null
  private recentMpvLogLines: string[] = []
  private lastEmittedFps: number | null = null // 上次发出的 FPS 值，用于去重
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

  private get binding(): MPVBinding {
    const binding = getMPVBinding()
    if (!binding) {
      throw new Error('libmpv native binding is not available. Please build the native module first.')
    }
    return binding
  }

  constructor() {
    super()
    
    // 如果还未尝试加载，则先加载
    if (!bindingLoadAttempted) {
      loadMPVBinding()
    }
    
    if (!mpvBinding) {
      throw new Error('libmpv native binding is not available. Please build the native module first.')
    }
  }

  /**
   * 初始化 MPV 实例
   * @param windowId 可选的窗口 ID（Windows 上需要在初始化前设置 wid）
   */
  async initialize(windowId?: number): Promise<void> {
    if (this.instanceId !== null) {
      throw new Error('MPV instance already initialized')
    }

    try {
      // 创建实例（未初始化）
      this.instanceId = this.binding.create()
      
      // 在初始化前设置选项
      // 注意：libmpv 默认已经设置了 no-terminal，不需要再设置
      try {
        // macOS: 使用 render API (vo=libmpv)
        // Windows: 使用 wid 嵌入 (vo=gpu-next)
        if (process.platform === 'darwin') {
          await this.setOption('vo', 'libmpv')
          console.log('[libmpv] ✅ Set vo=libmpv for render API (macOS)')
        } else if (process.platform === 'win32') {
          await this.setOption('vo', 'gpu-next')
          console.log('[libmpv] ✅ Set vo=gpu-next for wid mode (Windows)')
          // Windows 上，如果提供了 windowId，在初始化前设置 wid
          if (windowId !== undefined) {
            console.log('[libmpv] Setting wid to HWND:', windowId, '(0x' + windowId.toString(16) + ')')
            try {
              const result = this.binding.setWindowId(this.instanceId, windowId)
              if (result) {
                console.log('[libmpv] ✅ Set wid before initialization (Windows)')
              } else {
                console.error('[libmpv] ❌ Failed to set wid option (returned false)')
              }
            } catch (error) {
              console.error('[libmpv] ❌ Exception while setting wid:', error)
            }
          } else {
            console.warn('[libmpv] ⚠️ No windowId provided for Windows wid mode')
          }
        }
      } catch (error) {
        console.warn('[libmpv] Failed to set vo option:', error)
      }
      
      try {
        await this.setOption('no-osc', true)
      } catch (error) {
        // 忽略，可能不存在
      }
      
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
      
      try {
        await this.setOption('profile', 'fast')
        console.log('[libmpv] ✅ Applied fast profile for better responsiveness')
      } catch (error) {
        // 忽略，某些版本可能不支持
      }

      // 针对 Apple Silicon 启用硬件解码
      if (process.arch === 'arm64' && process.platform === 'darwin') {
        try {
          await this.setOption('hwdec', 'videotoolbox')
          console.log('[libmpv] ✅ Enabled hardware decoding (VideoToolbox) for Apple Silicon')
        } catch (error) {
          console.warn('[libmpv] Failed to enable hardware decoding:', error)
        }
      }

      // 优化响应速度的设置
      try {
        // 降低 OSD 复杂度
        await this.setOption('osd-level', 1)
        // 使用音频同步模式以提高响应性
        await this.setOption('video-sync', 'audio')
        // 减少输入队列大小以提高响应速度
        await this.setOption('input-queue-size', 2)
        // 启用视频延迟优化
        await this.setOption('video-latency-hacks', true)
        console.log('[libmpv] ✅ Applied responsiveness optimizations')
      } catch (error) {
        // 忽略，某些选项可能不支持
      }

      // 现在初始化（初始化后不能再设置 vo 和 wid）
      this.binding.initialize(this.instanceId)
      
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
      this.binding.setEventCallback(this.instanceId, (event: any) => {
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
      if (process.platform === 'darwin') {
        // macOS: 使用 render API，把 libmpv 绑定到 Electron 的 NSView 上
        this.binding.attachView(this.instanceId, windowId)
        this.binding.setHdrMode(this.instanceId, this.hdrEnabled)
        // 默认启用 JavaScript 驱动渲染模式
        this.binding.setJsDrivenRenderMode(this.instanceId, true)
        console.log('[libmpv] ✅ Enabled JavaScript-driven render mode by default')
      } else if (process.platform === 'win32') {
        // Windows: 使用 wid 嵌入方式
        // 注意：wid 应该在初始化前设置，但如果已经在 initialize 中设置过，这里可以跳过
        // 或者如果初始化时没有设置，这里尝试设置（可能失败，取决于 mpv 版本）
        try {
          this.binding.setWindowId(this.instanceId, windowId)
        } catch (error) {
          console.warn('[libmpv] Failed to set wid after initialization, may need to set before init:', error)
        }
      }
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
      
      // macOS: Native 实现会自动触发渲染，并处理 letterbox
      // Windows: wid 模式下，需要确保 MPV 知道窗口大小变化
      if (process.platform === 'darwin') {
        this.binding.setWindowSize(this.instanceId, width, height)
      } else if (process.platform === 'win32') {
        console.log(`[libmpv] Setting window size: ${width}x${height}`)
        // Windows wid 模式下，MPV 会自动适应窗口大小
        // 但可以通过设置 window-scale 属性来触发更新
        // 或者通过其他属性来确保视频正确缩放
        try {
          // 设置 window-scale 为 1.0 来触发窗口大小更新
          await this.setProperty('window-scale', 1.0)
          console.log('[libmpv] Set window-scale property')
          // 也可以尝试设置 video-scale 相关属性
          // 但实际上 wid 模式下，MPV 应该会自动适应
        } catch (error) {
          console.warn('[libmpv] Failed to set window-scale:', error)
        }
        // 调用 native 的 setWindowSize（虽然 Windows 实现可能是空的，但保持接口一致）
        this.binding.setWindowSize(this.instanceId, width, height)
        console.log('[libmpv] Called native setWindowSize')
      }
    } catch (error) {
      console.error('[libmpv] Failed to set window size:', error)
    }
  }

  setHdrEnabled(enabled: boolean): void {
    this.hdrEnabled = enabled
    if (this.instanceId === null) return
    // HDR 模式仅在 macOS 上支持（通过 render API）
    if (process.platform === 'darwin') {
      this.binding.setHdrMode(this.instanceId, enabled)
    }
  }

  /**
   * 设置 JavaScript 驱动渲染模式
   * @param enabled true = JavaScript 驱动模式，false = CVDisplayLink 驱动模式（默认）
   */
  setJsDrivenRenderMode(enabled: boolean): void {
    if (this.instanceId === null) return
    if (process.platform === 'darwin') {
      this.binding.setJsDrivenRenderMode(this.instanceId, enabled)
    }
  }

  /**
   * 获取当前是否使用 JavaScript 驱动渲染模式
   */
  getJsDrivenRenderMode(): boolean {
    if (this.instanceId === null) return false
    if (process.platform === 'darwin') {
      return this.binding.getJsDrivenRenderMode(this.instanceId)
    }
    return false
  }

  /**
   * 请求渲染（JavaScript 驱动模式下使用）
   */
  requestRender(): void {
    if (this.instanceId === null) return
    if (process.platform === 'darwin') {
      this.binding.requestRender(this.instanceId)
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
      this.binding.setOption(this.instanceId, name, value)
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
      this.binding.loadFile(this.instanceId, path)
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
      return this.binding.getProperty(this.instanceId, name)
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
      this.binding.debugHdrStatus(this.instanceId)
    } catch (error) {
      console.warn('[libmpv] Failed to debug HDR status:', error)
    }
  }

  /**
   * 设置属性
   */
  /**
   * 设置属性
   * 
   * @param name 属性名称
   * @param value 属性值（字符串、数字或布尔值）
   * @throws 如果实例未初始化或设置失败
   */
  async setProperty(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    // 验证值的类型和有效性
    if (typeof value === 'number') {
      // 确保数字是有效的（不是 NaN 或 Infinity）
      if (isNaN(value) || !isFinite(value)) {
        throw new Error(`Invalid number value for property ${name}: ${value}`)
      }
    } else if (typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error(`Unsupported value type for property ${name}: ${typeof value}`)
    }

    try {
      const result = this.binding.setProperty(this.instanceId, name, value)
      if (!result) {
        throw new Error(`Failed to set property ${name}: binding returned false`)
      }
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
      this.binding.command(this.instanceId, args)
    } catch (error) {
      throw new Error(`Command failed: ${error}`)
    }
  }

  /**
   * 暂停（使用命令以提高响应速度）
   */
  async pause(): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }
    try {
      // 使用命令而不是属性设置，响应更快，特别是对于高分辨率视频
      this.binding.command(this.instanceId, ['set', 'pause', 'yes'])
    } catch (error) {
      // 如果命令失败，回退到属性设置
      await this.setProperty('pause', true)
    }
  }

  /**
   * 播放（使用命令以提高响应速度）
   */
  async play(): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }
    try {
      // 使用命令而不是属性设置，响应更快
      this.binding.command(this.instanceId, ['set', 'pause', 'no'])
    } catch (error) {
      // 如果命令失败，回退到属性设置
      await this.setProperty('pause', false)
    }
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
    if (this.instanceId === null) return
    try {
      // Force black mode 仅在 macOS 上支持（通过 render API）
      if (process.platform === 'darwin') {
        this.binding.setForceBlackMode(this.instanceId, enabled)
      }
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

        // 记录最后一条 error/fatal 级别的“纯文本”错误信息
        if (level === 'error' || level === 'fatal') {
          this.lastMpvErrorLogLine = text

          if (this.currentStatus.phase === 'error') {
            this.currentStatus.errorMessage = text
            this.currentStatus.errorLogSnippet = [...this.recentMpvLogLines]
            this.emit('status', { ...this.currentStatus })
          }
        }

        logger.debug(line)
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
          case 'estimated-vf-fps':
            // 发出 fps 变化事件，供 CorePlayer 使用
            const fps = typeof value === 'number' && value > 0 ? value : null
            
            // 去重：只有当 FPS 值真正改变时才发出事件（允许 0.01 fps 的误差）
            if (this.lastEmittedFps !== null && fps !== null) {
              if (Math.abs(this.lastEmittedFps - fps) < 0.01) {
                // FPS 值没有实质性改变，跳过
                break
              }
            } else if (this.lastEmittedFps === fps) {
              // 两者都是 null，跳过
              break
            }
            
            this.lastEmittedFps = fps
            this.emit('fps-change', fps)
            break
        }

        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_START_FILE: {
        this.fileLoadGeneration++
        // 新文件开始时，重置错误信息
        this.lastMpvErrorLogLine = null
        this.currentStatus.errorMessage = undefined
        this.currentStatus.errorLogSnippet = undefined
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
        this.emit('file-loaded')
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

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    if (this.instanceId !== null) {
      try {
        // 通知 mpv 正常退出，释放所有资源和窗口
        this.binding.destroy(this.instanceId)
      } catch (error) {
        console.error('Error destroying MPV instance:', error)
      }
      this.instanceId = null
    }

    this.emit('destroyed')
  }
}
