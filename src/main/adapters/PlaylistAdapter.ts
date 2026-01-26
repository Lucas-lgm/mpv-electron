import { Playlist } from '../domain/models/Playlist'
import { Media } from '../domain/models/Media'

export interface PlaylistItem {
  path: string
  name: string
}

/**
 * Playlist → PlaylistItem[] 适配层（过渡产物，阶段 7 移除）
 * 保持与 IPC / UI 的 PlaylistItem 兼容。
 */
export class PlaylistAdapter {
  private readonly playlist = new Playlist()

  setList(items: PlaylistItem[]): void {
    this.playlist.clear()
    for (const it of items) {
      this.playlist.add(Media.create(it.path, { title: it.name }))
    }
    if (items.length > 0) this.playlist.setCurrentByIndex(0)
  }

  getList(): PlaylistItem[] {
    return this.playlist.getAll().map((e) => ({
      path: e.media.uri,
      name: e.media.displayName
    }))
  }

  setCurrentByPath(path: string): void {
    this.playlist.setCurrentByUri(path)
  }

  getCurrent(): PlaylistItem | null {
    const cur = this.playlist.getCurrent()
    if (!cur) return null
    return { path: cur.media.uri, name: cur.media.displayName }
  }

  next(): PlaylistItem | null {
    const n = this.playlist.next()
    return n ? { path: n.media.uri, name: n.media.displayName } : null
  }

  prev(): PlaylistItem | null {
    const p = this.playlist.previous()
    return p ? { path: p.media.uri, name: p.media.displayName } : null
  }

  getPlaylist(): Playlist {
    return this.playlist
  }
}
