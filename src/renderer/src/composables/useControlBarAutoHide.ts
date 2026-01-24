import { ref, type Ref } from 'vue'

export interface UseControlBarAutoHideOptions {
  /** 隐藏延迟时间（毫秒），默认 3000ms */
  hideDelay?: number
  /** 是否启用自动隐藏，默认 true */
  enabled?: boolean
  /** 是否正在播放 */
  isPlaying: Ref<boolean>
  /** 是否正在加载 */
  isLoading: Ref<boolean>
  /** 是否正在拖动进度条 */
  isScrubbing: Ref<boolean>
  /** 是否启用调试日志，默认 false */
  debug?: boolean
}

export interface UseControlBarAutoHideReturn {
  /** 控制栏是否可见 */
  controlsVisible: Ref<boolean>
  /** 显示控制栏 */
  showControls: () => void
  /** 延迟隐藏控制栏 */
  scheduleHide: () => void
  /** 鼠标进入控制栏区域 */
  onControlBarEnter: () => void
  /** 鼠标离开控制栏区域 */
  onControlBarLeave: () => void
  /** 用户交互时保持显示 */
  onUserInteraction: () => void
  /** 处理播放状态变化 */
  handlePlayerStateChange: (wasPlaying: boolean) => void
  /** 清理资源 */
  cleanup: () => void
}

/**
 * 控制栏自动隐藏功能 Composable
 * 
 * @param options 配置选项
 * @returns 控制栏自动隐藏相关的状态和方法
 */
export function useControlBarAutoHide(
  options: UseControlBarAutoHideOptions
): UseControlBarAutoHideReturn {
  const {
    hideDelay = 3000,
    enabled = true,
    isPlaying,
    isLoading,
    isScrubbing,
    debug = false
  } = options

  // 状态
  const controlsVisible = ref(true)
  const autoHideEnabled = ref(enabled)
  const hideTimer = ref<NodeJS.Timeout | null>(null)
  const isHovering = ref(false)

  // 窗口级别的鼠标事件处理器
  let windowMouseMoveHandler: (() => void) | null = null
  let windowMouseLeaveHandler: (() => void) | null = null
  let windowMouseMoveTimer: NodeJS.Timeout | null = null

  const log = (message: string, ...args: any[]) => {
    if (debug) {
      console.log(`[useControlBarAutoHide] ${message}`, ...args)
    }
  }

  // 清除隐藏定时器
  const clearHideTimer = () => {
    if (hideTimer.value) {
      clearTimeout(hideTimer.value)
      hideTimer.value = null
    }
  }

  // 显示控制栏
  const showControls = () => {
    controlsVisible.value = true
    clearHideTimer()
    log('showControls: 显示控制栏')
  }

  // 隐藏控制栏
  const hideControls = () => {
    if (!autoHideEnabled.value) {
      log('hideControls: autoHideEnabled is false')
      return
    }
    if (isLoading.value) {
      log('hideControls: isLoading is true')
      return
    }
    if (!isPlaying.value) {
      log('hideControls: isPlaying is false')
      return
    }
    if (isScrubbing.value) {
      log('hideControls: isScrubbing is true')
      return
    }

    log('hideControls: 隐藏控制栏')
    controlsVisible.value = false
  }

  // 延迟隐藏控制栏
  const scheduleHide = () => {
    if (!autoHideEnabled.value) {
      log('scheduleHide: autoHideEnabled is false')
      return
    }
    if (isLoading.value) {
      log('scheduleHide: isLoading is true')
      return
    }
    if (!isPlaying.value) {
      log('scheduleHide: isPlaying is false')
      return
    }
    if (isScrubbing.value) {
      log('scheduleHide: isScrubbing is true')
      return
    }

    clearHideTimer()

    log(`scheduleHide: 设置 ${hideDelay}ms 后隐藏控制栏`)
    hideTimer.value = setTimeout(() => {
      log(
        `scheduleHide: 定时器触发，isHovering=${isHovering.value}, isPlaying=${isPlaying.value}, isScrubbing=${isScrubbing.value}, isLoading=${isLoading.value}`
      )
      // 清除定时器引用，这样下次可以重新设置
      hideTimer.value = null
      if (
        !isHovering.value &&
        isPlaying.value &&
        !isScrubbing.value &&
        !isLoading.value
      ) {
        hideControls()
      } else {
        log('scheduleHide: 条件不满足，不隐藏')
      }
    }, hideDelay)
  }

  // 鼠标进入控制栏区域
  const onControlBarEnter = () => {
    isHovering.value = true
    showControls()
  }

  // 鼠标离开控制栏区域
  const onControlBarLeave = () => {
    isHovering.value = false
    if (isPlaying.value && !isLoading.value && !isScrubbing.value) {
      scheduleHide()
    }
  }

  // 窗口级别的鼠标移动
  const onMouseMove = () => {
    // 如果控制栏已隐藏，鼠标移动时显示控制栏
    if (!controlsVisible.value) {
      showControls()
    }

    // 无论控制栏是否已显示，鼠标移动后都应该重置隐藏定时器
    // 这样鼠标停止移动3秒后会自动隐藏
    if (
      !isHovering.value &&
      isPlaying.value &&
      !isLoading.value &&
      !isScrubbing.value
    ) {
      scheduleHide()
    }
  }

  // 用户交互时保持显示
  const onUserInteraction = () => {
    showControls()
    scheduleHide()
  }

  // 处理播放状态变化
  const handlePlayerStateChange = (wasPlaying: boolean) => {
    // 如果从播放变为暂停，显示控制栏
    if (wasPlaying && !isPlaying.value) {
      showControls()
    }

    // 如果正在加载、暂停、或拖动进度条，保持显示
    if (isLoading.value || !isPlaying.value || isScrubbing.value) {
      showControls()
      return // 这些状态下不需要设置隐藏定时器
    }

    // 视频正在播放时，如果鼠标不在控制栏上，确保有隐藏定时器在运行
    // 这样可以处理以下情况：
    // 1. 从暂停变为播放
    // 2. 从加载中变为播放中
    // 3. 视频一开始就是播放状态
    if (isPlaying.value && !isHovering.value) {
      // 如果没有定时器在运行，设置一个新的定时器
      // 如果有定时器在运行，不重置它（避免频繁重置）
      if (!hideTimer.value) {
        scheduleHide()
      }
    }
  }

  // 设置窗口级别的鼠标事件监听
  const setupWindowMouseListeners = () => {
    windowMouseMoveHandler = () => {
      if (windowMouseMoveTimer) {
        clearTimeout(windowMouseMoveTimer)
      }
      windowMouseMoveTimer = setTimeout(() => {
        onMouseMove()
      }, 100)
    }

    windowMouseLeaveHandler = () => {
      if (windowMouseMoveTimer) {
        clearTimeout(windowMouseMoveTimer)
        windowMouseMoveTimer = null
      }
      // 鼠标离开窗口时，如果正在播放且不在控制栏上，延迟隐藏
      if (
        isPlaying.value &&
        !isLoading.value &&
        !isScrubbing.value &&
        !isHovering.value
      ) {
        scheduleHide()
      }
    }

    window.addEventListener('mousemove', windowMouseMoveHandler)
    window.addEventListener('mouseleave', windowMouseLeaveHandler)
  }

  // 清理资源
  const cleanup = () => {
    clearHideTimer()

    // 清理全局鼠标事件监听器
    if (windowMouseMoveHandler) {
      window.removeEventListener('mousemove', windowMouseMoveHandler)
      windowMouseMoveHandler = null
    }
    if (windowMouseLeaveHandler) {
      window.removeEventListener('mouseleave', windowMouseLeaveHandler)
      windowMouseLeaveHandler = null
    }
    if (windowMouseMoveTimer) {
      clearTimeout(windowMouseMoveTimer)
      windowMouseMoveTimer = null
    }
  }

  // 初始化时设置窗口鼠标事件监听
  setupWindowMouseListeners()

  return {
    controlsVisible,
    showControls,
    scheduleHide,
    onControlBarEnter,
    onControlBarLeave,
    onUserInteraction,
    handlePlayerStateChange,
    cleanup
  }
}
