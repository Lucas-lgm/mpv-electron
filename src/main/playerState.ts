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
}

export class PlayerStateMachine extends EventEmitter {
  private state: PlayerState = {
    phase: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 100,
    path: null,
    error: null
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
      phase: this.derivePhase(status),
      currentTime: status.position,
      duration: status.duration,
      volume: status.volume,
      path: status.path,
      error: this.state.error
    }
    this.setState(next)
  }

  private derivePhase(status: MPVStatus): PlayerPhase {
    if (this.state.phase === 'error') {
      return 'error'
    }
    if (!status.path) {
      return 'idle'
    }
    if (status.duration > 0 && status.position >= status.duration) {
      return 'ended'
    }
    if (status.paused) {
      return 'paused'
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
      prev.error !== next.error
    ) {
      this.emit('state', this.getState())
    }
  }
}

