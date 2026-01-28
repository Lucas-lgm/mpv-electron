export type PlayerPhase = import('../../domain/models/Playback').PlaybackStatus

/**
 * PlayerState 已合并到 PlayerStatus
 * 保留此类型别名以保持向后兼容，但建议使用 PlayerStatus
 * @deprecated 使用 PlayerStatus 替代
 */
export type PlayerState = import('../core/MediaPlayer').PlayerStatus
