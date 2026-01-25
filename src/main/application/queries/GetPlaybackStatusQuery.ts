// src/main/application/queries/GetPlaybackStatusQuery.ts

import type { PlaybackSession } from '../../domain/models/Playback'
import type { MediaPlayer } from '../../domain/services/MediaPlayer'

/**
 * 获取播放状态查询
 */
export interface GetPlaybackStatusQuery {
  // 无参数
}

/**
 * 播放状态查询结果
 */
export interface PlaybackStatusQueryResult {
  readonly session: PlaybackSession | null
}

/**
 * 获取播放状态查询处理器
 */
export class GetPlaybackStatusQueryHandler {
  constructor(private player: MediaPlayer) {}

  handle(query: GetPlaybackStatusQuery): PlaybackStatusQueryResult {
    const session = this.player.getCurrentSession()
    return {
      session
    }
  }
}
