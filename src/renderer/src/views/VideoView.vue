<template>
  <div class="video-view">
    <!-- 控制面板区域（mpv 会在独立窗口中播放） -->
    <div class="video-container">
      <div class="mpv-info">
        <p class="info-text">MPV 正在独立窗口中播放视频</p>
        <p class="hint">控制面板在下方</p>
      </div>
    </div>
    
    <!-- 控制面板 Overlay（底部，始终显示） -->
    <div class="control-overlay">
      <!-- 标题栏 -->
      <header class="control-header">
        <h1 class="video-title">{{ currentVideoName || 'MPV Player' }}</h1>
      </header>
      
      <!-- 播放控制 -->
      <div class="playback-controls">
        <div class="control-buttons">
          <button @click="togglePlayPause" class="btn-control" title="播放/暂停">
            {{ isPlaying ? '⏸️' : '▶️' }}
          </button>
          <button @click="seekBackward" class="btn-control" title="快退 10 秒">⏪</button>
          <button @click="seekForward" class="btn-control" title="快进 10 秒">⏩</button>
          <button @click="stop" class="btn-control" title="停止">⏹️</button>
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
          <span class="volume-icon">🔊</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="volume"
            @input="onVolumeChange"
            class="volume-bar"
          />
          <span class="volume-value">{{ volume }}%</span>
        </div>
      </div>
    </div>
    
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(100)
const currentVideoName = ref<string>('')

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
  seekTo(0)
  if (window.electronAPI) {
    window.electronAPI.send('control-pause')
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

// 控制面板始终显示，不需要自动隐藏

onMounted(() => {
  if (window.electronAPI) {
    window.electronAPI.on('video-time-update', (data: { currentTime: number; duration: number }) => {
      currentTime.value = data.currentTime
      duration.value = data.duration
    })
    
    window.electronAPI.on('video-ended', () => {
      isPlaying.value = false
      currentTime.value = 0
    })

    window.electronAPI.on('play-video', (file: { name: string; path: string }) => {
      currentVideoName.value = file.name
    })
    
    window.electronAPI.on('mpv-error', (error: { message: string }) => {
      console.error('MPV error:', error.message)
    })
  }
})

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.removeListener('video-time-update', () => {})
    window.electronAPI.removeListener('video-ended', () => {})
    window.electronAPI.removeListener('play-video', () => {})
    window.electronAPI.removeListener('mpv-error', () => {})
  }
})
</script>

<style scoped>
.video-view {
  width: 100%;
  height: 100vh;
  background: #000;
  position: relative;
  overflow: hidden;
}

.video-container {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
}

/* 控制面板 Overlay */
.control-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.85) 50%, rgba(0, 0, 0, 0.7) 100%);
  padding: 1.5rem 2rem 2rem;
  pointer-events: auto;
}

/* 标题栏 */
.control-header {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.video-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 播放控制区域 */
.playback-controls {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 800px;
  margin: 0 auto;
}

.control-buttons {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.btn-control {
  width: 56px;
  height: 56px;
  border: none;
  background: rgba(102, 126, 234, 0.9);
  color: white;
  border-radius: 50%;
  font-size: 1.5rem;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.btn-control:hover {
  background: rgba(102, 126, 234, 1);
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
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
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.875rem;
  font-weight: 500;
}

.progress-bar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  outline: none;
  cursor: pointer;
  -webkit-appearance: none;
}

.progress-bar::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  transition: transform 0.1s;
}

.progress-bar::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: rgba(255, 255, 255, 0.9);
}

.volume-icon {
  font-size: 1.25rem;
  width: 24px;
  text-align: center;
}

.volume-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
  outline: none;
  cursor: pointer;
  -webkit-appearance: none;
}

.volume-bar::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #667eea;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.volume-value {
  font-size: 0.875rem;
  font-weight: 500;
  min-width: 40px;
  text-align: right;
}

/* MPV 信息显示 */
.mpv-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
  padding-bottom: 250px; /* 为底部控制面板留出空间 */
}

.mpv-info .info-text {
  margin: 0.5rem 0;
  font-size: 1.1rem;
  font-weight: 500;
}

.mpv-info .hint {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 0.5rem;
}
</style>
