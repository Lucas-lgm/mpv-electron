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
    <!-- 播放错误提示（全屏遮罩，居中显示） -->
    <div v-if="playerError" class="error-overlay">
      <div class="error-content">
        <div class="error-title">播放出错</div>
        <div class="error-message">{{ playerError }}</div>
      </div>
    </div>
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
        <div class="progress-container">
          <el-slider
            :model-value="currentTime"
            :min="0"
            :max="duration > 0 ? duration : 100"
            :step="0.1"
            :show-tooltip="true"
            :format-tooltip="formatTime"
            @mousedown="onSeekStart"
            @touchstart.prevent="onSeekStart"
            @input="onSeek"
            @change="onSeekEnd"
            class="progress-slider"
          />
          <div class="time-display">
            <span class="time-current">{{ formatTime(currentTime) }}</span>
            <span class="time-total">{{ formatTime(duration) }}</span>
          </div>
        </div>
        <div class="control-row">
          <div class="control-left">
            <button @click="playPrevFromPlaylist" class="btn-control" title="上一首">⏮</button>
            <button @click="togglePlayPause" class="btn-control play-pause" :title="isPlaying ? '暂停' : '播放'">
              {{ isPlaying ? '⏸' : '▶' }}
            </button>
            <button @click="playNextFromPlaylist" class="btn-control" title="下一首">⏭</button>
            <button @click="stop" class="btn-control" title="停止">⏹</button>
          </div>
          <div class="control-right">
            <button @click="togglePlaylist" class="btn-control" title="播放列表">📋</button>
            <button
              v-if="!isWindows"
              @click="toggleHdr"
              class="btn-control"
              :title="hdrEnabled ? '关闭HDR' : '开启HDR'"
            >
              {{ hdrEnabled ? 'HDR' : 'SDR' }}
            </button>
            <button @click="toggleFullscreen" class="btn-control" title="全屏">⛶</button>
            <div class="volume-control">
              <button @click="toggleMute" class="btn-control" :title="volume > 0 ? '静音' : '取消静音'">
                {{ volume > 0 ? '🔊' : '🔇' }}
              </button>
              <el-slider
                class="volume-slider-el"
                :model-value="volume"
                :min="0"
                :max="100"
                :step="1"
                :show-tooltip="true"
                :format-tooltip="formatVolumeTooltip"
                @input="onVolumeInput"
                @change="onVolumeChangeEnd"
              />
              <span class="volume-percent">{{ volume }}%</span>
            </div>
            <button class="btn-control" title="设置">⚙️</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useControlBarAutoHide } from '../composables/useControlBarAutoHide'
import { useAdjustableValue } from '../composables/useAdjustableValue'

const isPlaying = ref(false)
// 进度条使用可调值模式（短暂保护期 + 正在拖动时本地优先）
const currentTimeAdjustable = useAdjustableValue<number>({
  initial: 0,
  debugLabel: 'timeline',
  // 进度条目前只在松手时真正 seek，这里不在 input 阶段发送命令
  sendOnInput: false,
  sendCommand: (t: number) => {
    if (window.electronAPI) {
      window.electronAPI.send('control-seek', t)
    }
  }
})
const currentTime = currentTimeAdjustable.value
const duration = ref(0)
const currentVideoName = ref<string>('')
const isLoading = ref(false)
const isSeeking = ref(false)
const isNetworkBuffering = ref(false)
const networkBufferingPercent = ref<number | null>(null)
const isScrubbing = ref(false)
const playerError = ref<string | null>(null)

interface PlaylistItem {
  name: string
  path: string
}

const playlist = ref<PlaylistItem[]>([])
const showPlaylist = ref(false)
const currentPath = ref<string | null>(null)
const hdrEnabled = ref(true)

// 音量采用通用可调值模式（短暂保护期）
const volumeAdjustable = useAdjustableValue<number>({
  initial: 100,
  debugLabel: 'volume',
  // 音量希望拖动时实时生效，所以在 onUserInput 阶段就发送命令
  sendOnInput: true,
  sendCommand: (v: number) => {
    // eslint-disable-next-line no-console
    console.log('[ControlView] send control-volume', v)
    if (window.electronAPI) {
      window.electronAPI.send('control-volume', Math.round(v))
    }
  }
})
const volume = volumeAdjustable.value


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

type PlayerStatusSnapshot = {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  currentTime: number
  duration: number
  volume: number
  path: string | null
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
  errorMessage?: string
}

const handlePlayVideo = (file: { name: string; path: string }) => {
  currentVideoName.value = file.name
  currentPath.value = file.path

  // 收到新的播放指令时，前端立即做一次乐观清理，
  // 避免等待后端 idle / loading 状态广播期间，UI 还停留在上一个错误 / 时间轴上。
  playerError.value = null
  isVideoReady.value = false
  isScrubbing.value = false
  isSeeking.value = false
  isNetworkBuffering.value = false
  networkBufferingPercent.value = null
  currentTimeAdjustable.reset(0)
  duration.value = 0
  // 先进入 loading 态，等后端真正广播 phase 再修正
  isLoading.value = true
}

const handlePlayerState = (status: PlayerStatusSnapshot) => {
  console.log('status:', status)
  const wasSeeking = isSeeking.value
  
  isSeeking.value = !!status.isSeeking
  isNetworkBuffering.value = !!status.isNetworkBuffering
  networkBufferingPercent.value =
    typeof status.networkBufferingPercent === 'number' ? status.networkBufferingPercent : null
  isLoading.value = status.phase === 'loading' || isSeeking.value || isNetworkBuffering.value
  const wasPlaying = isPlaying.value
  isPlaying.value = status.phase === 'playing'

  // 记录错误信息（由后端通过 PlayerState.error 传递而来）
  if (status.phase === 'error') {
    playerError.value = status.errorMessage || '播放出错'
    // 错误时也同步一下标题，避免依赖额外的 player-error 通道
    currentVideoName.value = `播放出错: ${playerError.value}`
  } else {
    playerError.value = null
  }
  
  // 判断是否应该显示黑色背景（只在视频真正开始播放或暂停时，背景才透明）
  isVideoReady.value = 
    status.phase === 'playing' || 
    status.phase === 'paused'
  
  // 使用 composable 处理播放状态变化
  handlePlayerStateChange(wasPlaying)
  
  // 更新 duration（只在有有效值时更新，避免覆盖）
  if (typeof status.duration === 'number' && status.duration > 0) {
    duration.value = status.duration
  }
  
  // 处理播放结束状态：将 currentTime 设置为 duration
  if (status.phase === 'ended') {
    if (duration.value > 0) {
      currentTimeAdjustable.applyServerState(duration.value)
    }
    isPlaying.value = false
  }
  
  // 当跳转完成时（isSeeking 从 true 变为 false），重置 isScrubbing
  if (wasSeeking && !isSeeking.value && isScrubbing.value) {
    isScrubbing.value = false
  }
  
  // 更新 currentTime（只在非拖动、非跳转状态下更新，且不是播放结束状态）
  if (typeof status.currentTime === 'number' && !isScrubbing.value && !isSeeking.value && status.phase !== 'ended') {
    currentTimeAdjustable.applyServerState(status.currentTime)
  }
  
  if (typeof status.volume === 'number') {
    // eslint-disable-next-line no-console
    console.log('[ControlView] handlePlayerState volume from backend', status.volume)
    volumeAdjustable.applyServerState(status.volume)
  }
  if (typeof status.path === 'string') {
    currentPath.value = status.path
    const found = playlist.value.find((item: PlaylistItem) => item.path === status.path)
    if (found) {
      currentVideoName.value = found.name
    } else {
      const parts = status.path.split(/[/\\]/)
      currentVideoName.value = parts[parts.length - 1] || status.path
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
  // 全屏切换时，先立即隐藏控制栏，避免渲染延迟导致的视觉问题
  // 网页渲染比原生窗口慢，先隐藏可以避免看到渲染延迟
  controlsVisible.value = false
  
  if (window.electronAPI) {
    window.electronAPI.send('control-toggle-fullscreen')
  }
  
  // 延迟恢复控制栏显示（如果需要）
  // 全屏时通常控制栏会自动隐藏，所以这里不需要立即恢复
  // 如果进入全屏，控制栏会保持隐藏直到用户交互
  // 如果退出全屏，控制栏会在用户交互时显示
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
  onUserInteraction()
  // 不立即改变 isPlaying，等待主进程响应回来的状态
  // 根据当前状态发送相反的命令
  if (window.electronAPI) {
    window.electronAPI.send(isPlaying.value ? 'control-pause' : 'control-play')
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
  // 不立即改变 isPlaying，等待主进程响应回来的状态（phase === 'stopped'）
  if (window.electronAPI) {
    window.electronAPI.send('control-stop')
  }
}

// 控制栏显示/隐藏逻辑已移至 useControlBarAutoHide composable

const onSeekStart = () => {
  isScrubbing.value = true
  onUserInteraction()
}

const onSeek = (value: number) => {
  currentTimeAdjustable.onUserInput(value)
  onUserInteraction()
}

const onSeekEnd = (value: number) => {
  onUserInteraction()
  // 使用可调值模式提交最终进度（发送 seek 命令）
  currentTimeAdjustable.onUserCommit(value)
  // 保持 isScrubbing = true，直到 isSeeking 状态更新
  // handlePlayerState 会在 isSeeking 变为 true 时处理，然后在 isSeeking 变为 false 时重置 isScrubbing
}

// 音量滑块（Element Plus）
const onVolumeInput = (value: number) => {
  onUserInteraction()
  volumeAdjustable.onUserInput(Math.round(value))
}

const onVolumeChangeEnd = (value: number) => {
  onUserInteraction()
  volumeAdjustable.onUserCommit(Math.round(value))
}

const formatVolumeTooltip = (value: number): string => {
  return `${Math.round(value)}%`
}

const toggleMute = () => {
  if (volume.value > 0) {
    // 静音：直接提交 0
    volumeAdjustable.onUserCommit(0)
  } else {
    // 恢复默认音量（目前简单使用 50%，如需记忆上次音量可在此扩展）
    volumeAdjustable.onUserCommit(50)
  }
}

onMounted(() => {
  if (window.electronAPI) {
    // 当前播放条目变更通知（由主进程广播）
    window.electronAPI.on('current-video-changed', handlePlayVideo)
    window.electronAPI.on('player-status', handlePlayerState)
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
    // 立即隐藏控制栏（用于全屏切换等场景，避免渲染延迟）
    window.electronAPI.on('control-bar-hide-immediate', () => {
      controlsVisible.value = false
    })
    
    window.electronAPI.send('get-playlist')
  }
})

onUnmounted(() => {
  // 清理自动隐藏 composable 的资源
  cleanupAutoHide()
  
  if (window.electronAPI) {
    window.electronAPI.removeListener('current-video-changed', handlePlayVideo)
    window.electronAPI.removeListener('player-status', handlePlayerState)
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
  transition: background 0.3s ease;
}

.control-view.video-not-ready {
  background: #1e1e24;
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
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  -webkit-app-region: drag;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 1;
  transition: opacity 0.3s ease;
  will-change: opacity;
  position: relative;
  z-index: 20;
}

/* 控制栏隐藏时，优化性能：减少 backdrop-filter 的性能消耗 */
.control-view.controls-hidden .header {
  /* 隐藏时使用更简单的背景，减少 backdrop-filter 的性能消耗 */
  backdrop-filter: blur(5px);
  /* 或者完全禁用 backdrop-filter */
  /* backdrop-filter: none; */
  /* background: rgba(0, 0, 0, 0.6); */
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

.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  pointer-events: auto;
  z-index: 10;
}

.error-content {
  max-width: 60%;
  padding: 1rem 1.75rem;
  border-radius: 12px;
  background: rgba(255, 59, 48, 0.15);
  border: 1px solid rgba(255, 95, 87, 0.7);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.55);
  color: #ffe9e7;
}

.error-title {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 1rem;
}

.error-message {
  word-break: break-word;
  font-size: 0.9rem;
  line-height: 1.5;
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
  opacity: 1;
  transition: opacity 0.3s ease;
  will-change: opacity;
  z-index: 20;
}

/* 只隐藏控制栏，不影响其他元素（如 loading-overlay、playlist-panel） */
.control-view.controls-hidden .header,
.control-view.controls-hidden .playback-controls {
  opacity: 0;
  pointer-events: none;
  /* 隐藏时禁用 transition，提升性能 */
  transition: none;
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

.progress-container {
  padding: 6px 12px 0;
  margin-bottom: 0;
}

/* Element Plus Slider 自定义样式 */
.progress-slider {
  width: 100%;
}

.progress-slider :deep(.el-slider__runway) {
  height: 6px;
  background-color: #3a3a3a;
  border-radius: 3px;
  margin: 0;
}

.progress-slider :deep(.el-slider__bar) {
  height: 6px;
  background-color: #ffffff;
  border-radius: 3px;
}

.progress-slider :deep(.el-slider__button-wrapper) {
  width: 16px;
  height: 16px;
  top: 0;
  margin-top: -7px;
}

.progress-slider :deep(.el-slider__button) {
  width: 16px;
  height: 16px;
  border: none;
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.progress-slider :deep(.el-slider__button):hover {
  width: 18px;
  height: 18px;
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.5);
}

.progress-slider :deep(.el-slider__button-wrapper):hover {
  width: 18px;
  height: 18px;
}

.progress-slider :deep(.el-slider__button-wrapper):hover .el-slider__button {
  width: 18px;
  height: 18px;
}

/* Tooltip 样式 */
.progress-slider :deep(.el-slider__button-wrapper .el-tooltip__trigger) {
  width: 100%;
  height: 100%;
}

.progress-slider :deep(.el-tooltip__popper) {
  background-color: rgba(0, 0, 0, 0.85);
  border: none;
  color: #ffffff;
  font-size: 0.85rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  padding: 4px 8px;
  border-radius: 4px;
}

.time-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px;
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}

.time-current {
  color: #ffffff;
  font-weight: 500;
}

.time-total {
  color: #ccc;
  font-weight: 400;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 10px;
  gap: 12px;
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
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-control:hover {
  background: rgba(255, 255, 255, 0.08);
}

.btn-control:active {
  transform: scale(0.95);
}

.btn-control.play-pause {
  width: 40px;
  height: 40px;
  font-size: 1.5rem;
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


.volume-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.control-right {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ccc;
  justify-content: flex-end;
}


.volume-icon {
  font-size: 0.9rem;
}

.volume-percent {
  font-size: 0.85rem;
  min-width: 40px;
  text-align: right;
  color: #ccc;
}

.volume-slider-el {
  width: 80px;
}

.volume-slider-el :deep(.el-slider__runway) {
  height: 4px;
  background-color: #3a3a3a;
  border-radius: 2px;
  margin: 0;
}

.volume-slider-el :deep(.el-slider__bar) {
  height: 4px;
  background-color: #ffffff;
  border-radius: 2px;
}

.volume-slider-el :deep(.el-slider__button-wrapper) {
  width: 12px;
  height: 12px;
  top: 0;
  margin-top: -4px; /* 圆心对齐 4px 轨道中线 */
}

.volume-slider-el :deep(.el-slider__button) {
  width: 12px;
  height: 12px;
  border: none;
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: all 0.2s;
  margin-top: -7px;
}
</style>
