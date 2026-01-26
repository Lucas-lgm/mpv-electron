<template>
  <div class="view-toggle">
    <button
      v-for="mode in modes"
      :key="mode.value"
      :class="['view-toggle-btn', { active: modelValue === mode.value }]"
      @click="handleClick(mode.value)"
    >
      {{ mode.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ViewMode } from '../types/media'

interface Props {
  modelValue: ViewMode
}

interface Emits {
  (e: 'update:modelValue', value: ViewMode): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const modes = [
  { value: 'grid' as ViewMode, label: '网格' },
  { value: 'list' as ViewMode, label: '列表' }
]

const handleClick = (mode: ViewMode) => {
  emit('update:modelValue', mode)
}
</script>

<style scoped>
.view-toggle {
  display: flex;
  background: #2a2a32;
  border-radius: 6px;
  padding: 4px;
  gap: 4px;
}

.view-toggle-btn {
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.85rem;
  transition: all 0.2s;
  font-family: inherit;
}

.view-toggle-btn.active {
  background: #4a9eff;
  color: #ffffff;
}

.view-toggle-btn:hover:not(.active) {
  color: #fff;
  background: #2d2d35;
}
</style>
