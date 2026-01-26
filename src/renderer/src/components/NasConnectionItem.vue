<template>
  <div
    :class="['sidebar-nas-item', { active }]"
    @click="$emit('select')"
  >
    <span class="sidebar-item-icon">📡</span>
    <div class="sidebar-nas-info">
      <span class="sidebar-nas-name">{{ nasConnection.name }}</span>
      <span class="sidebar-nas-details">
        {{ nasConnection.config.host }}/{{ nasConnection.config.share }}
        <span v-if="nasConnection.status === 'error'" class="nas-error">⚠️</span>
        <span v-else-if="nasConnection.status === 'connected'" class="nas-connected">✓</span>
      </span>
    </div>
    <span class="sidebar-nas-count">({{ nasConnection.resourceCount }})</span>
    <div class="sidebar-nas-actions" @click.stop>
      <span
        class="sidebar-nas-action"
        title="打开/挂载共享"
        @click="$emit('open')"
      >
        🔗
      </span>
      <span
        class="sidebar-nas-action"
        title="刷新扫描"
        @click="$emit('refresh')"
      >
        🔄
      </span>
      <span
        class="sidebar-nas-action"
        title="删除连接"
        @click="$emit('remove')"
      >
        ×
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NasConnection } from '../types/mount'

interface Props {
  nasConnection: NasConnection
  active?: boolean
}

withDefaults(defineProps<Props>(), {
  active: false
})

defineEmits<{
  select: []
  open: []
  refresh: []
  remove: []
}>()
</script>

<style scoped>
.sidebar-nas-item {
  padding: 10px 20px;
  color: #ccc;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
  border-left: 3px solid transparent;
  font-size: 0.85rem;
}

.sidebar-nas-item:hover {
  background: #2a2a32;
  color: #fff;
}

.sidebar-nas-item.active {
  background: #2d2d35;
  color: #fff;
  border-left-color: #4a9eff;
}

.sidebar-item-icon {
  width: 20px;
  text-align: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.sidebar-nas-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nas-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-nas-details {
  font-size: 0.75rem;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nas-error {
  color: #f44336;
  margin-left: 4px;
}

.nas-connected {
  color: #43a047;
  margin-left: 4px;
}

.sidebar-nas-count {
  font-size: 0.75rem;
  color: #888;
  margin-left: 4px;
  flex-shrink: 0;
}

.sidebar-nas-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.sidebar-nas-item:hover .sidebar-nas-actions {
  opacity: 1;
}

.sidebar-nas-action {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background 0.2s;
}

.sidebar-nas-action:hover {
  background: #3a3a42;
}
</style>
