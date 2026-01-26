import { BrowserWindow, BrowserView, screen } from 'electron'
import { EventEmitter } from 'events'
import { PlayerStateMachine, type PlayerState, type PlayerPhase } from '../state/playerState'
import type { MPVStatus } from '../../infrastructure/mpv'
import { LibMPVController, isLibMPVAvailable, MpvMediaPlayer } from '../../infrastructure/mpv'
import { getNSViewPointer, getHWNDPointer } from '../../infrastructure/platform/nativeHelper'
import { Timeline } from '../timeline/timeline'
import { RenderManager } from '../../infrastructure/rendering/renderManager'
import { Media } from '../../domain/models/Media'
import type { MediaPlayer } from './MediaPlayer'

export interface CorePlayer extends EventEmitter {
  setVideoWindow(window: BrowserWindow | null): Promise<void>
  /** 在 playMedia 前调用：初始化 controller、挂载窗口、setExternalController，供 RenderManager / Timeline 使用 */
  ensureControllerReadyForPlayback(): Promise<void>
  setControlView(view: BrowserView | null): void
  setControlWindow(window: BrowserWindow | null): void
  play(filePath: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  isUsingEmbeddedMode(): boolean
  cleanup(): Promise<void>
  getPlayerState(): PlayerState
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  sendKey(key: string): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
  setHdrEnabled(enabled: boolean): void
  getMediaPlayer(): MediaPlayer
}

class CorePlayerImpl extends EventEmitter implements CorePlayer {
  private controller: LibMPVController | null = null
  private videoWindow: BrowserWindow | null = null
  private useLibMPV: boolean = false
  private isCleaningUp: boolean = false
  private initPromise: Promise<void> | null = null
  private stateMachine = new PlayerStateMachine()
  private timeline: Timeline | null = null
  private timelineListener?: (payload: { currentTime: number; duration: number; updatedAt: number }) => void
  private stateMachineStateListener?: (st: PlayerState) => void
  private controllerFpsChangeListener?: (fps: number | null) => void
  private pendingResizeTimer: NodeJS.Timeout | null = null
  private lastPhysicalWidth: number = -1
  private lastPhysicalHeight: number = -1
  private controlView: BrowserView | null = null
  private controlWindow: BrowserWindow | null = null
  private lastIsSeeking: boolean = false
  private renderManager: RenderManager | null = null
  private readonly mediaPlayer = new MpvMediaPlayer()

  constructor() {
    super()
    if (isLibMPVAvailable()) {
      this.controller = new LibMPVController()
      this.initPromise = this.controller.initialize().catch(() => {
        this.controller = null
        this.initPromise = null
      })
    }
    this.timeline = new Timeline({
      interval: 100,
      getStatus: () => this.getStatus()
    })
    this.timelineListener = (payload) => {
      this.emit('video-time-update', payload)
    }
    this.timeline.on('timeline', this.timelineListener)
    
    // 初始化渲染管理器
    this.renderManager = new RenderManager(
      this.controller,
      () => this.stateMachine.getState()
    )
    
    // 数据驱动架构：renderLoop 持续运行，根据状态决定是否渲染
    this.stateMachineStateListener = (st: PlayerState) => {
      this.timeline?.handlePlayerStateChange(st.phase)
      // 确保渲染循环运行（如果还没运行）
      if (this.renderManager && this.controller && process.platform === 'darwin') {
        const isJsDriven = this.controller.getJsDrivenRenderMode()
        if (isJsDriven && !this.renderManager.isActive()) {
          this.renderManager.start()
        }
      }
    }
    this.stateMachine.on('state', this.stateMachineStateListener)
    
    // 监听视频帧率变化，动态调整渲染间隔（构造函数中的初始监听）
    if (this.controller) {
      this.controllerFpsChangeListener = (fps: number | null) => {
        this.renderManager?.updateFps(fps)
      }
      this.controller.on('fps-change', this.controllerFpsChangeListener)
    }
  }
  

  async setVideoWindow(window: BrowserWindow | null): Promise<void> {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.removeAllListeners('resize')
    }
    this.videoWindow = window
    
    // 如果窗口已设置，同时为 MpvMediaPlayer 设置窗口 ID
    if (window && !window.isDestroyed()) {
      let windowId: number | null = null
      
      try {
        if (process.platform === 'darwin') {
          windowId = getNSViewPointer(window)
        } else if (process.platform === 'win32') {
          // Windows 上需要等待窗口完全准备好
          if (!window.isVisible()) {
            window.show()
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          windowId = getHWNDPointer(window)
        }
        
        if (windowId !== null) {
          // 设置到 MpvMediaPlayer
          const mediaPlayer = this.mediaPlayer as any
          if (mediaPlayer && typeof mediaPlayer.setWindowId === 'function') {
            mediaPlayer.setWindowId(windowId)
          }
        }
      } catch (error) {
        console.error('[CorePlayer] Error setting window ID for MpvMediaPlayer:', error)
      }
    }
  }
  /**
   * 准备 controller 用于播放（提取自 play() 的公共逻辑）
   * @returns windowId，如果准备失败则返回 undefined
   */
  private async prepareControllerForPlayback(): Promise<number | undefined> {
    if (this.isCleaningUp) return undefined
    if (!this.videoWindow || this.videoWindow.isDestroyed()) return undefined

    let windowId: number | undefined
    try {
      if (!this.videoWindow.isVisible()) {
        this.videoWindow.show()
      }
      this.videoWindow.focus()
      // Windows 上需要等待窗口完全准备好
      const waitTime = process.platform === 'win32' ? 500 : 300
      await new Promise(resolve => setTimeout(resolve, waitTime))
      if (this.videoWindow.isDestroyed()) {
        console.warn('[CorePlayer] Window was destroyed while waiting')
        return undefined
      }
      // 按平台获取窗口句柄
      if (process.platform === 'darwin') {
        const windowHandle = getNSViewPointer(this.videoWindow)
        if (windowHandle) {
          windowId = windowHandle
          console.log('[CorePlayer] Got NSView pointer:', windowHandle)
        }
      } else if (process.platform === 'win32') {
        // Windows 上，确保窗口完全显示后再获取 HWND
        if (!this.videoWindow.isVisible()) {
          this.videoWindow.show()
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        const windowHandle = getHWNDPointer(this.videoWindow)
        if (windowHandle) {
          windowId = windowHandle
          console.log('[CorePlayer] Got HWND:', windowHandle)
        } else {
          console.error('[CorePlayer] Failed to get HWND')
        }
      }
    } catch (error) {
      console.error('[CorePlayer] Error getting window handle:', error)
      return undefined
    }

    if (!isLibMPVAvailable() || !windowId) return undefined

    this.useLibMPV = true
    try {
      if (!this.controller) {
        this.controller = new LibMPVController()
        // Windows 上需要在初始化前设置 wid
        if (process.platform === 'win32' && windowId) {
          this.initPromise = this.controller.initialize(windowId)
        } else {
          this.initPromise = this.controller.initialize()
        }
      }
      if (this.initPromise) {
        await this.initPromise
        this.initPromise = null
      }
      // macOS 和 Windows 都需要调用 setWindowId 来创建渲染上下文
      if (windowId) {
        await this.controller.setWindowId(windowId)
        if (this.renderManager) this.renderManager.setController(this.controller)
        const currentState = this.getPlayerState()
        if (currentState.phase === 'playing' && this.renderManager) this.renderManager.start()
      }
      await this.syncWindowSize()
      this.setupResizeHandler()
      this.setupEventHandlers()
      this.mediaPlayer.setExternalController(this.controller!, windowId)
      return windowId
    } catch {
      this.useLibMPV = false
      return undefined
    }
  }

  async ensureControllerReadyForPlayback(): Promise<void> {
    const windowId = await this.prepareControllerForPlayback()
    if (!windowId) {
      throw new Error('Failed to prepare controller for playback')
    }
  }

  setControlView(view: BrowserView | null) {
    this.controlView = view
  }

  setControlWindow(window: BrowserWindow | null) {
    this.controlWindow = window
  }

  isUsingEmbeddedMode(): boolean {
    return this.useLibMPV
  }

  setHdrEnabled(enabled: boolean): void {
    if (this.controller) {
      this.controller.setHdrEnabled(enabled)
    }
  }

  async play(filePath: string): Promise<void> {
    const windowId = await this.prepareControllerForPlayback()
    if (!windowId) {
      return
    }
    try {
      await this.mediaPlayer.play(Media.create(filePath))
      await this.syncWindowSize()
    } catch {
      this.useLibMPV = false
    }
  }

  private async syncWindowSize(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  private setupResizeHandler(): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
      return
    }
    this.videoWindow.removeAllListeners('resize')
    this.videoWindow.on('resize', () => {
      // 通知渲染管理器 resize 开始
      this.renderManager?.markResizeStart()
      this.scheduleWindowSizeSync()
    })
  }

  private scheduleWindowSizeSync(): void {
    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer)
    }
    this.pendingResizeTimer = setTimeout(() => {
      this.pendingResizeTimer = null
      this.syncWindowSizeThrottled().catch(() => {})
    }, 16)
  }

  private async syncWindowSizeThrottled(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (width === this.lastPhysicalWidth && height === this.lastPhysicalHeight) {
      return
    }
    console.log(`[CorePlayer] Window size changed: ${this.lastPhysicalWidth}x${this.lastPhysicalHeight} -> ${width}x${height} (scale: ${scaleFactor})`)
    this.lastPhysicalWidth = width
    this.lastPhysicalHeight = height
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  private setupEventHandlers(): void {
    if (!this.controller) return
    const videoWindow = this.videoWindow
    if (!videoWindow) return
    
    // 先移除旧的监听器，避免重复注册
    this.controller.removeAllListeners('status')
    this.controller.removeAllListeners('file-loaded')
    this.controller.removeAllListeners('fps-change')
    
    this.controller.on('status', (status: MPVStatus) => {
      // 检测 seek 完成（isSeeking 从 true 变为 false）
      const wasSeeking = this.lastIsSeeking
      const isSeeking = status.isSeeking ?? false
      this.lastIsSeeking = isSeeking
      
      // 先更新状态，确保 stateMachine 中的状态是最新的
      this.updateFromMPVStatus(status)
      
      // 数据驱动：seek 完成后，标记需要渲染
      // renderLoop 会检测到 pendingSeekRender 并触发渲染
      if (wasSeeking && !isSeeking) {
        this.renderManager?.markSeekComplete()
      }
      
      this.emit('player-state', this.getPlayerState())
    })
    
    // 监听视频帧率变化，动态调整渲染间隔
    this.controller.on('fps-change', (fps: number | null) => {
      this.renderManager?.updateFps(fps)
    })
    
    // 监听文件加载完成事件，确保自动播放
    this.controller.on('file-loaded', async () => {
      if (!this.controller) return
      try {
        // 主动获取一次视频帧率，确保渲染间隔及时更新
        const fps = await this.controller.getProperty('estimated-vf-fps')
        if (typeof fps === 'number' && fps > 0.1) {
          this.renderManager?.updateFps(fps)
        }
        
        // 检查 pause 状态，如果为 true 则自动播放
        const pauseState = await this.controller.getProperty('pause')
        if (pauseState === true) {
          await this.controller.play()
        }
      } catch (error) {
        // 忽略错误，继续执行
      }
    })
  }

  async togglePause(): Promise<void> {
    if (this.controller) {
      await this.controller.togglePause()
      const status = this.controller.getStatus()
      if (status) {
        this.updateFromMPVStatus(status as MPVStatus)
      }
    }
  }

  async pause(): Promise<void> {
    if (this.controller) await this.mediaPlayer.pause()
  }

  async resume(): Promise<void> {
    if (this.controller) await this.mediaPlayer.resume()
  }

  async seek(time: number): Promise<void> {
    if (!this.controller) return
    this.timeline?.markSeek(time)
    await this.mediaPlayer.seek(time)
    const status = this.controller.getStatus()
    if (status) {
      this.updateFromMPVStatus(status as MPVStatus)
      await this.timeline?.broadcastTimeline({ currentTime: time, duration: status.duration })
      this.emit('player-state', this.getPlayerState())
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (this.controller) {
      await this.mediaPlayer.setVolume(volume)
      const status = this.controller.getStatus()
      if (status) this.updateFromMPVStatus(status as MPVStatus)
    }
  }

  async stop(): Promise<void> {
    if (this.controller) await this.mediaPlayer.stop()
  }

  getStatus() {
    return this.controller?.getStatus() || null
  }

  async cleanup(): Promise<void> {
    if (this.isCleaningUp) return
    this.isCleaningUp = true
    try {
      this.renderManager?.cleanup()
      if (this.pendingResizeTimer) {
        clearTimeout(this.pendingResizeTimer)
        this.pendingResizeTimer = null
      }
      if (this.timeline && this.timelineListener) {
        this.timeline.off('timeline', this.timelineListener)
        this.timelineListener = undefined
      }
      if (this.stateMachine && this.stateMachineStateListener) {
        this.stateMachine.off('state', this.stateMachineStateListener)
        this.stateMachineStateListener = undefined
      }
      if (this.controller && this.controllerFpsChangeListener) {
        this.controller.off('fps-change', this.controllerFpsChangeListener)
        this.controllerFpsChangeListener = undefined
      }
      if (this.videoWindow) {
        this.videoWindow.removeAllListeners('resize')
      }
      this.timeline?.dispose()
      await this.mediaPlayer.cleanup()
      if (this.controller instanceof LibMPVController) {
        await this.controller.stop()
        await this.controller.destroy()
      }
      this.controller = null
      this.controlView = null
    } finally {
      this.isCleaningUp = false
    }
  }

  updateFromMPVStatus(status: MPVStatus) {
    this.stateMachine.updateFromStatus(status)
  }

  setPhase(phase: PlayerPhase) {
    this.stateMachine.setPhase(phase)
  }

  setError(message: string) {
    this.stateMachine.setError(message)
  }

  getPlayerState(): PlayerState {
    return this.stateMachine.getState()
  }

  onPlayerState(listener: (state: PlayerState) => void) {
    this.stateMachine.on('state', listener)
  }

  offPlayerState(listener: (state: PlayerState) => void) {
    this.stateMachine.off('state', listener)
  }


  async sendKey(key: string): Promise<void> {
    if (!this.controller) {
      return
    }
    if (this.initPromise) {
      try {
        await this.initPromise
        this.initPromise = null
      } catch {
      }
    }
    await this.controller.keypress(key)
  }
 
  async debugVideoState(): Promise<void> {
    if (this.controller) {
      await this.controller.debugVideoState()
    }
  }

  async debugHdrStatus(): Promise<void> {
    if (this.controller) await this.controller.debugHdrStatus()
  }

  getMediaPlayer(): MediaPlayer {
    return this.mediaPlayer
  }
}

/** 工厂：在 app.whenReady 之后调用，避免在 import 时初始化 MPV/渲染 */
export function createCorePlayer(): CorePlayer {
  return new CorePlayerImpl()
}
