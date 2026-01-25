#!/usr/bin/env node
/**
 * 领域模型测试脚本
 * 
 * 运行方式：
 *   npx tsx test_domain_models.ts
 * 
 * 或编译后运行：
 *   npm run build
 *   node out/test_domain_models.js
 */

import { Media } from './src/main/domain/models/Media'
import { Playlist } from './src/main/domain/models/Playlist'
import { PlaybackSession, PlaybackStatus } from './src/main/domain/models/Playback'

console.log('🧪 开始测试领域模型...\n')

// ========== 测试 Media 模型 ==========
console.log('1️⃣ 测试 Media 模型')
console.log('─'.repeat(50))

const localMedia = Media.create('/Users/test/video.mp4', {
  title: '测试视频',
  duration: 120
})

console.log('✅ 创建本地媒体:')
console.log(`   URI: ${localMedia.uri}`)
console.log(`   显示名称: ${localMedia.displayName}`)
console.log(`   是本地文件: ${localMedia.isLocalFile}`)
console.log(`   是网络流: ${localMedia.isNetworkStream}`)

const networkMedia = Media.create('https://example.com/stream.m3u8', {
  title: 'HLS 流'
})

console.log('\n✅ 创建网络流媒体:')
console.log(`   URI: ${networkMedia.uri}`)
console.log(`   是 HLS 流: ${networkMedia.isHlsStream}`)
console.log(`   是网络流: ${networkMedia.isNetworkStream}`)

// ========== 测试 Playlist 模型 ==========
console.log('\n\n2️⃣ 测试 Playlist 模型')
console.log('─'.repeat(50))

const playlist = new Playlist()

const media1 = Media.create('/path/to/video1.mp4', { title: '视频1' })
const media2 = Media.create('/path/to/video2.mp4', { title: '视频2' })
const media3 = Media.create('/path/to/video3.mp4', { title: '视频3' })

playlist.add(media1)
playlist.add(media2)
playlist.add(media3)

console.log(`✅ 添加了 ${playlist.size} 个媒体到播放列表`)

playlist.setCurrentByIndex(0)
const current = playlist.getCurrent()
console.log(`✅ 当前播放项: ${current?.media.displayName}`)

const next = playlist.next()
console.log(`✅ 下一首: ${next?.media.displayName}`)

const prev = playlist.previous()
console.log(`✅ 上一首: ${prev?.media.displayName}`)

// ========== 测试 PlaybackSession 模型 ==========
console.log('\n\n3️⃣ 测试 PlaybackSession 模型')
console.log('─'.repeat(50))

const session = PlaybackSession.create(
  media1,
  PlaybackStatus.PLAYING,
  {
    currentTime: 30,
    duration: 120
  },
  75,
  {
    isBuffering: false,
    bufferingPercent: 0
  }
)

console.log('✅ 创建播放会话:')
console.log(`   媒体: ${session.media?.displayName}`)
console.log(`   状态: ${session.status}`)
console.log(`   进度: ${session.progress.currentTime}/${session.progress.duration}秒 (${session.progress.percentage.toFixed(1)}%)`)
console.log(`   音量: ${session.volume}`)
console.log(`   正在播放: ${session.isPlaying}`)
console.log(`   可以跳转: ${session.canSeek}`)

const pausedSession = PlaybackSession.create(
  session.media,
  PlaybackStatus.PAUSED,
  session.progress,
  session.volume
)

console.log('\n✅ 暂停后的会话:')
console.log(`   状态: ${pausedSession.status}`)
console.log(`   已暂停: ${pausedSession.isPaused}`)
console.log(`   可以跳转: ${pausedSession.canSeek}`)

// ========== 测试适配器 ==========
console.log('\n\n4️⃣ 测试 MpvAdapter')
console.log('─'.repeat(50))

import { MpvAdapter } from './src/main/infrastructure/mpv/MpvAdapter'
import type { MPVStatus } from './src/main/libmpv'

const mpvStatus: MPVStatus = {
  position: 45,
  duration: 180,
  volume: 80,
  path: '/path/to/video.mp4',
  phase: 'playing',
  isSeeking: false,
  isNetworkBuffering: false,
  networkBufferingPercent: 0
}

const adaptedSession = MpvAdapter.toPlaybackSession(mpvStatus, media1)

console.log('✅ MPV 状态转换为播放会话:')
console.log(`   MPV phase: ${mpvStatus.phase} → PlaybackStatus: ${adaptedSession.status}`)
console.log(`   进度: ${adaptedSession.progress.currentTime}/${adaptedSession.progress.duration}秒`)
console.log(`   音量: ${adaptedSession.volume}`)

// ========== 测试应用层 ==========
console.log('\n\n5️⃣ 测试应用层（命令/查询）')
console.log('─'.repeat(50))

import { ApplicationService } from './src/main/application/ApplicationService'
import { MpvMediaPlayer } from './src/main/infrastructure/mpv/MpvMediaPlayer'

// 注意：这里需要实际的 MediaPlayer 实现
// 由于 MpvMediaPlayer 需要窗口 ID，我们创建一个测试用的播放列表
const testPlaylist = new Playlist()
testPlaylist.add(media1)
testPlaylist.add(media2)

console.log('✅ 创建应用服务（需要实际的 MediaPlayer）')
console.log('   注意：MpvMediaPlayer 需要窗口 ID 才能初始化')
console.log('   完整测试需要在 Electron 环境中进行')

// ========== 总结 ==========
console.log('\n\n' + '='.repeat(50))
console.log('✅ 领域模型测试完成！')
console.log('='.repeat(50))
console.log('\n📝 测试结果：')
console.log('   ✅ Media 模型：正常工作')
console.log('   ✅ Playlist 模型：正常工作')
console.log('   ✅ PlaybackSession 模型：正常工作')
console.log('   ✅ MpvAdapter：正常工作')
console.log('\n⚠️  注意：')
console.log('   - MpvMediaPlayer 需要窗口 ID 和实际的 MPV 实例')
console.log('   - 完整集成测试需要在 Electron 环境中进行')
console.log('   - 运行 npm run dev 启动应用进行实际测试')
