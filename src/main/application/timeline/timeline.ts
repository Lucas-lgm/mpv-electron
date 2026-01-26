import { EventEmitter } from 'events'
import type { MPVStatus } from '../../infrastructure/mpv/libmpv'
import type { PlayerPhase } from '../state/playerState'

type TimelinePayload = {
  currentTime: number
  duration: number
  updatedAt: number
}

type TimelineOptions = {
  interval?: number
  getStatus?: () => MPVStatus | Promise<MPVStatus | null> | null
}

export class Timeline extends EventEmitter {
  private currentTime: number = 0
  private duration: number = 0
  private interval: NodeJS.Timeout | null = null
  private intervalMs: number
  private lastSeekTargetTime: number | null = null
  private lastSeekTime: number = 0
  private readonly SEEK_PROTECTION_PERIOD_MS: number = 2000
  private getStatusFn?: TimelineOptions['getStatus']

  constructor(options: TimelineOptions = {}) {
    super()
    this.intervalMs = typeof options.interval === 'number' ? options.interval : 100
    this.getStatusFn = options.getStatus
  }

  handlePlayerStateChange(state: PlayerPhase) {
    if (state === 'playing') {
      this.start()
    } else if (
      state === 'paused' ||
      state === 'stopped' ||
      state === 'ended' ||
      state === 'error' ||
      state === 'idle' ||
      state === 'loading'
    ) {
      this.stop()
    }
    if (state === 'idle' || state === 'stopped') {
      this.update(0, 0)
    }
  }

  markSeek(time: number) {
    this.lastSeekTargetTime = time
    this.lastSeekTime = Date.now()
  }

  update(currentTime?: number, duration?: number) {
    if (typeof currentTime === 'number') {
      this.currentTime = Math.max(0, currentTime)
    }
    if (typeof duration === 'number') {
      this.duration = Math.max(0, duration)
    }
    const payload: TimelinePayload = {
      currentTime: this.currentTime,
      duration: this.duration,
      updatedAt: Date.now()
    }
    this.emit('timeline', payload)
  }

  start() {
    if (this.interval) return
    this.interval = setInterval(() => {
      this.tick().catch(() => {})
    }, this.intervalMs)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async tick() {
    await this.broadcastTimeline()
  }

  private applySeekProtection(overrides: { currentTime?: number }) {
    if (this.lastSeekTargetTime === null) return overrides
    if (this.lastSeekTime === 0) {
      if (overrides.currentTime === undefined) {
        overrides.currentTime = this.lastSeekTargetTime
      } else if (typeof overrides.currentTime === 'number') {
        const diff = Math.abs(overrides.currentTime - this.lastSeekTargetTime)
        if (diff > 2) {
          overrides.currentTime = this.lastSeekTargetTime
        }
      }
    } else if (this.lastSeekTime > 0) {
      const elapsed = Date.now() - this.lastSeekTime
      if (elapsed < this.SEEK_PROTECTION_PERIOD_MS) {
        if (overrides.currentTime === undefined) {
          overrides.currentTime = this.lastSeekTargetTime
        } else if (typeof overrides.currentTime === 'number') {
          const diff = Math.abs(overrides.currentTime - this.lastSeekTargetTime)
          if (diff > 2) {
            overrides.currentTime = this.lastSeekTargetTime
          }
        }
      } else {
        this.lastSeekTargetTime = null
        this.lastSeekTime = 0
      }
    }
    return overrides
  }

  async broadcastTimeline(overrides: { currentTime?: number; duration?: number } = {}) {
    // overrides = this.applySeekProtection(overrides)
    let status: MPVStatus | null = null
    if (this.getStatusFn) {
      const s = await Promise.resolve(this.getStatusFn())
      status = s || null
    }
    const nextCurrent =
      overrides.currentTime !== undefined
        ? overrides.currentTime
        : status
        ? status.position
        : this.currentTime
    const nextDuration =
      overrides.duration !== undefined
        ? overrides.duration
        : status
        ? status.duration
        : this.duration
    this.update(nextCurrent, nextDuration)
  }

  dispose() {
    this.stop()
    this.currentTime = 0
    this.duration = 0
    this.intervalMs = 100
    this.lastSeekTargetTime = null
    this.lastSeekTime = 0
    this.getStatusFn = undefined
  }
}
