import { EventEmitter } from 'events'
import type { MPVStatus } from './libmpv'

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'

export interface PlayerState {
  phase: PlayerPhase
  currentTime: number
  duration: number
  volume: number
  path: string | null
  error: string | null
  isSeeking: boolean
  isCoreIdle: boolean
  isIdleActive: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
}

export class PlayerStateMachine extends EventEmitter {
  private state: PlayerState = {
    phase: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 100,
    path: null,
    error: null,
    isSeeking: false,
    isCoreIdle: false,
    isIdleActive: false,
    isNetworkBuffering: false,
    networkBufferingPercent: 0
  }

  getState(): PlayerState {
    return { ...this.state }
  }

  setPhase(phase: PlayerPhase, error: string | null = null): void {
    const next: PlayerState = {
      ...this.state,
      phase,
      error
    }
    this.setState(next)
  }

  setError(message: string): void {
    const next: PlayerState = {
      ...this.state,
      phase: 'error',
      error: message
    }
    this.setState(next)
  }

  updateFromStatus(status: MPVStatus): void {
    const next: PlayerState = {
      phase: status.phase ?? this.derivePhase(status),
      currentTime: status.position,
      duration: status.duration,
      volume: status.volume,
      path: status.path,
      error: this.state.error,
      isSeeking: status.isSeeking ?? false,
      isCoreIdle: status.isCoreIdle ?? false,
      isIdleActive: status.isIdleActive ?? false,
      isNetworkBuffering: status.isNetworkBuffering ?? false,
      networkBufferingPercent: status.networkBufferingPercent ?? this.state.networkBufferingPercent
    }
    this.setState(next)
  }

  private derivePhase(status: MPVStatus): PlayerPhase {
    if (this.state.phase === 'error') {
      return 'error'
    }
    if (this.state.phase === 'paused') {
      return 'paused'
    }
    if (this.state.phase === 'stopped') {
      return 'stopped'
    }
    if (!status.path) {
      return 'idle'
    }
    if (status.duration > 0 && status.position >= status.duration) {
      return 'ended'
    }
    return 'playing'
  }

  private setState(next: PlayerState): void {
    const prev = this.state
    this.state = next
    if (
      prev.phase !== next.phase ||
      prev.currentTime !== next.currentTime ||
      prev.duration !== next.duration ||
      prev.volume !== next.volume ||
      prev.path !== next.path ||
      prev.error !== next.error ||
      prev.isSeeking !== next.isSeeking ||
      prev.isNetworkBuffering !== next.isNetworkBuffering ||
      prev.networkBufferingPercent !== next.networkBufferingPercent
    ) {
      this.emit('state', this.getState())
    }
  }
}
