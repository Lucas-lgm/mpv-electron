// src/main/domain/models/Playlist.ts

import { Media } from './Media'

/**
 * 播放列表项
 */
export interface PlaylistEntry {
  readonly id: string
  readonly media: Media
  readonly addedAt: Date
  readonly playedAt?: Date
}

/**
 * 播放列表领域模型
 */
export class Playlist {
  private entries: PlaylistEntry[] = []
  private currentIndex: number = -1

  /**
   * 添加媒体到播放列表
   */
  add(media: Media): PlaylistEntry {
    const entry: PlaylistEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      media,
      addedAt: new Date()
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * 移除播放列表项
   */
  remove(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id)
    if (index === -1) return false
    
    this.entries.splice(index, 1)
    if (this.currentIndex >= index) {
      this.currentIndex = Math.max(0, this.currentIndex - 1)
    }
    return true
  }

  /**
   * 获取当前播放项
   */
  getCurrent(): PlaylistEntry | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.entries.length) {
      return null
    }
    return this.entries[this.currentIndex]
  }

  /**
   * 设置当前播放项
   */
  setCurrent(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id)
    if (index === -1) return false
    this.currentIndex = index
    return true
  }

  /**
   * 设置当前播放项（通过索引）
   */
  setCurrentByIndex(index: number): boolean {
    if (index < 0 || index >= this.entries.length) return false
    this.currentIndex = index
    return true
  }

  /**
   * 设置当前播放项（通过媒体 URI）
   */
  setCurrentByUri(uri: string): boolean {
    const index = this.entries.findIndex(e => e.media.uri === uri)
    if (index === -1) return false
    this.currentIndex = index
    return true
  }

  /**
   * 下一首
   */
  next(): PlaylistEntry | null {
    if (this.currentIndex < this.entries.length - 1) {
      this.currentIndex++
      return this.getCurrent()
    }
    return null
  }

  /**
   * 上一首
   */
  previous(): PlaylistEntry | null {
    if (this.currentIndex > 0) {
      this.currentIndex--
      return this.getCurrent()
    }
    return null
  }

  /**
   * 获取所有条目
   */
  getAll(): readonly PlaylistEntry[] {
    return [...this.entries]
  }

  /**
   * 获取条目数量
   */
  get size(): number {
    return this.entries.length
  }

  /**
   * 是否为空
   */
  get isEmpty(): boolean {
    return this.entries.length === 0
  }

  /**
   * 清空播放列表
   */
  clear(): void {
    this.entries = []
    this.currentIndex = -1
  }

  /**
   * 移动条目位置
   */
  moveEntry(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.entries.length ||
        toIndex < 0 || toIndex >= this.entries.length) {
      return false
    }
    
    const [entry] = this.entries.splice(fromIndex, 1)
    this.entries.splice(toIndex, 0, entry)
    
    // 调整当前索引
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++
    }
    
    return true
  }
}
