import { ref, type Ref } from 'vue'

export interface AdjustableValueOptions<T> {
  /** 初始值（通常由后端状态或配置覆盖） */
  initial: T
  /** 保护期窗口（毫秒），默认 200ms */
  justChangedWindowMs?: number
  /** 发送命令到后端的函数 */
  sendCommand: (value: T) => void
  /** 是否输出调试日志 */
  debugLabel?: string
  /** 是否在 onUserInput 阶段就实时发送命令（如音量） */
  sendOnInput?: boolean
}

export interface AdjustableValue<T> {
  /** 当前 UI 使用的值（绑定到控件） */
  value: Ref<T>
  /** 用户正在调整（拖动/输入）时调用，只更新本地 UI */
  onUserInput: (v: T) => void
  /** 用户确认本次调整（松手/回车）时调用：记录时间并发送命令 */
  onUserCommit: (v: T) => void
  /** 应用后端广播回来的状态值，带短暂保护期过滤 */
  applyServerState: (serverValue: T) => void
  /** 用于在初始化或重置时对齐到后端值（不会触发保护期） */
  reset: (serverValue: T) => void
}

/**
 * 通用可调值模式：处理「命令通道 + 状态广播通道」的竞态
 * 适用于音量、进度、播放速度等标量可调控件。
 */
export function useAdjustableValue<T>(options: AdjustableValueOptions<T>): AdjustableValue<T> {
  const { initial, justChangedWindowMs, sendCommand, debugLabel, sendOnInput } = options
  const value = ref(initial) as Ref<T>

  const JUST_CHANGED_WINDOW = justChangedWindowMs ?? 200

  let lastLocalValue: T = initial
  let lastChangeAt = 0
  let isAdjusting = false

  const log = (...args: any[]) => {
    if (!debugLabel) return
    // eslint-disable-next-line no-console
    console.log('[useAdjustableValue]', debugLabel, ...args)
  }

  const onUserInput = (v: T) => {
    isAdjusting = true
    log('onUserInput', { v })
    value.value = v
    if (sendOnInput) {
      sendCommand(v)
    }
  }

  const onUserCommit = (v: T) => {
    const now = Date.now()
    lastLocalValue = v
    lastChangeAt = now
    value.value = v
    log('onUserCommit', { v, lastChangeAt })
    sendCommand(v)
    // 提交后立刻结束“调整中”状态，允许后续后端状态生效
    isAdjusting = false
  }

  const applyServerState = (serverValue: T) => {
    // 用户正在手动调整时，不接受任何后端回写，避免拖动过程中被抢回
    if (isAdjusting) {
      log('applyServerState: IGNORE (isAdjusting)', {
        serverValue,
        lastLocalValue
      })
      return
    }

    const now = Date.now()
    const inProtectWindow = now - lastChangeAt < JUST_CHANGED_WINDOW
    const looksLikeOldValue = serverValue !== lastLocalValue

    // 保护期内且看起来是旧值 → 忽略，避免覆盖刚刚提交的新值
    if (inProtectWindow && looksLikeOldValue) {
      log('applyServerState: IGNORE (protect window, looks like old value)', {
        serverValue,
        lastLocalValue,
        now,
        lastChangeAt,
        delta: now - lastChangeAt
      })
      return
    }

    log('applyServerState: ACCEPT', {
      serverValue,
      lastLocalValue,
      now,
      lastChangeAt,
      delta: now - lastChangeAt
    })
    value.value = serverValue
  }

  const reset = (serverValue: T) => {
    lastLocalValue = serverValue
    lastChangeAt = 0
    value.value = serverValue
  }

  return {
    value,
    onUserInput,
    onUserCommit,
    applyServerState,
    reset
  }
}

