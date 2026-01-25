// src/main/application/queries/GetPlaylistQuery.ts

import type { PlaylistEntry } from '../../domain/models/Playlist'
import type { Playlist } from '../../domain/models/Playlist'

/**
 * 获取播放列表查询
 */
export interface GetPlaylistQuery {
  // 可以添加过滤条件
}

/**
 * 播放列表查询结果
 */
export interface PlaylistQueryResult {
  readonly entries: readonly PlaylistEntry[]
  readonly currentIndex: number
  readonly currentEntry: PlaylistEntry | null
}

/**
 * 获取播放列表查询处理器
 */
export class GetPlaylistQueryHandler {
  constructor(private playlist: Playlist) {}

  handle(query: GetPlaylistQuery): PlaylistQueryResult {
    const entries = this.playlist.getAll()
    const current = this.playlist.getCurrent()
    
    // 获取当前索引（通过反射访问私有属性，或者添加公共方法）
    // 这里我们通过查找当前条目在列表中的位置来确定索引
    let currentIndex = -1
    if (current) {
      const index = entries.findIndex(e => e.id === current.id)
      currentIndex = index >= 0 ? index : -1
    }
    
    return {
      entries,
      currentIndex,
      currentEntry: current
    }
  }
}
