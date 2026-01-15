<template>
  <div class="control-view">
    <header class="header">
      <h1 class="title">{{ currentVideoName || '视频播放器' }}</h1>
    </header>
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
    <main class="playback-controls">
      <div class="control-bar">
        <div class="progress-wrapper">
          <input
            type="range"
            :min="0"
            :max="duration || 100"
            :value="currentTime"
            @input="onSeek"
            class="progress-bar"
          />
        </div>
        <div class="control-row">
          <div class="control-left">
            <button @click="togglePlayPause" class="btn-control">
              {{ isPlaying ? '⏸️' : '▶️' }}
            </button>
            <button @click="seekBackward" class="btn-control small">⏪</button>
            <button @click="seekForward" class="btn-control small">⏩</button>
            <button @click="stop" class="btn-control small">⏹️</button>
          </div>
          <div class="control-center">
            <span class="time-current">{{ formatTime(currentTime) }}</span>
            <span class="time-separator">/</span>
            <span class="time-total">{{ formatTime(duration) }}</span>
          </div>
          <div class="control-right">
            <button @click="togglePlaylist" class="btn-control small">📃</button>
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

const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(100)
const currentVideoName = ref<string>('')

interface PlaylistItem {
  name: string
  path: string
}

const playlist = ref<PlaylistItem[]>([])
const showPlaylist = ref(false)
const currentPath = ref<string | null>(null)

type PlayerState = {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  currentTime: number
  duration: number
  volume: number
  path: string | null
  error: string | null
}

const handleVideoTimeUpdate = (data: { currentTime: number; duration: number }) => {
  currentTime.value = data.currentTime
  duration.value = data.duration
}

const handleVideoEnded = () => {
  isPlaying.value = false
  currentTime.value = 0
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
  isPlaying.value = state.phase === 'playing'
  if (typeof state.duration === 'number') {
    duration.value = state.duration
  }
  if (typeof state.volume === 'number') {
    volume.value = state.volume
  }
  if (typeof state.path === 'string') {
    currentPath.value = state.path
  }
}

const handlePlaylistUpdated = (items: PlaylistItem[]) => {
  playlist.value = items
}

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const togglePlaylist = () => {
  showPlaylist.value = !showPlaylist.value
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
  if (window.electronAPI) {
    window.electronAPI.send(isPlaying.value ? 'control-play' : 'control-pause')
  }
}

const seekBackward = () => {
  const newTime = Math.max(0, currentTime.value - 10)
  seekTo(newTime)
}

const seekForward = () => {
  const newTime = Math.min(duration.value, currentTime.value + 10)
  seekTo(newTime)
}

const stop = () => {
  isPlaying.value = false
  if (window.electronAPI) {
    window.electronAPI.send('control-stop')
  }
}

const seekTo = (time: number) => {
  currentTime.value = time
  if (window.electronAPI) {
    window.electronAPI.send('control-seek', time)
  }
}

const onSeek = (event: Event) => {
  const target = event.target as HTMLInputElement
  seekTo(parseFloat(target.value))
}

const onVolumeChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  volume.value = parseInt(target.value)
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
    window.electronAPI.send('get-playlist')
  }
})

onUnmounted(() => {
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
  pointer-events: none;
}

.header {
  padding: 0.5rem 1rem;
  background: rgba(0, 0, 0, 0.4);
  -webkit-app-region: drag;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-panel {
  position: absolute;
  top: 40px;
  right: 0;
  bottom: 80px;
  width: 280px;
  background: rgba(0, 0, 0, 0.7);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(12px);
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
