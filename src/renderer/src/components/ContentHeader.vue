<template>
  <div class="content-header">
    <div class="content-title">{{ title }}</div>
    <div class="content-subtitle">{{ subtitle }}</div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  title: string
  subtitle?: string
}

withDefaults(defineProps<Props>(), {
  subtitle: ''
})
</script>

<style scoped>
.content-header {
  margin-bottom: 20px;
}

.content-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fff;
  margin-bottom: 8px;
}

.content-subtitle {
  font-size: 0.9rem;
  color: #888;
}
</style>
