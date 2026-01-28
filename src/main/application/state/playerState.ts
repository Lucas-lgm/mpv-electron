import { EventEmitter } from 'events'
import { Media } from '../../domain/models/Media'
import { PlaybackSession, PlaybackStatus } from '../../domain/models/Playback'
import type { PlayerPhase } from './playerStateTypes'
import type { PlayerStatus } from '../core/MediaPlayer'
import { createLogger } from '../../infrastructure/logging'

export type { PlayerPhase } from './playerStateTypes'

type InternalState = {
  session: PlaybackSession
}

function sessionToPlayerStatus(session: PlaybackSession): PlayerStatus {
  return {
    phase: session.status, // 直接使用 PlaybackStatus，无需转换
    currentTime: session.progress.currentTime,
    duration: session.progress.duration,
    volume: session.volume,
    path: session.media?.uri ?? null,
    isPaused: session.status === PlaybackStatus.PAUSED,
    isSeeking: session.isSeeking,
    isNetworkBuffering: session.networkBuffering.isBuffering,
    networkBufferingPercent: session.networkBuffering.bufferingPercent,
    errorMessage: session.error || undefined,
    // 只在为 true 时包含，减少序列化开销
    isSwitching: session.isSwitching || undefined
  }
}

// PlayerPhase 就是 PlaybackStatus 的别名，不再需要额外的 phaseToStatus

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

  getState(): PlayerStatus {
    return sessionToPlayerStatus(this.state.session)
  }

  /**
   * 将会话重置为「干净的 idle 状态」
   * - 清空媒体 / 进度 / 错误 / 缓冲状态
   * - 保留音量和切换状态（isSwitching）
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
      false,
      s.isSwitching
    )
    this.setState({ session: nextSession })
  }

  setPhase(phase: PlayerPhase, error: string | null = null): void {
    const s = this.state.session
    // PlayerPhase 就是 PlaybackStatus 的别名，直接使用
    const status = phase

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
      s.isSeeking,
      s.isSwitching
    )
    this.setState({ session: nextSession })
  }

  /**
   * 设置切换状态
   * @param isSwitching 是否正在切换视频
   */
  setSwitching(isSwitching: boolean): void {
    const s = this.state.session
    if (s.isSwitching === isSwitching) return

    const nextSession = PlaybackSession.create(
      s.media,
      s.status,
      s.progress,
      s.volume,
      s.networkBuffering,
      s.error,
      s.isSeeking,
      isSwitching
    )
    this.setState({ session: nextSession })
  }

  /**
   * 设置错误状态（进入 ERROR）
   * - 进入错误态时，认为切换过程结束（isSwitching=false）
   */
  setError(message: string): void {
    const s = this.state.session
    const nextSession = PlaybackSession.create(
      s.media,
      PlaybackStatus.ERROR,
      s.progress,
      s.volume,
      s.networkBuffering,
      message,
      false,
      false
    )
    this.setState({ session: nextSession })
  }

  /**
   * 从 PlayerStatus 更新状态机
   */
  updateFromStatus(status: PlayerStatus): void {
    // PlayerStatus.phase 现在就是 PlaybackStatus，直接使用
    const playbackStatus = status.phase
    const media = status.path ? Media.create(status.path) : null

    // 基于当前会话的切换状态
    const baseIsSwitching = this.state.session.isSwitching

    // 处理切换状态：
    // 1. 如果 status 中显式设置了 isSwitching，使用该值
    // 2. 如果当前 isSwitching 为 true，且 phase 进入“新状态”或已停止/空闲时，清除切换状态
    let isSwitching: boolean
    if (status.isSwitching !== undefined) {
      isSwitching = status.isSwitching
    } else if (baseIsSwitching) {
      // 一旦进入 loading 或 error，就认为“切换过程”结束
      if (
        playbackStatus === PlaybackStatus.LOADING ||
        playbackStatus === PlaybackStatus.ERROR
      ) {
        isSwitching = false
      } else {
        isSwitching = true
      }
    } else {
      isSwitching = false
    }

    const session = PlaybackSession.create(
      media,
      playbackStatus,
      {
        currentTime: status.currentTime,
        duration: status.duration,
        updatedAt: Date.now()
      },
      status.volume,
      {
        isBuffering: status.isNetworkBuffering,
        bufferingPercent: status.networkBufferingPercent
      },
      playbackStatus === PlaybackStatus.ERROR ? (status.errorMessage ?? null) : null,
      status.isSeeking,
      isSwitching
    )

    this.setState({ session })
  }

  // PlayerPhase 现在就是 PlaybackStatus 类型，不再需要 derivePhase

  private setState(next: InternalState): void {
    const prev = this.state
    this.state = next
    const prevPs = sessionToPlayerStatus(prev.session)
    const nextPs = sessionToPlayerStatus(next.session)
    if (
      prevPs.phase !== nextPs.phase ||
      prevPs.currentTime !== nextPs.currentTime ||
      prevPs.duration !== nextPs.duration ||
      prevPs.volume !== nextPs.volume ||
      prevPs.path !== nextPs.path ||
      prevPs.errorMessage !== nextPs.errorMessage ||
      prevPs.isPaused !== nextPs.isPaused ||
      prevPs.isSeeking !== nextPs.isSeeking ||
      prevPs.isNetworkBuffering !== nextPs.isNetworkBuffering ||
      prevPs.networkBufferingPercent !== nextPs.networkBufferingPercent ||
      prevPs.isSwitching !== nextPs.isSwitching
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

