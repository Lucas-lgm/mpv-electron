<template>
  <div
    class="video-card"
    :class="{ 'list-view': viewMode === 'list' }"
    @click="$emit('play', video)"
    @contextmenu.prevent="$emit('context-menu', $event, video)"
  >
    <div class="video-thumbnail">
      <span class="video-thumbnail-icon">{{ getThumbnailIcon() }}</span>
      <div class="video-play-overlay">
        <div class="play-icon">▶</div>
      </div>
    </div>
    <div class="video-info">
      <div class="video-title">
        <span class="video-title-text">{{ video.name }}</span>
        <SourceBadge :source="video.source" />
      </div>
      <div class="video-meta">
        <span v-if="video.duration">{{ formatDuration(video.duration) }}</span>
        <span v-if="video.duration && video.size" class="video-meta-separator">•</span>
        <span v-if="video.size">{{ formatSize(video.size) }}</span>
        <span v-if="video.mountPath" class="video-meta-separator">•</span>
        <span v-if="video.mountPath" class="video-mount-path">{{ video.mountPath }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SourceBadge from './SourceBadge.vue'
import type { MediaResource, ViewMode } from '../types/media'

interface Props {
  video: MediaResource
  viewMode?: ViewMode
}

withDefaults(defineProps<Props>(), {
  viewMode: 'grid'
})

defineEmits<{
  play: [video: MediaResource]
  'context-menu': [event: MouseEvent, video: MediaResource]
}>()

const getThumbnailIcon = () => {
  const icons = ['🎥', '🎬', '📹', '🎞️', '📼', '🎭']
  return icons[Math.floor(Math.random() * icons.length)]
}

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
</script>

<style scoped>
.video-card {
  background: #25252d;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s;
  border: 1px solid #2d2d35;
  position: relative;
}

.video-card:hover {
  transform: translateY(-4px);
  border-color: #4a9eff;
  box-shadow: 0 8px 24px rgba(74, 158, 255, 0.2);
}

.video-thumbnail {
  width: 100%;
  height: 140px;
  background: linear-gradient(135deg, #2a2a32 0%, #2d2d35 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  position: relative;
  border-bottom: 1px solid #2d2d35;
}

.video-thumbnail-icon {
  z-index: 0;
}

.video-thumbnail::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 0.3s;
  z-index: 1;
}

.video-card:hover .video-thumbnail::after {
  opacity: 1;
}

.video-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s;
  z-index: 2;
}

.video-card:hover .video-play-overlay {
  opacity: 1;
}

.play-icon {
  width: 56px;
  height: 56px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: #0a0a0a;
  transform: scale(0.9);
  transition: transform 0.3s;
}

.video-card:hover .play-icon {
  transform: scale(1);
}

.video-info {
  flex: 1;
  padding: 12px;
}

.video-title {
  font-weight: 500;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  color: #fff;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.video-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.video-meta {
  color: #888;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.video-meta-separator {
  color: #444;
}

.video-mount-path {
  color: #888;
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* 列表视图样式 */
.video-card.list-view {
  display: flex;
  flex-direction: row;
}

.video-card.list-view .video-thumbnail {
  width: 200px;
  height: 120px;
  flex-shrink: 0;
  border-bottom: none;
  border-right: 1px solid #2d2d35;
}

.video-card.list-view .video-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
</style>
