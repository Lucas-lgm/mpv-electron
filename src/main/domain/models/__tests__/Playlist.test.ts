// 播放列表领域模型单元测试示例

import { Playlist } from '../Playlist'
import { Media } from '../Media'

describe('Playlist 领域模型', () => {
  let playlist: Playlist

  beforeEach(() => {
    playlist = new Playlist()
  })

  describe('add()', () => {
    it('应该添加媒体到播放列表', () => {
      const media = Media.create('/path/to/video1.mp4')
      const entry = playlist.add(media)

      expect(entry.media).toBe(media)
      expect(playlist.size).toBe(1)
      expect(playlist.isEmpty).toBe(false)
    })
  })

  describe('getCurrent()', () => {
    it('空列表应该返回 null', () => {
      expect(playlist.getCurrent()).toBeNull()
    })

    it('应该返回当前播放项', () => {
      const media1 = Media.create('/path/to/video1.mp4')
      const media2 = Media.create('/path/to/video2.mp4')
      
      playlist.add(media1)
      playlist.add(media2)
      playlist.setCurrentByIndex(0)

      const current = playlist.getCurrent()
      expect(current).not.toBeNull()
      expect(current?.media.uri).toBe('/path/to/video1.mp4')
    })
  })

  describe('next() / previous()', () => {
    it('应该正确切换到下一首', () => {
      const media1 = Media.create('/path/to/video1.mp4')
      const media2 = Media.create('/path/to/video2.mp4')
      
      playlist.add(media1)
      playlist.add(media2)
      playlist.setCurrentByIndex(0)

      const next = playlist.next()
      expect(next?.media.uri).toBe('/path/to/video2.mp4')
    })

    it('应该正确切换到上一首', () => {
      const media1 = Media.create('/path/to/video1.mp4')
      const media2 = Media.create('/path/to/video2.mp4')
      
      playlist.add(media1)
      playlist.add(media2)
      playlist.setCurrentByIndex(1)

      const prev = playlist.previous()
      expect(prev?.media.uri).toBe('/path/to/video1.mp4')
    })
  })
})
