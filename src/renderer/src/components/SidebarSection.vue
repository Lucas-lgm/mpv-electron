<template>
  <div class="sidebar-section">
    <div class="sidebar-title">
      <span>{{ title }}</span>
      <span
        v-if="showAddButton"
        class="sidebar-title-action"
        @click.stop="$emit('add')"
        :title="addButtonTitle"
      >
        +
      </span>
    </div>
    <div class="sidebar-section-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  title: string
  showAddButton?: boolean
  addButtonTitle?: string
}

withDefaults(defineProps<Props>(), {
  showAddButton: false,
  addButtonTitle: '添加'
})

defineEmits<{
  add: []
}>()
</script>

<style scoped>
.sidebar-section {
  margin-bottom: 24px;
}

.sidebar-title {
  padding: 0 20px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-title-action {
  cursor: pointer;
  color: #4a9eff;
  font-size: 0.7rem;
  transition: color 0.2s;
  padding: 2px 4px;
  border-radius: 3px;
}

.sidebar-title-action:hover {
  color: #5aaaff;
  background: rgba(74, 158, 255, 0.1);
}

.sidebar-section-content {
  display: flex;
  flex-direction: column;
}
</style>
