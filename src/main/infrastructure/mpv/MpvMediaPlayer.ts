// src/main/infrastructure/mpv/MpvMediaPlayer.ts

import { EventEmitter } from 'events'
import { LibMPVController, isLibMPVAvailable } from './LibMPVController'
import type { MPVStatus } from './types'
import type { MediaPlayer, PlayerStatus } from '../../application/core/MediaPlayer'
import { Media } from '../../domain/models/Media'
import { PlaybackSession, PlaybackStatus } from '../../domain/models/Playback'
import { MpvAdapter } from './MpvAdapter'

/**
 * MPV 实现的媒体播放器
 * 
 * 注意：此实现需要窗口 ID 来初始化 MPV 实例。
 * 窗口相关的设置应在调用 play() 之前通过 setWindowId() 完成。
 */
export class MpvMediaPlayer extends EventEmitter implements MediaPlayer {
  private controller: LibMPVController | null = null

  private currentMedia: Media | null = null
  private currentSession: PlaybackSession | null = null
  private windowId: number | null = null
  private isInitialized: boolean = false
  private sessionChangeListeners: Set<(session: PlaybackSession) => void> = new Set()
  private statusChangeListeners: Set<(status: PlayerStatus) => void> = new Set()
  private fpsChangeListeners: Set<(fps: number | null) => void> = new Set()
  private fpsChangeHandler?: (fps: number | null) => void

  constructor() {
    super()
    if (!isLibMPVAvailable()) {
      console.warn('[MpvMediaPlayer] libmpv is not available')
    }
  }

  setWindowId(windowId: number): void {
    this.windowId = windowId
  }

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized && this.controller) return
    if (!isLibMPVAvailable()) throw new Error('libmpv is not available')
    if (!this.windowId) throw new Error('Window ID must be set before playing media. Call setWindowId() first.')

    this.controller = new LibMPVController()
    if (process.platform === 'win32') {
      await this.controller.initialize(this.windowId)
    } else {
      await this.controller.initialize()
    }
    await this.controller.setWindowId(this.windowId)
    this.setupEventHandlers()
    this.isInitialized = true
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.controller) return

    // 监听 MPV 状态变化
    this.controller.on('status', (status: MPVStatus) => {
      this.updateSessionFromStatus(status)
    })
    
    // 监听 FPS 变化
    if (this.fpsChangeListeners.size > 0) {
      this.setupFpsChangeHandler()
    }
  }
  
  /**
   * 设置 FPS 变化处理器
   */
  private setupFpsChangeHandler(): void {
    if (!this.controller || this.fpsChangeHandler) return
    
    this.fpsChangeHandler = (fps: number | null) => {
      this.fpsChangeListeners.forEach(listener => {
        try {
          listener(fps)
        } catch (error) {
          console.error('[MpvMediaPlayer] Error in FPS change listener:', error)
        }
      })
    }
    this.controller.on('fps-change', this.fpsChangeHandler)
  }
  
  /**
   * 移除 FPS 变化处理器
   */
  private removeFpsChangeHandler(): void {
    if (!this.controller || !this.fpsChangeHandler) return
    this.controller.off('fps-change', this.fpsChangeHandler)
    this.fpsChangeHandler = undefined
  }

  /**
   * 从 MPV 状态更新播放会话
   */
  private updateSessionFromStatus(status: MPVStatus): void {
    if (!this.controller) return

    const session = MpvAdapter.toPlaybackSession(status, this.currentMedia)
    this.updateSession(session)
  }

  /**
   * 更新播放会话并通知监听器
   */
  private updateSession(session: PlaybackSession): void {
    this.currentSession = session
    
    // 通知会话变化监听器
    this.sessionChangeListeners.forEach(listener => {
      try {
        listener(session)
      } catch (error) {
        console.error('[MpvMediaPlayer] Error in session change listener:', error)
      }
    })

    // 发出事件
    this.emit('session-change', session)
    
    // 同时发出状态变化事件（用于状态更新优化）
    // 将 PlaybackSession 转换为 PlayerStatus
    // 注意：PlaybackStatus 枚举的值就是字符串字面量，可以直接使用
    const playerStatus: PlayerStatus = {
      currentTime: session.progress.currentTime,
      duration: session.progress.duration,
      volume: session.volume,
      isPaused: session.status === PlaybackStatus.PAUSED,
      isSeeking: session.isSeeking,
      isNetworkBuffering: session.networkBuffering.isBuffering,
      networkBufferingPercent: session.networkBuffering.bufferingPercent,
      path: session.media?.uri || null,
      phase: session.status,  // 直接使用 PlaybackStatus，无需转换
      errorMessage: session.error || undefined
    }
    
    // 通知状态变化监听器
    this.statusChangeListeners.forEach(listener => {
      try {
        listener(playerStatus)
      } catch (error) {
        console.error('[MpvMediaPlayer] Error in status change listener:', error)
      }
    })
    
    // 发出事件
    this.emit('status-change', playerStatus)
  }

  /**
   * 播放媒体
   */
  async play(media: Media): Promise<void> {
    await this.ensureInitialized()

    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    this.currentMedia = media
    await this.controller.loadFile(media.uri)

    // 更新会话状态为加载中
    const loadingSession = PlaybackSession.create(
      media,
      PlaybackStatus.LOADING,
      { currentTime: 0, duration: 0 },
      100,
      { isBuffering: false, bufferingPercent: 0 }
    )
    this.updateSession(loadingSession)
  }

  /**
   * 暂停播放
   */
  async pause(): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    await this.controller.pause()
    // 状态会通过事件更新
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    await this.controller.play()
    // 状态会通过事件更新
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    if (!this.controller) {
      return
    }

    await this.controller.stop()

    this.currentMedia = null
  }

  async seek(time: number): Promise<void> {
    if (!this.controller) throw new Error('MPV controller not initialized')
    if (this.currentSession && !this.currentSession.canSeek) {
      throw new Error('Cannot seek in current state')
    }
    await this.controller.seek(time)
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }

    const clampedVolume = Math.max(0, Math.min(100, volume))
    await this.controller.setVolume(clampedVolume)
    
    // 更新会话中的音量
    if (this.currentSession) {
      const updatedSession = PlaybackSession.create(
        this.currentSession.media,
        this.currentSession.status,
        this.currentSession.progress,
        clampedVolume,
        this.currentSession.networkBuffering,
        this.currentSession.error,
        this.currentSession.isSeeking
      )
      this.updateSession(updatedSession)
    }
  }

  /**
   * 获取当前播放会话
   * 如果控制器已初始化，会获取最新状态
   */
  getCurrentSession(): PlaybackSession | null {
    // 如果控制器已初始化，获取最新状态
    if (this.controller && this.isInitialized) {
      const status = this.controller.getStatus()
      this.updateSessionFromStatus(status)
    }
    return this.currentSession
  }

  /**
   * 监听播放会话变化
   */
  onSessionChange(listener: (session: PlaybackSession) => void): void {
    this.sessionChangeListeners.add(listener)
    
    // 如果已有会话，立即通知
    if (this.currentSession) {
      try {
        listener(this.currentSession)
      } catch (error) {
        console.error('[MpvMediaPlayer] Error in session change listener:', error)
      }
    }
  }

  /**
   * 移除监听器
   */
  offSessionChange(listener: (session: PlaybackSession) => void): void {
    this.sessionChangeListeners.delete(listener)
  }

  /**
   * 监听播放器状态变化
   * 当播放器状态更新时，会直接发出 PlayerStatus 事件
   */
  onStatusChange(listener: (status: PlayerStatus) => void): void {
    this.statusChangeListeners.add(listener)
    
    // 如果当前有状态，立即通知一次
    const currentStatus = this.getStatus()
    if (currentStatus) {
      try {
        listener(currentStatus)
      } catch (error) {
        console.error('[MpvMediaPlayer] Error in initial status change notification:', error)
      }
    }
  }

  /**
   * 移除状态变化监听器
   */
  offStatusChange(listener: (status: PlayerStatus) => void): void {
    this.statusChangeListeners.delete(listener)
  }

  /**
   * 获取播放器状态
   */
  getStatus(): PlayerStatus | null {
    if (!this.controller || !this.isInitialized) return null
    
    const mpvStatus = this.controller.getStatus()
    return this.adaptMPVStatusToPlayerStatus(mpvStatus)
  }
  
  /**
   * 将 MPVStatus 适配为 PlayerStatus
   */
  private adaptMPVStatusToPlayerStatus(mpvStatus: MPVStatus): PlayerStatus {
    return {
      currentTime: mpvStatus.position ?? 0,
      duration: mpvStatus.duration ?? 0,
      volume: mpvStatus.volume ?? 100,
      isPaused: mpvStatus.phase === 'paused',
      isSeeking: mpvStatus.isSeeking ?? false,
      isNetworkBuffering: mpvStatus.isNetworkBuffering ?? false,
      networkBufferingPercent: mpvStatus.networkBufferingPercent ?? 0,
      path: mpvStatus.path,
      phase: MpvAdapter.mapPhaseToStatus(mpvStatus.phase),
      errorMessage: mpvStatus.errorMessage
    }
  }
  
  /**
   * 请求渲染一帧
   */
  requestRender(): void {
    this.controller?.requestRender()
  }
  
  /**
   * 获取渲染模式
   */
  getRenderMode(): 'js-driven' | 'native' | 'none' {
    if (!this.controller || !this.isInitialized) return 'none'
    
    // MPV 在 macOS 上使用 JS 驱动渲染（gpu-next）
    if (process.platform === 'darwin' && this.controller.getJsDrivenRenderMode()) {
      return 'js-driven'
    }
    return 'native'
  }
  
  /**
   * 设置窗口大小
   */
  async setWindowSize(width: number, height: number): Promise<void> {
    if (this.controller) {
      await this.controller.setWindowSize(width, height)
    }
  }
  
  /**
   * 监听视频帧率变化
   */
  onFpsChange(listener: (fps: number | null) => void): void {
    this.fpsChangeListeners.add(listener)
    
    // 如果 controller 已初始化，设置处理器
    if (this.controller && this.isInitialized && !this.fpsChangeHandler) {
      this.setupFpsChangeHandler()
    }
  }
  
  /**
   * 移除 FPS 变化监听
   */
  offFpsChange(listener: (fps: number | null) => void): void {
    this.fpsChangeListeners.delete(listener)
    
    // 如果没有监听器了，移除处理器
    if (this.fpsChangeListeners.size === 0) {
      this.removeFpsChangeHandler()
    }
  }
  
  /**
   * 设置 HDR 启用状态
   */
  setHdrEnabled(enabled: boolean): void {
    this.controller?.setHdrEnabled(enabled)
  }
  
  /**
   * 发送按键事件
   */
  async sendKey(key: string): Promise<void> {
    if (!this.controller) {
      throw new Error('MPV controller not initialized')
    }
    await this.controller.keypress(key)
  }
  
  /**
   * 调试：输出视频状态信息
   */
  async debugVideoState(): Promise<void> {
    if (this.controller) {
      await this.controller.debugVideoState()
    }
  }
  
  /**
   * 调试：输出 HDR 状态信息
   */
  async debugHdrStatus(): Promise<void> {
    if (this.controller) {
      await this.controller.debugHdrStatus()
    }
  }

  async cleanup(): Promise<void> {
    this.sessionChangeListeners.clear()
    this.statusChangeListeners.clear()
    this.fpsChangeListeners.clear()
    this.removeFpsChangeHandler()
    this.removeAllListeners()
    
    // Controller 由本类创建和管理，清理时销毁
    if (this.controller) {
      try {
        await this.controller.stop()
        await this.controller.destroy()
      } catch (error) {
        console.error('[MpvMediaPlayer] Error during cleanup:', error)
      }
    }
    this.controller = null
    this.currentMedia = null
    this.currentSession = null
    this.isInitialized = false
    this.windowId = null
  }
}
