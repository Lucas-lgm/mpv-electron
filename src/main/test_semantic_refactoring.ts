/**
 * 语义化重构测试入口
 * 
 * 在 Electron 主进程中调用此文件进行测试
 * 
 * 使用方法：
 * 1. 在 main.ts 中导入：import './test_semantic_refactoring'
 * 2. 或通过 IPC 命令触发测试
 */

import { Media } from './domain/models/Media'
import { Playlist } from './domain/models/Playlist'
import { PlaybackSession, PlaybackStatus } from './domain/models/Playback'
import { MpvAdapter } from './infrastructure/mpv/MpvAdapter'
import type { MPVStatus } from './infrastructure/mpv/libmpv'

export async function testDomainModels(): Promise<void> {
  console.log('\n🧪 ========== 领域模型测试 ==========\n')

  // 测试 Media
  console.log('1️⃣ 测试 Media 模型')
  const localMedia = Media.create('/Users/test/video.mp4', {
    title: '测试视频',
    duration: 120
  })
  console.log(`   ✅ 创建媒体: ${localMedia.displayName}`)
  console.log(`   ✅ 是本地文件: ${localMedia.isLocalFile}`)
  console.log(`   ✅ 是网络流: ${localMedia.isNetworkStream}`)

  const networkMedia = Media.create('https://example.com/stream.m3u8')
  console.log(`   ✅ 创建网络流: ${networkMedia.isHlsStream}`)

  // 测试 Playlist
  console.log('\n2️⃣ 测试 Playlist 模型')
  const playlist = new Playlist()
  const media1 = Media.create('/path/to/video1.mp4', { title: '视频1' })
  const media2 = Media.create('/path/to/video2.mp4', { title: '视频2' })
  
  playlist.add(media1)
  playlist.add(media2)
  console.log(`   ✅ 播放列表大小: ${playlist.size}`)
  
  playlist.setCurrentByIndex(0)
  const current = playlist.getCurrent()
  console.log(`   ✅ 当前播放项: ${current?.media.displayName}`)
  
  const next = playlist.next()
  console.log(`   ✅ 下一首: ${next?.media.displayName}`)

  // 测试 PlaybackSession
  console.log('\n3️⃣ 测试 PlaybackSession 模型')
  const session = PlaybackSession.create(
    media1,
    PlaybackStatus.PLAYING,
    { currentTime: 30, duration: 120 },
    75
  )
  console.log(`   ✅ 播放状态: ${session.status}`)
  console.log(`   ✅ 正在播放: ${session.isPlaying}`)
  console.log(`   ✅ 可以跳转: ${session.canSeek}`)
  console.log(`   ✅ 进度: ${session.progress.percentage.toFixed(1)}%`)

  // 测试 MpvAdapter
  console.log('\n4️⃣ 测试 MpvAdapter')
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
  console.log(`   ✅ MPV phase → PlaybackStatus: ${mpvStatus.phase} → ${adaptedSession.status}`)
  console.log(`   ✅ 进度转换: ${adaptedSession.progress.percentage.toFixed(1)}%`)

  // 测试 PlayerStateMachine（session → getState）
  console.log('\n5️⃣ 测试 PlayerStateMachine')
  const { PlayerStateMachine } = await import('./application/state/playerState')
  const sm = new PlayerStateMachine()
  sm.updateFromStatus({
    ...mpvStatus,
    isCoreIdle: true,
    isIdleActive: true
  })
  const state = sm.getState()
  console.log(`   ✅ updateFromStatus → getState: phase=${state.phase} path=${state.path} isCoreIdle=${state.isCoreIdle}`)
  let emitted = false
  sm.on('state', () => { emitted = true })
  sm.setPhase('paused')
  console.log(`   ✅ setPhase → emit: ${emitted ? 'yes' : 'no'}`)

  console.log('\n✅ ========== 领域模型测试完成 ==========\n')
}

// 注意：在 ES 模块中，不能使用 require.main === module
// 如果需要直接运行，可以使用：node --loader tsx src/main/test_semantic_refactoring.ts
// 或者通过 Electron 应用中的 IPC 命令调用
