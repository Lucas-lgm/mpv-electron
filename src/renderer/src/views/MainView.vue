<template>
  <div class="main-view">
    <header class="header">
      <h1>视频文件列表</h1>
      <button @click="selectVideoFile" class="btn-primary">选择视频文件</button>
    </header>
    <main class="content">
      <div class="url-bar">
        <input
          v-model="url"
          type="text"
          placeholder="输入 http/https 视频地址"
          class="url-input"
        />
        <button @click="playUrl" class="btn-url-play">播放 URL</button>
      </div>
      <div v-if="videoFiles.length === 0" class="empty-state">
        <p>暂无视频文件</p>
        <p>点击上方按钮选择视频文件</p>
      </div>
      <div v-else class="video-list">
        <div
          v-for="(file, index) in videoFiles"
          :key="index"
          class="video-item"
          @click="playVideo(file)"
        >
          <div class="video-icon">🎬</div>
          <div class="video-info">
            <div class="video-name">{{ file.name }}</div>
            <div class="video-path">{{ file.path }}</div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface VideoFile {
  name: string
  path: string
}

const videoFiles = ref<VideoFile[]>([])
const url = ref('')

const selectVideoFile = () => {
  // 通过 IPC 打开文件选择对话框
  if (window.electronAPI) {
    window.electronAPI.send('select-video-file')
  }
}

const playVideo = (file: VideoFile) => {
  // 发送播放视频的消息
  // 需要发送一个普通对象，而不是响应式对象（Proxy），因为 IPC 无法序列化 Proxy
  if (window.electronAPI) {
    window.electronAPI.send('play-video', {
      name: file.name,
      path: file.path
    })
  }
}

const playUrl = () => {
  const value = url.value.trim()
  if (!value) return
  if (!value.startsWith('http://') && !value.startsWith('https://')) return
  if (window.electronAPI) {
    window.electronAPI.send('play-url', value)
  }
}

const handleVideoFileSelected = (file: VideoFile) => {
  videoFiles.value.push(file)
}

onMounted(() => {
  if (window.electronAPI) {
    window.electronAPI.on('video-file-selected', handleVideoFileSelected)
  }
})

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.removeListener('video-file-selected', handleVideoFileSelected)
  }
})
</script>

<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a1a;
  color: #fff;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #2a2a2a;
  border-bottom: 1px solid #3a3a3a;
}

.header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.btn-primary {
  padding: 0.5rem 1.5rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #5568d3;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.url-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.url-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  border: 1px solid #3a3a3a;
  background: #111;
  color: #fff;
  outline: none;
}

.url-input::placeholder {
  color: #777;
}

.btn-url-play {
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  border: none;
  background: #22c55e;
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}

.btn-url-play:hover {
  background: #16a34a;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
}

.video-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.video-item {
  display: flex;
  align-items: center;
  padding: 1rem;
  background: #2a2a2a;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.video-item:hover {
  background: #3a3a3a;
  transform: translateY(-2px);
}

.video-icon {
  font-size: 2rem;
  margin-right: 1rem;
}

.video-info {
  flex: 1;
}

.video-name {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.video-path {
  font-size: 0.875rem;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
