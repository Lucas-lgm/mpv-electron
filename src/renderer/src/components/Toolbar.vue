<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <slot name="left">
        <button class="btn-primary" @click="$emit('add-file')">
          <span>📁</span>
          <span>添加文件</span>
        </button>
        <button class="btn-primary" @click="$emit('add-url')">
          <span>🔗</span>
          <span>添加URL</span>
        </button>
        <button class="btn-primary" @click="$emit('mount-path')">
          <span>📂</span>
          <span>挂载路径</span>
        </button>
      </slot>
    </div>
    <div class="toolbar-right">
      <slot name="right">
        <ViewToggle :model-value="viewMode" @update:model-value="$emit('update:view-mode', $event)" />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import ViewToggle from './ViewToggle.vue'
import type { ViewMode } from '../types/media'

interface Props {
  viewMode: ViewMode
}

interface Emits {
  (e: 'add-file'): void
  (e: 'add-url'): void
  (e: 'mount-path'): void
  (e: 'update:view-mode', value: ViewMode): void
}

defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.toolbar {
  background: #25252d;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #2d2d35;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.btn-primary {
  background: #4a9eff;
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  font-family: inherit;
}

.btn-primary:hover {
  background: #5aaaff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
}

.btn-primary:active {
  transform: translateY(0);
}
</style>
