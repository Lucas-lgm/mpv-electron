<template>
  <div class="control-view">
    <header class="header">
      <h1 class="title">{{ currentVideoName || '视频播放器' }}</h1>
    </header>
    <main class="playback-controls">
      <div class="control-buttons">
        <button @click="togglePlayPause" class="btn-control">
          {{ isPlaying ? '⏸️' : '▶️' }}
        </button>
        <button @click="seekBackward" class="btn-control">⏪</button>
        <button @click="seekForward" class="btn-control">⏩</button>
        <button @click="stop" class="btn-control">⏹️</button>
      </div>
      <div class="progress-container">
        <div class="time-info">
          <span>{{ formatTime(currentTime) }}</span>
          <span>{{ formatTime(duration) }}</span>
        </div>
        <input
          type="range"
          :min="0"
          :max="duration || 100"
          :value="currentTime"
          @input="onSeek"
          class="progress-bar"
        />
      </div>
      <div class="volume-control">
        <span>🔊</span>
        <input
          type="range"
          min="0"
          max="100"
          :value="volume"
          @input="onVolumeChange"
          class="volume-bar"
        />
        <span>{{ volume }}%</span>
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
  // 同步音量和时长，时间仍由 video-time-update 驱动
  if (typeof state.duration === 'number') {
    duration.value = state.duration
  }
  if (typeof state.volume === 'number') {
    volume.value = state.volume
  }
}

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
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
  }
})
</script>

<style scoped>
.control-view {
  width: 100%;
  height: 100vh;
  /* 关键：让 Electron 窗口内容透明，避免覆盖底层 OpenGL */
  background: transparent;
  display: flex;
  flex-direction: column;
  pointer-events: none; /* 让点击事件透传到底层（如果以后要在 HTML 上操作，再调整） */
}

.header {
  padding: 1.5rem 2rem;
  background: rgba(42, 42, 42, 0.7);
  border-bottom: 1px solid #3a3a3a;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playback-controls {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
  pointer-events: auto; /* 控件本身仍然可以交互 */
}

.control-buttons {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.btn-control {
  width: 50px;
  height: 50px;
  border: none;
  background: #667eea;
  color: white;
  border-radius: 50%;
  font-size: 1.5rem;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.btn-control:hover {
  background: #5568d3;
  transform: scale(1.1);
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
