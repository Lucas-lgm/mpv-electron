<template>
  <div 
    class="control-view" 
    :class="{ 
      'controls-hidden': !controlsVisible,
      'video-not-ready': !isVideoReady
    }"
  >
    <header 
      class="header"
      @mouseenter="onControlBarEnter"
      @mouseleave="onControlBarLeave"
    >
      <div class="window-controls">
        <button class="window-btn close" @click.stop="handleWindowAction('close')"></button>
        <button class="window-btn minimize" @click.stop="handleWindowAction('minimize')"></button>
        <button class="window-btn maximize" @click.stop="handleWindowAction('maximize')"></button>
      </div>
      <h1 class="title">{{ currentVideoName || '视频播放器' }}</h1>
    </header>
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-content">
        <span class="loading-text">
          {{
            isNetworkBuffering
              ? networkBufferingPercent !== null
                ? `网络缓冲中... ${networkBufferingPercent}%`
                : '网络缓冲中...'
              : isSeeking
                ? '正在跳转...'
                : '加载中...'
          }}
        </span>
      </div>
    </div>
    <div v-if="showPlaylist" class="playlist-panel">
      <div class="playlist-header">
        <span class="playlist-title">播放列表</span>
        <button class="playlist-close" @click="togglePlaylist">×</button>
      </div>
      <div class="playlist-body">
        <div
          v-if="playlist.length === 0"
          class="playlist-empty"
        >
          暂无播放列表
        </div>
        <div
          v-for="item in playlist"
          :key="item.path"
          :class="['playlist-item', { active: item.path === currentPath }]"
          @click="playFromPlaylist(item)"
        >
          <div class="playlist-item-name">{{ item.name }}</div>
          <div class="playlist-item-path">{{ item.path }}</div>
        </div>
      </div>
    </div>
    <main 
      class="playback-controls"
      @mouseenter="onControlBarEnter"
      @mouseleave="onControlBarLeave"
    >
      <div class="control-bar">
        <div class="progress-wrapper">
          <input
            type="range"
            :min="0"
            :max="duration > 0 ? duration : 100"
            :value="currentTime"
            @mousedown="onSeekStart"
            @touchstart.prevent="onSeekStart"
            @input="onSeek"
            @mouseup="onSeekEnd"
            @touchend.prevent="onSeekEnd"
            class="progress-bar"
          />
        </div>
        <div class="control-row">
          <div class="control-left">
            <button @click="togglePlayPause" class="btn-control">
              {{ isPlaying ? '⏸️' : '▶️' }}
            </button>
            <button @click="playPrevFromPlaylist" class="btn-control small">⏪</button>
            <button @click="playNextFromPlaylist" class="btn-control small">⏩</button>
            <button @click="stop" class="btn-control small">⏹️</button>
          </div>
          <div class="control-center">
            <span class="time-current">{{ formatTime(currentTime) }}</span>
            <span class="time-separator">/</span>
            <span class="time-total">{{ formatTime(duration) }}</span>
          </div>
          <div class="control-right">
            <button @click="togglePlaylist" class="btn-control small">📃</button>
            <button
              v-if="!isWindows"
              @click="toggleHdr"
              class="btn-control small"
            >
              {{ hdrEnabled ? 'HDR' : 'SDR' }}
            </button>
            <button @click="toggleFullscreen" class="btn-control small">⛶</button>
            <span class="volume-icon">🔊</span>
            <input
              type="range"
              min="0"
              max="100"
              :value="volume"
              @input="onVolumeChange"
              class="volume-bar"
            />
            <span class="volume-percent">{{ volume }}%</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useControlBarAutoHide } from '../composables/useControlBarAutoHide'

const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(100)
const currentVideoName = ref<string>('')
const isLoading = ref(false)
const isSeeking = ref(false)
const isNetworkBuffering = ref(false)
const networkBufferingPercent = ref<number | null>(null)
const isScrubbing = ref(false)

interface PlaylistItem {
  name: string
  path: string
}

const playlist = ref<PlaylistItem[]>([])
const showPlaylist = ref(false)
const currentPath = ref<string | null>(null)
const hdrEnabled = ref(true)

// 判断视频是否已准备好（已加载完成，可以播放）
// 当 phase 为 'playing' 或 'paused' 时，说明视频已加载完成
const isVideoReady = ref(false)

// 使用控制栏自动隐藏 composable
const autoHide = useControlBarAutoHide({
  isPlaying,
  isLoading,
  isScrubbing,
  debug: false
})

const {
  controlsVisible,
  onControlBarEnter,
  onControlBarLeave,
  onUserInteraction,
  handlePlayerStateChange,
  showControls,
  scheduleHide,
  cleanup: cleanupAutoHide
} = autoHide

// 仅在 Electron 渲染进程运行，不考虑 SSR，直接用 window 判断平台
const isWindows =
  typeof window !== 'undefined' &&
  typeof window.electronAPI !== 'undefined' &&
  window.electronAPI.platform === 'win32'

type PlayerState = {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  currentTime: number
  duration: number
  volume: number
  path: string | null
  error: string | null
  isSeeking: boolean
  isCoreIdle: boolean
  isIdleActive: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
}

const handleVideoTimeUpdate = (data: { currentTime: number; duration: number }) => {
  // 在拖动进度条或跳转中时，不更新 currentTime，避免跳转
  if (!isScrubbing.value && !isSeeking.value) {
    currentTime.value = data.currentTime
  }
  // 只在有有效值时更新 duration，避免播放结束时被设置为 0
  if (typeof data.duration === 'number' && data.duration > 0) {
    duration.value = data.duration
  }
}

const handleVideoEnded = () => {
  isPlaying.value = false
  // 播放结束时，将 currentTime 设置为 duration，而不是 0
  if (duration.value > 0) {
    currentTime.value = duration.value
  }
}

const handlePlayVideo = (file: { name: string; path: string }) => {
  currentVideoName.value = file.name
  currentPath.value = file.path
}

const handlePlayerError = (payload: { message: string }) => {
  isPlaying.value = false
  currentVideoName.value = `播放出错: ${payload.message}`
}

const handlePlayerEmbedded = (payload: { embedded: boolean; mode: string }) => {
  console.log('player embedded mode:', payload)
}

const handlePlayerState = (state: PlayerState) => {
  console.log('state:', state)
  const wasSeeking = isSeeking.value
  isSeeking.value = !!state.isSeeking
  isNetworkBuffering.value = !!state.isNetworkBuffering
  networkBufferingPercent.value =
    typeof state.networkBufferingPercent === 'number' ? state.networkBufferingPercent : null
  isLoading.value = state.phase === 'loading' || isSeeking.value || isNetworkBuffering.value
  const wasPlaying = isPlaying.value
  isPlaying.value = state.phase === 'playing'
  
  // 判断是否应该显示黑色背景（只在视频真正开始播放或暂停时，背景才透明）
  isVideoReady.value = 
    state.phase === 'playing' || 
    state.phase === 'paused'
  
  // 使用 composable 处理播放状态变化
  handlePlayerStateChange(wasPlaying)
  
  // 更新 duration（只在有有效值时更新，避免覆盖）
  if (typeof state.duration === 'number' && state.duration > 0) {
    duration.value = state.duration
  }
  
  // 处理播放结束状态：将 currentTime 设置为 duration
  if (state.phase === 'ended') {
    if (duration.value > 0) {
      currentTime.value = duration.value
    }
    isPlaying.value = false
  }
  
  // 当跳转完成时（isSeeking 从 true 变为 false），重置 isScrubbing
  if (wasSeeking && !isSeeking.value && isScrubbing.value) {
    isScrubbing.value = false
  }
  
  // 更新 currentTime（只在非拖动、非跳转状态下更新，且不是播放结束状态）
  if (typeof state.currentTime === 'number' && !isScrubbing.value && !isSeeking.value && state.phase !== 'ended') {
    currentTime.value = state.currentTime
  }
  
  if (typeof state.volume === 'number') {
    volume.value = state.volume
  }
  if (typeof state.path === 'string') {
    currentPath.value = state.path
    const found = playlist.value.find((item: PlaylistItem) => item.path === state.path)
    if (found) {
      currentVideoName.value = found.name
    } else {
      const parts = state.path.split(/[/\\]/)
      currentVideoName.value = parts[parts.length - 1] || state.path
    }
  }
}

const handlePlaylistUpdated = (items: PlaylistItem[]) => {
  playlist.value = items
}

const formatTime = (seconds: number): string => {
  // 明确检查是否为 NaN 或 undefined/null，而不是使用 !seconds（因为 0 也是 falsy）
  if (seconds == null || isNaN(seconds)) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const togglePlaylist = () => {
  showPlaylist.value = !showPlaylist.value
}

const toggleFullscreen = () => {
  if (window.electronAPI) {
    window.electronAPI.send('control-toggle-fullscreen')
  }
}

const handleWindowAction = (action: 'close' | 'minimize' | 'maximize') => {
  if (window.electronAPI) {
    window.electronAPI.send('control-window-action', action)
  }
}

const toggleHdr = () => {
  hdrEnabled.value = !hdrEnabled.value
  if (window.electronAPI) {
    window.electronAPI.send('control-hdr', hdrEnabled.value)
  }
}

const playFromPlaylist = (item: PlaylistItem) => {
  if (window.electronAPI) {
    window.electronAPI.send('play-video', {
      name: item.name,
      path: item.path
    })
  }
}

const togglePlayPause = () => {
  isPlaying.value = !isPlaying.value
  onUserInteraction()
  if (window.electronAPI) {
    window.electronAPI.send(isPlaying.value ? 'control-play' : 'control-pause')
  }
}

const playPrevFromPlaylist = () => {
  if (window.electronAPI) {
    window.electronAPI.send('play-playlist-prev')
  }
}

const playNextFromPlaylist = () => {
  if (window.electronAPI) {
    window.electronAPI.send('play-playlist-next')
  }
}

const stop = () => {
  isPlaying.value = false
  if (window.electronAPI) {
    window.electronAPI.send('control-stop')
  }
}

// 控制栏显示/隐藏逻辑已移至 useControlBarAutoHide composable

const onSeekStart = () => {
  isScrubbing.value = true
  onUserInteraction()
}

const onSeekEnd = () => {
  const time = currentTime.value
  onUserInteraction()
  if (window.electronAPI) {
    window.electronAPI.send('control-seek', time)
  }
  // 保持 isScrubbing = true，直到 isSeeking 状态更新
  // 这样可以确保拖动位置不会被 handleVideoTimeUpdate 覆盖
  // handlePlayerState 会在 isSeeking 变为 true 时处理，然后在 isSeeking 变为 false 时重置 isScrubbing
}

const onSeek = (event: Event) => {
  const target = event.target as HTMLInputElement
  currentTime.value = parseFloat(target.value)
  onUserInteraction()
}

const onVolumeChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  volume.value = parseInt(target.value)
  onUserInteraction()
  if (window.electronAPI) {
    window.electronAPI.send('control-volume', volume.value)
  }
}

onMounted(() => {
  if (window.electronAPI) {
    window.electronAPI.on('video-time-update', handleVideoTimeUpdate)
    window.electronAPI.on('video-ended', handleVideoEnded)
    window.electronAPI.on('play-video', handlePlayVideo)
    window.electronAPI.on('player-error', handlePlayerError)
    window.electronAPI.on('player-embedded', handlePlayerEmbedded)
    window.electronAPI.on('player-state', handlePlayerState)
    window.electronAPI.on('playlist-updated', handlePlaylistUpdated)
    
    // 控制栏显示/隐藏 IPC 消息（macOS BrowserView 模式）
    window.electronAPI.on('control-bar-show', () => {
      showControls()
    })
    window.electronAPI.on('control-bar-schedule-hide', () => {
      if (isPlaying.value && !isLoading.value && !isScrubbing.value) {
        scheduleHide()
      }
    })
    
    window.electronAPI.send('get-playlist')
  }
})

onUnmounted(() => {
  // 清理自动隐藏 composable 的资源
  cleanupAutoHide()
  
  if (window.electronAPI) {
    window.electronAPI.removeListener('video-time-update', handleVideoTimeUpdate)
    window.electronAPI.removeListener('video-ended', handleVideoEnded)
    window.electronAPI.removeListener('play-video', handlePlayVideo)
    window.electronAPI.removeListener('player-error', handlePlayerError)
    window.electronAPI.removeListener('player-embedded', handlePlayerEmbedded)
    window.electronAPI.removeListener('player-state', handlePlayerState)
    window.electronAPI.removeListener('playlist-updated', handlePlaylistUpdated)
  }
})
</script>

<style scoped>
.control-view {
  width: 100%;
  height: 100vh;
  background: transparent;
  display: flex;
  flex-direction: column;
  contain: layout style paint;
  transform: translateZ(0);
  will-change: transform;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* 整个 control-view 都可以接收鼠标事件，用于触发控制栏显示 */
  /* 但背景是透明的，不会遮挡视频 */
  transition: background 0.3s ease;
}

/* 视频未准备好时（未加载完成或未开始播放），显示纯黑背景 */
.control-view.video-not-ready {
  background: #000;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}

.loading-content {
  padding: 0.75rem 1.5rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.85);
}

.loading-text {
  color: #ffffff;
  font-size: 0.9rem;
}

.header {
  padding: 0.5rem 0.75rem 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.4);
  -webkit-app-region: drag;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 1;
  transition: opacity 0.3s ease;
  will-change: opacity;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

.title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: center;
}

.window-btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  background-color: #808080;
  opacity: 0.9;
  transition: opacity 0.15s ease;
}

.window-btn.close {
  background-color: #ff5f57;
}

.window-btn.minimize {
  background-color: #febc2e;
}

.window-btn.maximize {
  background-color: #28c840;
}

.window-btn:hover {
  opacity: 1;
}

.playlist-panel {
  position: absolute;
  top: 40px;
  right: 0;
  bottom: 80px;
  width: 280px;
  background: rgba(0, 0, 0, 0.85);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  /* 移除 backdrop-filter 以提高性能，特别是在 8K 视频上 */
  /* backdrop-filter: blur(12px); */
  /* 使用 will-change 优化渲染性能 */
  will-change: transform, opacity;
}

.playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  color: #fff;
  font-size: 0.9rem;
}

.playlist-title {
  font-weight: 500;
}

.playlist-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 1.1rem;
}

.playlist-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 8px;
}

.playlist-empty {
  padding: 12px;
  font-size: 0.85rem;
  color: #aaa;
}

.playlist-item {
  padding: 8px 12px;
  font-size: 0.85rem;
  color: #ddd;
  cursor: pointer;
}

.playlist-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.playlist-item.active {
  background: #4f46e5;
  color: #fff;
}

.playlist-item-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-item-path {
  margin-top: 2px;
  font-size: 0.75rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playback-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: block;
  padding: 0;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
  opacity: 1;
  transition: opacity 0.3s ease;
  will-change: opacity;
}

/* 只隐藏控制栏，不影响其他元素（如 loading-overlay、playlist-panel） */
.control-view.controls-hidden .header,
.control-view.controls-hidden .playback-controls {
  opacity: 0;
  pointer-events: none;
}

/* 确保 loading-overlay 和 playlist-panel 始终可见（如果它们需要显示） */
.control-view.controls-hidden .loading-overlay,
.control-view.controls-hidden .playlist-panel {
  opacity: 1;
  pointer-events: auto;
}

.control-bar {
  width: 100%;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 0;
  overflow: hidden;
}

.progress-wrapper {
  padding: 6px 12px 0;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 10px;
}

.control-buttons {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.btn-control {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #ffffff;
  border-radius: 0;
  font-size: 1.2rem;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.btn-control:hover {
  background: rgba(255, 255, 255, 0.08);
}

.btn-control:active {
  transform: scale(0.95);
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.time-info {
  display: flex;
  justify-content: space-between;
  color: #ccc;
  font-size: 0.875rem;
}

.progress-bar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #3a3a3a;
  outline: none;
  cursor: pointer;
}

.progress-bar::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: #ccc;
}

.control-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.control-center {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: #ccc;
  font-size: 0.9rem;
  min-width: 120px;
  justify-content: center;
}

.control-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #ccc;
  min-width: 180px;
  justify-content: flex-end;
}

.time-current,
.time-total {
  font-variant-numeric: tabular-nums;
}

.volume-icon {
  font-size: 0.9rem;
}

.volume-percent {
  font-size: 0.85rem;
  min-width: 40px;
  text-align: right;
}

.volume-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: #3a3a3a;
  outline: none;
  cursor: pointer;
}

.volume-bar::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
}
</style>
