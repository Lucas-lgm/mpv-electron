import { BrowserWindow, BrowserView, screen } from 'electron'
import { EventEmitter } from 'events'
import { PlayerStateMachine, type PlayerState, type PlayerPhase } from '../state/playerState'
import { MpvMediaPlayer } from '../../infrastructure/mpv'
import { getNSViewPointer, getHWNDPointer } from '../../infrastructure/platform/nativeHelper'
import { Timeline } from '../timeline/timeline'
import { RenderManager } from '../../infrastructure/rendering/renderManager'
import { Media } from '../../domain/models/Media'
import type { PlaybackSession } from '../../domain/models/Playback'
import { PlaybackStatus } from '../../domain/models/Playback'
import type { MediaPlayer, PlayerStatus } from './MediaPlayer'
import { createLogger } from '../../infrastructure/logging'
import { WINDOW_DELAYS } from '../constants'

const logger = createLogger('CorePlayer')

/**
 * 窗口准备延迟配置常量
 */
const WINDOW_PREPARE_DELAYS = {
  /** Windows 平台窗口显示延迟（毫秒） */
  WINDOWS_SHOW_DELAY_MS: 100,
  /** Windows 平台窗口准备延迟（毫秒） */
  WINDOWS_PREPARE_DELAY_MS: 500,
  /** macOS 平台窗口准备延迟（毫秒） */
  MACOS_PREPARE_DELAY_MS: 300
} as const

export interface CorePlayer extends EventEmitter {
  setVideoWindow(window: BrowserWindow | null): Promise<void>
  ensureMediaPlayerReadyForPlayback(): Promise<void>
  play(media: Media): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  getCurrentSession(): PlaybackSession | null
  cleanup(): Promise<void>
  getPlayerState(): PlayerState
  resetState(): void
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  sendKey(key: string): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
  setHdrEnabled(enabled: boolean): void
  getMediaPlayer(): MediaPlayer
}

class CorePlayerImpl extends EventEmitter implements CorePlayer {
  private videoWindow: BrowserWindow | null = null
  private isCleaningUp: boolean = false
  private stateMachine = new PlayerStateMachine()
  private timeline: Timeline | null = null
  private timelineListener?: (payload: { currentTime: number; duration: number; updatedAt: number }) => void
  private stateMachineStateListener?: (st: PlayerState) => void
  private pendingResizeTimer: NodeJS.Timeout | null = null
  private lastPhysicalWidth: number = -1
  private lastPhysicalHeight: number = -1
  private renderManager: RenderManager | null = null
  private mediaPlayer: MediaPlayer
  private sessionChangeListener?: (session: PlaybackSession) => void

  constructor(mediaPlayer?: MediaPlayer) {
    super()
    // 支持依赖注入，默认使用 MpvMediaPlayer
    this.mediaPlayer = mediaPlayer || new MpvMediaPlayer()
    
    this.timeline = new Timeline({
      interval: 100,
      getStatus: () => {
        // 直接返回 PlayerStatus，Timeline 已支持
        return this.getStatus()
      }
    })
    this.timelineListener = (payload) => {
      this.emit('video-time-update', payload)
    }
    this.timeline.on('timeline', this.timelineListener)
    
    // 初始化渲染管理器（使用 MediaPlayer）
    this.renderManager = new RenderManager(
      this.mediaPlayer,
      () => this.stateMachine.getState()
    )
    
    // 监听 MediaPlayer 的状态变化，更新 PlayerStateMachine
    // 当 MpvMediaPlayer 的 controller 发出 'status' 事件时，会更新 session 并触发此回调
    this.sessionChangeListener = (session: PlaybackSession) => {
      // 从 session 中提取状态信息，更新 PlayerStateMachine
      // 注意：这里使用 getStatus() 获取最新状态，因为 session 可能不是最新的
      const status = this.mediaPlayer.getStatus()
      if (status) {
        this.updateFromPlayerStatus(status)
      } else {
        // 如果 getStatus() 返回 null，说明 controller 还未初始化
        // 但从 session 中我们可以获取基本信息来更新状态机
        const playerStatus: PlayerStatus = {
          currentTime: session.progress.currentTime,
          duration: session.progress.duration,
          volume: session.volume,
          isPaused: session.status === PlaybackStatus.PAUSED,
          isSeeking: session.isSeeking,
          isNetworkBuffering: session.networkBuffering.isBuffering,
          networkBufferingPercent: session.networkBuffering.bufferingPercent,
          path: session.media?.uri || null,
          phase: this.mapPlaybackStatusToPhase(session.status),
          errorMessage: session.error || undefined
        }
        this.stateMachine.updateFromStatus(playerStatus)
      }
    }
    this.mediaPlayer.onSessionChange(this.sessionChangeListener)
    
    // 数据驱动架构：renderLoop 持续运行，根据状态决定是否渲染，
    // 同时所有 PlayerState 变化都会经 CorePlayer 再转发一遍给上层（VideoPlayerApp）。
    this.stateMachineStateListener = (st: PlayerState) => {
      this.timeline?.handlePlayerStateChange(st.phase)
      // 确保渲染循环运行（如果还没运行）
      if (this.renderManager && this.shouldStartRenderLoop()) {
        this.renderManager.start()
      }
      // 向外部广播 player-state，覆盖 resetState / mpv 回写等所有来源
      this.emit('player-state', st)
    }
    this.stateMachine.on('state', this.stateMachineStateListener)
    
    // 监听视频帧率变化，动态调整渲染间隔
    this.mediaPlayer.onFpsChange((fps: number | null) => {
      this.renderManager?.updateFps(fps)
    })
  }
  
  /**
   * 判断是否应该启动渲染循环
   */
  private shouldStartRenderLoop(): boolean {
    if (!this.renderManager || process.platform !== 'darwin') return false
    const renderMode = this.mediaPlayer.getRenderMode()
    return renderMode === 'js-driven' && !this.renderManager.isActive()
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
            await new Promise(resolve => setTimeout(resolve, WINDOW_PREPARE_DELAYS.WINDOWS_SHOW_DELAY_MS))
          }
          windowId = getHWNDPointer(window)
        }
        
        if (windowId !== null) {
          if (this.mediaPlayer instanceof MpvMediaPlayer) {
            this.mediaPlayer.setWindowId(windowId)
          }
        }
      } catch (error) {
        logger.error('Error setting window ID for MpvMediaPlayer', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
  /**
   * 准备播放器用于播放（初始化 MediaPlayer 的窗口）
   * @returns windowId，如果准备失败则返回 undefined
   */
  private async prepareMediaPlayerForPlayback(): Promise<number | undefined> {
    if (this.isCleaningUp) return undefined
    if (!this.videoWindow || this.videoWindow.isDestroyed()) return undefined

    let windowId: number | undefined
    try {
      if (!this.videoWindow.isVisible()) {
        this.videoWindow.show()
      }
      this.videoWindow.focus()
      // Windows 上需要等待窗口完全准备好
      const waitTime = process.platform === 'win32' 
        ? WINDOW_PREPARE_DELAYS.WINDOWS_PREPARE_DELAY_MS 
        : WINDOW_PREPARE_DELAYS.MACOS_PREPARE_DELAY_MS
      await new Promise(resolve => setTimeout(resolve, waitTime))
      if (this.videoWindow.isDestroyed()) {
        logger.warn('Window was destroyed while waiting for preparation')
        return undefined
      }
      // 按平台获取窗口句柄
      if (process.platform === 'darwin') {
        const windowHandle = getNSViewPointer(this.videoWindow)
        if (windowHandle) {
          windowId = windowHandle
          logger.debug('Got NSView pointer', { windowHandle })
        }
      } else if (process.platform === 'win32') {
        // Windows 上，确保窗口完全显示后再获取 HWND
        if (!this.videoWindow.isVisible()) {
          this.videoWindow.show()
          await new Promise(resolve => setTimeout(resolve, WINDOW_PREPARE_DELAYS.WINDOWS_SHOW_DELAY_MS))
        }
        const windowHandle = getHWNDPointer(this.videoWindow)
        if (windowHandle) {
          windowId = windowHandle
          logger.debug('Got HWND', { windowHandle })
        } else {
          logger.error('Failed to get HWND')
        }
      }
    } catch (error) {
      logger.error('Error getting window handle', {
        error: error instanceof Error ? error.message : String(error)
      })
      return undefined
    }

    if (!windowId) return undefined

    try {
      // 设置窗口 ID（MpvMediaPlayer 会在 play 时使用它来初始化播放器）
      // 注意：这里需要类型检查，因为 MediaPlayer 接口没有 setWindowId 方法
      // 这是 MPV 特定的，未来可以抽象到 MediaPlayer 接口
      if (this.mediaPlayer instanceof MpvMediaPlayer) {
        this.mediaPlayer.setWindowId(windowId)
      }
      
      // 更新 RenderManager 的 mediaPlayer 引用（如果已创建）
      if (this.renderManager) {
        this.renderManager.setMediaPlayer(this.mediaPlayer)
      }
      
      this.setupResizeHandler()
      this.setupEventHandlers()
      
      return windowId
    } catch (error) {
      logger.error('Error preparing media player for playback', {
        error: error instanceof Error ? error.message : String(error)
      })
      return undefined
    }
  }

  async ensureMediaPlayerReadyForPlayback(): Promise<void> {
    const windowId = await this.prepareMediaPlayerForPlayback()
    if (!windowId) {
      throw new Error('Failed to prepare media player for playback')
    }
  }

  setHdrEnabled(enabled: boolean): void {
    this.mediaPlayer.setHdrEnabled(enabled)
  }

  resetState(): void {
    this.stateMachine.resetToIdle()
  }

  async play(media: Media): Promise<void> {
    const windowId = await this.prepareMediaPlayerForPlayback()
    if (!windowId) {
      throw new Error('Failed to prepare media player for playback')
    }
    try {
      this.resetState()
      await this.mediaPlayer.play(media)
      // 播放后同步窗口大小（此时播放器已初始化）
      await this.syncWindowSize()
      // 检查是否需要启动渲染循环
      const currentState = this.getPlayerState()
      if (currentState.phase === 'playing' && this.renderManager) {
        this.renderManager.start()
      }
    } catch (error) {
      throw error
    }
  }

  private async syncWindowSize(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    await this.mediaPlayer.setWindowSize(width, height)
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
    }, WINDOW_DELAYS.RESIZE_THROTTLE_MS)
  }

  private async syncWindowSizeThrottled(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
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
    logger.debug('Window size changed', {
      from: `${this.lastPhysicalWidth}x${this.lastPhysicalHeight}`,
      to: `${width}x${height}`,
      scaleFactor
    })
    this.lastPhysicalWidth = width
    this.lastPhysicalHeight = height
    await this.mediaPlayer.setWindowSize(width, height)
  }

  private setupEventHandlers(): void {
    const videoWindow = this.videoWindow
    if (!videoWindow) return
    
    // 监听 MediaPlayer 的状态变化（通过 getStatus 轮询或事件）
    // 注意：当前通过 Timeline 轮询 getStatus，这里暂时不需要额外的事件监听
    // 如果 MediaPlayer 支持状态变化事件，可以在这里监听
    
    // FPS 变化已经在构造函数中通过 mediaPlayer.onFpsChange 监听
  }

  async pause(): Promise<void> {
    await this.mediaPlayer.pause()
  }

  async resume(): Promise<void> {
    await this.mediaPlayer.resume()
  }

  async seek(time: number): Promise<void> {
    this.timeline?.markSeek(time)
    await this.mediaPlayer.seek(time)
    const status = this.mediaPlayer.getStatus()
    if (status) {
      this.updateFromPlayerStatus(status)
      await this.timeline?.broadcastTimeline({ currentTime: time, duration: status.duration })
    }
  }

  async setVolume(volume: number): Promise<void> {
    await this.mediaPlayer.setVolume(volume)
    const status = this.mediaPlayer.getStatus()
    if (status) {
      this.updateFromPlayerStatus(status)
    }
  }

  async stop(): Promise<void> {
    await this.mediaPlayer.stop()
  }

  getCurrentSession(): PlaybackSession | null {
    return this.mediaPlayer.getCurrentSession()
  }

  getStatus(): PlayerStatus | null {
    return this.mediaPlayer.getStatus()
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
      // 移除 session change 监听
      if (this.sessionChangeListener) {
        this.mediaPlayer.offSessionChange(this.sessionChangeListener)
        this.sessionChangeListener = undefined
      }
      // FPS 变化监听通过 mediaPlayer.onFpsChange，会在 mediaPlayer.cleanup 中清理
      if (this.videoWindow) {
        this.videoWindow.removeAllListeners('resize')
      }
      this.timeline?.dispose()
      await this.mediaPlayer.cleanup()
    } finally {
      this.isCleaningUp = false
    }
  }

  /**
   * 从 PlayerStatus 更新状态机
   */
  private updateFromPlayerStatus(status: PlayerStatus): void {
    // 直接传递 PlayerStatus，PlayerStateMachine 已支持
    this.stateMachine.updateFromStatus(status)
  }

  /**
   * 将 PlaybackStatus 映射为 PlayerPhase
   */
  private mapPlaybackStatusToPhase(status: PlaybackStatus): PlayerPhase {
    switch (status) {
      case PlaybackStatus.IDLE:
        return 'idle'
      case PlaybackStatus.LOADING:
        return 'loading'
      case PlaybackStatus.PLAYING:
        return 'playing'
      case PlaybackStatus.PAUSED:
        return 'paused'
      case PlaybackStatus.STOPPED:
        return 'stopped'
      case PlaybackStatus.ENDED:
        return 'ended'
      case PlaybackStatus.ERROR:
        return 'error'
      default:
        return 'idle'
    }
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
    await this.mediaPlayer.sendKey(key)
  }
 
  async debugVideoState(): Promise<void> {
    await this.mediaPlayer.debugVideoState()
  }

  async debugHdrStatus(): Promise<void> {
    await this.mediaPlayer.debugHdrStatus()
  }

  getMediaPlayer(): MediaPlayer {
    return this.mediaPlayer
  }
}

/** 工厂：在 app.whenReady 之后调用，避免在 import 时初始化 MPV/渲染 */
export function createCorePlayer(): CorePlayer {
  return new CorePlayerImpl()
}
