// src/main/domain/services/MediaPlayer.ts

import { EventEmitter } from 'events'
import { Media } from '../models/Media'
import { PlaybackSession } from '../models/Playback'

/**
 * 媒体播放器服务接口
 */
export interface MediaPlayer extends EventEmitter {
  /**
   * 播放媒体
   */
  play(media: Media): Promise<void>

  /**
   * 暂停播放
   */
  pause(): Promise<void>

  /**
   * 恢复播放
   */
  resume(): Promise<void>

  /**
   * 停止播放
   */
  stop(): Promise<void>

  /**
   * 跳转到指定时间
   */
  seek(time: number): Promise<void>

  /**
   * 设置音量
   */
  setVolume(volume: number): Promise<void>

  /**
   * 获取当前播放会话
   */
  getCurrentSession(): PlaybackSession | null

  /**
   * 监听播放会话变化
   */
  onSessionChange(listener: (session: PlaybackSession) => void): void

  /**
   * 移除监听器
   */
  offSessionChange(listener: (session: PlaybackSession) => void): void

  /**
   * 清理资源
   */
  cleanup(): Promise<void>
}
