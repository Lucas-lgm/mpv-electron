// 领域模型单元测试示例
// 注意：这是一个测试示例文件，展示如何测试领域模型

import { Media, type MediaId, type MediaMetadata } from '../Media'

describe('Media 领域模型', () => {
  describe('Media.create()', () => {
    it('应该创建有效的媒体实例', () => {
      const media = Media.create('file:///path/to/video.mp4', {
        title: '测试视频',
        duration: 120
      })

      expect(media.uri).toBe('file:///path/to/video.mp4')
      expect(media.metadata.title).toBe('测试视频')
      expect(media.metadata.duration).toBe(120)
      expect(media.id.value).toMatch(/^media-\d+-/)
    })

    it('应该正确识别本地文件', () => {
      const localMedia = Media.create('/path/to/video.mp4')
      expect(localMedia.isLocalFile).toBe(true)
      expect(localMedia.isNetworkStream).toBe(false)
    })

    it('应该正确识别网络流', () => {
      const networkMedia = Media.create('https://example.com/video.m3u8')
      expect(networkMedia.isNetworkStream).toBe(true)
      expect(networkMedia.isLocalFile).toBe(false)
      expect(networkMedia.isHlsStream).toBe(true)
    })

    it('应该正确提取文件名', () => {
      const media = Media.create('/path/to/video.mp4')
      expect(media.displayName).toBe('video.mp4')
    })
  })
})
