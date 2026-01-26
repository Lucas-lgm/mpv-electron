<template>
  <div v-if="loading" class="video-grid-loading">
    <div class="loading-spinner"></div>
    <div class="loading-text">加载中...</div>
  </div>
  <div v-else-if="videos.length === 0" class="video-grid-empty">
    <div class="empty-state-icon">📭</div>
    <div class="empty-state-title">暂无资源</div>
    <div class="empty-state-text">
      {{ emptyText || '点击上方按钮添加文件、URL或挂载路径' }}
    </div>
  </div>
  <div v-else :class="['video-grid', `view-${viewMode}`]">
    <VideoCard
      v-for="video in videos"
      :key="video.id"
      :video="video"
      :view-mode="viewMode"
      @play="$emit('video-play', $event)"
      @context-menu="$emit('video-context-menu', $event, $event[1])"
    />
  </div>
</template>

<script setup lang="ts">
import VideoCard from './VideoCard.vue'
import type { MediaResource, ViewMode } from '../types/media'

interface Props {
  videos: MediaResource[]
  viewMode?: ViewMode
  loading?: boolean
  emptyText?: string
}

withDefaults(defineProps<Props>(), {
  viewMode: 'grid',
  loading: false,
  emptyText: ''
})

defineEmits<{
  'video-play': [video: MediaResource]
  'video-context-menu': [event: MouseEvent, video: MediaResource]
}>()
</script>

<style scoped>
.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 20px;
}

.video-grid.view-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.video-grid-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #888;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #2d2d35;
  border-top-color: #4a9eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 0.9rem;
  color: #888;
}

.video-grid-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
  padding: 60px 20px;
}

.empty-state-icon {
  font-size: 4rem;
  margin-bottom: 20px;
  opacity: 0.3;
}

.empty-state-title {
  font-size: 1.2rem;
  font-weight: 500;
  color: #ccc;
  margin-bottom: 8px;
}

.empty-state-text {
  font-size: 0.9rem;
  color: #666;
  text-align: center;
  max-width: 400px;
}
</style>
