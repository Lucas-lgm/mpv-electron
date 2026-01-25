// src/main/domain/models/Playback.ts

import { Media } from './Media'

/**
 * 播放状态枚举（语义化）
 */
export enum PlaybackStatus {
  IDLE = 'idle',           // 空闲
  LOADING = 'loading',     // 加载中
  PLAYING = 'playing',     // 播放中
  PAUSED = 'paused',       // 已暂停
  STOPPED = 'stopped',     // 已停止
  ENDED = 'ended',         // 播放结束
  ERROR = 'error'          // 错误
}

/**
 * 播放进度值对象
 */
export interface PlaybackProgress {
  readonly currentTime: number  // 当前时间（秒）
  readonly duration: number     // 总时长（秒）
  readonly percentage: number  // 进度百分比 (0-100)
  readonly updatedAt: number   // 更新时间戳
}

/**
 * 网络缓冲状态
 */
export interface NetworkBufferingState {
  readonly isBuffering: boolean
  readonly bufferingPercent: number
}

/**
 * 播放会话领域模型
 */
export class PlaybackSession {
  constructor(
    public readonly media: Media | null,
    public readonly status: PlaybackStatus,
    public readonly progress: PlaybackProgress,
    public readonly volume: number,
    public readonly networkBuffering: NetworkBufferingState,
    public readonly error: string | null = null,
    public readonly isSeeking: boolean = false
  ) {}

  /**
   * 是否处于活动状态
   */
  get isActive(): boolean {
    return this.status === PlaybackStatus.PLAYING || 
           this.status === PlaybackStatus.PAUSED
  }

  /**
   * 是否可以跳转
   */
  get canSeek(): boolean {
    return this.progress.duration > 0 && 
           this.isActive &&
           !this.isSeeking
  }

  /**
   * 是否正在播放
   */
  get isPlaying(): boolean {
    return this.status === PlaybackStatus.PLAYING
  }

  /**
   * 是否已暂停
   */
  get isPaused(): boolean {
    return this.status === PlaybackStatus.PAUSED
  }

  /**
   * 是否处于错误状态
   */
  get hasError(): boolean {
    return this.status === PlaybackStatus.ERROR
  }

  /**
   * 创建新的播放会话
   */
  static create(
    media: Media | null,
    status: PlaybackStatus,
    progress: Partial<PlaybackProgress>,
    volume: number,
    networkBuffering?: Partial<NetworkBufferingState>,
    error?: string | null,
    isSeeking?: boolean
  ): PlaybackSession {
    const fullProgress: PlaybackProgress = {
      currentTime: progress.currentTime ?? 0,
      duration: progress.duration ?? 0,
      percentage: progress.duration && progress.currentTime
        ? (progress.currentTime / progress.duration) * 100
        : 0,
      updatedAt: progress.updatedAt ?? Date.now()
    }

    const buffering: NetworkBufferingState = {
      isBuffering: networkBuffering?.isBuffering ?? false,
      bufferingPercent: networkBuffering?.bufferingPercent ?? 0
    }

    return new PlaybackSession(
      media,
      status,
      fullProgress,
      volume,
      buffering,
      error ?? null,
      isSeeking ?? false
    )
  }
}
