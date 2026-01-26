// src/main/infrastructure/mpv/MpvMediaPlayer.ts

import { EventEmitter } from 'events'
import { LibMPVController, isLibMPVAvailable } from './LibMPVController'
import type { MPVStatus } from './types'
import type { MediaPlayer } from '../../application/core/MediaPlayer'
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
  private externalController: boolean = false
  private sessionChangeListeners: Set<(session: PlaybackSession) => void> = new Set()

  constructor() {
    super()
    if (!isLibMPVAvailable()) {
      console.warn('[MpvMediaPlayer] libmpv is not available')
    }
  }

  setWindowId(windowId: number): void {
    this.windowId = windowId
  }

  /**
   * 使用外部已初始化的 Controller（供 CorePlayer 等集成，阶段 5）
   * 调用方负责 create/init/setWindowId；本类不再 create/destroy controller。
   */
  setExternalController(controller: LibMPVController, windowId: number): void {
    this.controller = controller
    this.windowId = windowId
    this.externalController = true
    this.setupEventHandlers()
    this.isInitialized = true
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

    // 监听文件加载完成
    this.controller.on('file-loaded', () => {
      // 文件加载完成后，获取最新状态
      if (this.controller) {
        const status = this.controller.getStatus()
        this.updateSessionFromStatus(status)
      }
    })

    // 监听播放结束
    this.controller.on('ended', () => {
      if (this.currentSession) {
        const endedSession = PlaybackSession.create(
          this.currentMedia,
          PlaybackStatus.ENDED,
          this.currentSession.progress,
          this.currentSession.volume,
          { isBuffering: false, bufferingPercent: 0 }
        )
        this.updateSession(endedSession)
      }
    })

    // 监听停止
    this.controller.on('stopped', () => {
      const stoppedSession = PlaybackSession.create(
        null,
        PlaybackStatus.STOPPED,
        { currentTime: 0, duration: 0 },
        this.currentSession?.volume ?? 100,
        { isBuffering: false, bufferingPercent: 0 }
      )
      this.updateSession(stoppedSession)
      this.currentMedia = null
    })

    // 监听错误
    this.controller.on('error', (error: Error) => {
      this.emit('error', error)
      if (this.currentSession) {
        const errorSession = PlaybackSession.create(
          this.currentMedia,
          PlaybackStatus.ERROR,
          this.currentSession.progress,
          this.currentSession.volume,
          this.currentSession.networkBuffering,
          error.message,
          false
        )
        this.updateSession(errorSession)
      }
    })
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
    
    // 更新会话状态
    const stoppedSession = PlaybackSession.create(
      null,
      PlaybackStatus.STOPPED,
      { currentTime: 0, duration: 0 },
      this.currentSession?.volume ?? 100,
      { isBuffering: false, bufferingPercent: 0 }
    )
    this.updateSession(stoppedSession)
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

  async cleanup(): Promise<void> {
    this.sessionChangeListeners.clear()
    this.removeAllListeners()
    if (this.externalController) {
      this.controller = null
      this.currentMedia = null
      this.currentSession = null
      this.isInitialized = false
      this.windowId = null
      this.externalController = false
      return
    }
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
