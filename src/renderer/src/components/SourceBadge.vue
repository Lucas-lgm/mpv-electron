<template>
  <span :class="['source-badge', source]">
    {{ badgeText }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ResourceSource } from '../types/media'

interface Props {
  source: ResourceSource
}

const props = defineProps<Props>()

const badgeText = computed(() => {
  const map: Record<ResourceSource, string> = {
    local: '本地',
    network: '网络',
    nas: 'NAS',
    mounted: '挂载'
  }
  return map[props.source] || '未知'
})
</script>

<style scoped>
.source-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 500;
  margin-left: 8px;
}

.source-badge.local {
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
}

.source-badge.network {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.source-badge.nas {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.source-badge.mounted {
  background: rgba(139, 92, 246, 0.2);
  color: #8b5cf6;
}
</style>
