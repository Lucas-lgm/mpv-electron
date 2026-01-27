/**
 * 应用常量配置
 * 
 * 集中管理所有硬编码的延迟、超时、间隔等配置值，提高代码可维护性和确定性。
 */

/**
 * 视频播放相关延迟配置
 */
export const VIDEO_PLAYER_DELAYS = {
  /** 停止播放后的等待时间（毫秒） */
  STOP_WAIT_MS: 100,
  /** 视频窗口显示后的等待时间（毫秒） */
  VIDEO_WINDOW_SHOW_WAIT_MS: 500,
} as const

/**
 * 窗口相关延迟配置
 */
export const WINDOW_DELAYS = {
  /** 窗口同步间隔（毫秒） */
  SYNC_INTERVAL_MS: 100,
  /** 焦点设置延迟（毫秒） */
  FOCUS_DELAY_MS: 200,
  /** Resize 节流延迟（毫秒，约 60fps） */
  RESIZE_THROTTLE_MS: 16,
} as const

/**
 * UI 交互延迟配置
 */
export const UI_DELAYS = {
  /** 鼠标移动检测延迟（毫秒） */
  MOUSE_MOVE_DELAY_MS: 100,
  /** 控制栏隐藏延迟（毫秒） */
  CONTROL_BAR_HIDE_DELAY_MS: 100,
} as const

/**
 * Timeline 配置
 */
export const TIMELINE_CONFIG = {
  /** 默认更新间隔（毫秒） */
  DEFAULT_INTERVAL_MS: 100,
  /** Seek 保护期（毫秒） */
  SEEK_PROTECTION_PERIOD_MS: 2000,
} as const
