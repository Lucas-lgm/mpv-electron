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
  isCoreIdle: boolean
  isIdleActive: boolean
}

function sessionToPlayerState(
  session: PlaybackSession,
  extras: { isCoreIdle: boolean; isIdleActive: boolean }
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
    isCoreIdle: extras.isCoreIdle,
    isIdleActive: extras.isIdleActive,
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
    session: defaultSession(),
    isCoreIdle: false,
    isIdleActive: false
  }

  getState() {
    return sessionToPlayerState(this.state.session, {
      isCoreIdle: this.state.isCoreIdle,
      isIdleActive: this.state.isIdleActive
    })
  }

  setPhase(phase: PlayerPhase, error: string | null = null): void {
    const s = this.state.session
    const status = phaseToStatus(phase)
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
    const isCoreIdle = status.isCoreIdle ?? false
    const isIdleActive = status.isIdleActive ?? false
    this.setState({ session, isCoreIdle, isIdleActive })
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
    const prevPs = sessionToPlayerState(prev.session, {
      isCoreIdle: prev.isCoreIdle,
      isIdleActive: prev.isIdleActive
    })
    const nextPs = sessionToPlayerState(next.session, {
      isCoreIdle: next.isCoreIdle,
      isIdleActive: next.isIdleActive
    })
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
