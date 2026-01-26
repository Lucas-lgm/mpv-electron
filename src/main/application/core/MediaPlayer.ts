// src/main/application/core/MediaPlayer.ts

import { EventEmitter } from 'events'
import { Media } from '../../domain/models/Media'
import { PlaybackSession } from '../../domain/models/Playback'

/**
 * 媒体播放器服务接口（与 CorePlayer 同属应用核心，约定播放契约）
 */
export interface MediaPlayer extends EventEmitter {
  play(media: Media): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  getCurrentSession(): PlaybackSession | null
  onSessionChange(listener: (session: PlaybackSession) => void): void
  offSessionChange(listener: (session: PlaybackSession) => void): void
  cleanup(): Promise<void>
}
