import { EventEmitter } from 'events'
import type { MPVStatus } from '../../infrastructure/mpv'
import { Media } from '../../domain/models/Media'
import { PlaybackSession, PlaybackStatus } from '../../domain/models/Playback'
import { MpvAdapter } from '../../infrastructure/mpv'
import type { PlayerPhase, PlayerState } from './playerStateTypes'
import { createLogger } from '../../infrastructure/logging'

export type { PlayerState, PlayerPhase } from './playerStateTypes'

type InternalState = {
  session: PlaybackSession
}

function sessionToPlayerState(session: PlaybackSession): PlayerState {
  const phase = session.status as unknown as PlayerPhase
  return {
    phase,
    currentTime: session.progress.currentTime,
    duration: session.progress.duration,
    volume: session.volume,
    path: session.media?.uri ?? null,
    error: session.error,
    isSeeking: session.isSeeking,
    isNetworkBuffering: session.networkBuffering.isBuffering,
    networkBufferingPercent: session.networkBuffering.bufferingPercent
  }
}

function phaseToStatus(p: PlayerPhase): PlaybackStatus {
  return p as unknown as PlaybackStatus
}

const defaultSession = (): PlaybackSession =>
  PlaybackSession.create(
    null,
    PlaybackStatus.IDLE,
    { currentTime: 0, duration: 0 },
    100,
    { isBuffering: false, bufferingPercent: 0 }
  )

const logger = createLogger('PlayerStateMachine')

export class PlayerStateMachine extends EventEmitter {
  private state: InternalState = {
    session: defaultSession()
  }

  getState() {
    return sessionToPlayerState(this.state.session)
  }

  /**
   * 将会话重置为「干净的 idle 状态」
   * - 清空媒体 / 进度 / 错误 / 缓冲状态
   * - 保留音量
   */
  resetToIdle(): void {
    const s = this.state.session
    const nextSession = PlaybackSession.create(
      null,
      PlaybackStatus.IDLE,
      { currentTime: 0, duration: 0 },
      s.volume,
      { isBuffering: false, bufferingPercent: 0 },
      null,
      false
    )
    const next: InternalState = {
      session: nextSession
    }
    this.setState(next)
  }

  setPhase(phase: PlayerPhase, error: string | null = null): void {
    const s = this.state.session
    const status = phaseToStatus(phase)

    if (status === PlaybackStatus.IDLE) {
      // idle 走统一的 reset 逻辑，避免分支分散
      this.resetToIdle()
      return
    }

    const nextSession = PlaybackSession.create(
      s.media,
      status,
      s.progress,
      s.volume,
      s.networkBuffering,
      error,
      s.isSeeking
    )
    this.setState({ ...this.state, session: nextSession })
  }

  setError(message: string): void {
    const s = this.state.session
    const nextSession = PlaybackSession.create(
      s.media,
      PlaybackStatus.ERROR,
      s.progress,
      s.volume,
      s.networkBuffering,
      message,
      false
    )
    this.setState({ ...this.state, session: nextSession })
  }

  updateFromStatus(status: MPVStatus): void {
    const overridePhase = this.derivePhase(status)
    const media = status.path ? Media.create(status.path) : null
    const session = MpvAdapter.toPlaybackSession(status, media, { overridePhase })
    this.setState({ session })
  }

  private derivePhase(status: MPVStatus): PlayerPhase {
    if (status.phase === 'stopped') return 'stopped'
    if (status.phase === 'idle' || !status.path) return 'idle'
    if (status.phase === 'paused') return 'paused'
    if (status.phase === 'playing') return 'playing'
    if (status.phase === 'ended') return 'ended'
    if (status.phase === 'error') return 'error'
    return 'idle'
  }

  private setState(next: InternalState): void {
    const prev = this.state
    this.state = next
    const prevPs = sessionToPlayerState(prev.session)
    const nextPs = sessionToPlayerState(next.session)
    if (
      prevPs.phase !== nextPs.phase ||
      prevPs.currentTime !== nextPs.currentTime ||
      prevPs.duration !== nextPs.duration ||
      prevPs.volume !== nextPs.volume ||
      prevPs.path !== nextPs.path ||
      prevPs.error !== nextPs.error ||
      prevPs.isSeeking !== nextPs.isSeeking ||
      prevPs.isNetworkBuffering !== nextPs.isNetworkBuffering ||
      prevPs.networkBufferingPercent !== nextPs.networkBufferingPercent
    ) {
      if (prevPs.phase !== nextPs.phase) {
        logger.debug('PlayerState phase changed', {
          prev: prevPs.phase,
          next: nextPs.phase
        })
      }
      this.emit('state', this.getState())
    }
  }
}
