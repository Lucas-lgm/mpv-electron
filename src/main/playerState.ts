import { EventEmitter } from 'events'
import type { MPVStatus } from './libmpv'
import { Media } from './domain/models/Media'
import { PlaybackSession, PlaybackStatus } from './domain/models/Playback'
import { MpvAdapter } from './infrastructure/mpv/MpvAdapter'
import { toPlayerState, phaseToStatus } from './adapters/PlayerStateAdapter'
import type { PlayerPhase } from './playerStateTypes'

export type { PlayerState, PlayerPhase } from './playerStateTypes'

type InternalState = {
  session: PlaybackSession
  isCoreIdle: boolean
  isIdleActive: boolean
}

const defaultSession = (): PlaybackSession =>
  PlaybackSession.create(
    null,
    PlaybackStatus.IDLE,
    { currentTime: 0, duration: 0 },
    100,
    { isBuffering: false, bufferingPercent: 0 }
  )

export class PlayerStateMachine extends EventEmitter {
  private state: InternalState = {
    session: defaultSession(),
    isCoreIdle: false,
    isIdleActive: false
  }

  getState() {
    return toPlayerState(this.state.session, {
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
    if (this.state.session.status === PlaybackStatus.ERROR) return 'error'
    if (status.duration > 0 && status.position >= status.duration) return 'ended'
    return 'playing'
  }

  private setState(next: InternalState): void {
    const prev = this.state
    this.state = next
    const prevPs = toPlayerState(prev.session, {
      isCoreIdle: prev.isCoreIdle,
      isIdleActive: prev.isIdleActive
    })
    const nextPs = toPlayerState(next.session, {
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
      this.emit('state', this.getState())
    }
  }
}
