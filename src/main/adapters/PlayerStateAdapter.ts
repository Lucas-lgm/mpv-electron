import type { PlaybackSession } from '../domain/models/Playback'
import { PlaybackStatus } from '../domain/models/Playback'
import type { PlayerState, PlayerPhase } from '../playerStateTypes'

export type PlayerStateExtras = {
  isCoreIdle?: boolean
  isIdleActive?: boolean
}

/**
 * 将 PlaybackSession 转为 PlayerState（过渡性适配层，阶段 7 移除）
 */
export function toPlayerState(
  session: PlaybackSession,
  extras: PlayerStateExtras = {}
): PlayerState {
  const phase = session.status as unknown as PlayerPhase
  return {
    phase,
    currentTime: session.progress.currentTime,
    duration: session.progress.duration,
    volume: session.volume,
    path: session.media?.uri ?? null,
    error: session.error,
    isSeeking: session.isSeeking,
    isCoreIdle: extras.isCoreIdle ?? false,
    isIdleActive: extras.isIdleActive ?? false,
    isNetworkBuffering: session.networkBuffering.isBuffering,
    networkBufferingPercent: session.networkBuffering.bufferingPercent
  }
}

export function phaseToStatus(p: PlayerPhase): PlaybackStatus {
  return p as unknown as PlaybackStatus
}
