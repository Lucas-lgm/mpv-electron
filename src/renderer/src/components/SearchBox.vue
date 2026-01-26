<template>
  <input
    v-model="searchValue"
    type="text"
    :placeholder="placeholder"
    class="search-box"
    @input="handleInput"
    @focus="handleFocus"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  placeholder?: string
  modelValue?: string
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'search', value: string): void
  (e: 'focus'): void
  (e: 'blur'): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '搜索视频、文件夹...',
  modelValue: ''
})

const emit = defineEmits<Emits>()

const searchValue = ref(props.modelValue)

watch(() => props.modelValue, (newVal) => {
  searchValue.value = newVal
})

const handleInput = () => {
  emit('update:modelValue', searchValue.value)
  emit('search', searchValue.value)
}

const handleFocus = () => {
  emit('focus')
}

const handleBlur = () => {
  emit('blur')
}
</script>

<style scoped>
.search-box {
  background: #2a2a32;
  border: 1px solid #2d2d35;
  border-radius: 6px;
  padding: 8px 16px;
  color: #fff;
  width: 280px;
  font-size: 0.9rem;
  transition: all 0.2s;
  font-family: inherit;
}

.search-box:focus {
  outline: none;
  border-color: #4a9eff;
  background: #2d2d35;
}

.search-box::placeholder {
  color: #888;
}
</style>
