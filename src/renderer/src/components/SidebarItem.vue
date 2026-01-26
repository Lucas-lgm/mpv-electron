<template>
  <div
    :class="['sidebar-item', { active }]"
    @click="$emit('click')"
  >
    <span class="sidebar-item-icon">
      <slot name="icon">{{ icon }}</slot>
    </span>
    <span class="sidebar-item-text">
      <slot>{{ label }}</slot>
    </span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  active?: boolean
  icon?: string
  label?: string
}

withDefaults(defineProps<Props>(), {
  active: false,
  icon: '',
  label: ''
})

defineEmits<{
  click: []
}>()
</script>

<style scoped>
.sidebar-item {
  padding: 10px 20px;
  color: #ccc;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.9rem;
  border-left: 3px solid transparent;
}

.sidebar-item:hover {
  background: #2a2a32;
  color: #fff;
}

.sidebar-item.active {
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

.sidebar-item-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
