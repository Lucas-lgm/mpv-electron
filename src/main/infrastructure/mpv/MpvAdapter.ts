// src/main/infrastructure/mpv/MpvAdapter.ts

import type { MPVStatus } from '../../libmpv'
import { PlaybackSession, PlaybackStatus } from '../../domain/models/Playback'
import type { Media } from '../../domain/models/Media'

/**
 * MPV 状态到领域模型的适配器
 */
export class MpvAdapter {
  /**
   * 将 MPVStatus 转换为 PlaybackSession
   */
  static toPlaybackSession(
    mpvStatus: MPVStatus,
    media: Media | null
  ): PlaybackSession {
    const status = this.mapPhaseToStatus(mpvStatus.phase)
    
    return PlaybackSession.create(
      media,
      status,
      {
        currentTime: mpvStatus.position,
        duration: mpvStatus.duration,
        updatedAt: Date.now()
      },
      mpvStatus.volume,
      {
        isBuffering: mpvStatus.isNetworkBuffering ?? false,
        bufferingPercent: mpvStatus.networkBufferingPercent ?? 0
      },
      null,
      mpvStatus.isSeeking ?? false
    )
  }

  /**
   * 将 MPV phase 映射到 PlaybackStatus
   */
  private static mapPhaseToStatus(
    phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  ): PlaybackStatus {
    switch (phase) {
      case 'idle': return PlaybackStatus.IDLE
      case 'loading': return PlaybackStatus.LOADING
      case 'playing': return PlaybackStatus.PLAYING
      case 'paused': return PlaybackStatus.PAUSED
      case 'stopped': return PlaybackStatus.STOPPED
      case 'ended': return PlaybackStatus.ENDED
      case 'error': return PlaybackStatus.ERROR
      default: return PlaybackStatus.IDLE
    }
  }
}
