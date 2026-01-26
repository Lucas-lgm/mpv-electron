<template>
  <div class="content-area">
    <ContentHeader :title="title" :subtitle="subtitle" />
    <VideoGrid
      :videos="videos"
      :view-mode="viewMode"
      :loading="loading"
      :empty-text="emptyText"
      @video-play="$emit('video-play', $event)"
      @video-context-menu="$emit('video-context-menu', $event, $event[1])"
    />
  </div>
</template>

<script setup lang="ts">
import ContentHeader from './ContentHeader.vue'
import VideoGrid from './VideoGrid.vue'
import type { MediaResource, ViewMode } from '../types/media'

interface Props {
  title: string
  subtitle?: string
  videos: MediaResource[]
  viewMode?: ViewMode
  loading?: boolean
  emptyText?: string
}

withDefaults(defineProps<Props>(), {
  subtitle: '',
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
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: #1e1e24;
}
</style>
