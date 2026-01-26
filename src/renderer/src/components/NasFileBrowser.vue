<template>
  <div class="nas-file-browser">
    <!-- 面包屑导航 -->
    <div class="file-browser-breadcrumb">
      <button
        v-if="currentPath"
        class="breadcrumb-btn"
        @click="handleGoUp"
        title="返回上级目录"
      >
        ⬆️ 返回
      </button>
      <button
        class="breadcrumb-btn breadcrumb-btn-root"
        @click="handleGoToRoot"
        title="返回根目录"
      >
        🏠 根目录
      </button>
      <div class="breadcrumb-path">
        <span class="breadcrumb-part">
          <button
            class="breadcrumb-link"
            @click="handleGoToRoot"
            :class="{ 'breadcrumb-current': !currentPath }"
          >
            {{ nasConnection.name }}
          </button>
        </span>
        <span
          v-for="(part, index) in pathParts"
          :key="index"
          class="breadcrumb-part"
        >
          <span class="breadcrumb-separator">/</span>
          <button
            v-if="index < pathParts.length - 1"
            class="breadcrumb-link"
            @click="handleNavigateToPath(getPathUpTo(index))"
          >
            {{ part }}
          </button>
          <span v-else class="breadcrumb-current">{{ part }}</span>
        </span>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="file-browser-loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">加载中...</div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="file-browser-error">
      <div class="error-icon">⚠️</div>
      <div class="error-title">无法访问目录</div>
      <div class="error-message">{{ error }}</div>
      <div v-if="error.includes('不存在该共享') || error.includes('不存在')" class="error-tips">
        <div class="error-tip-title">💡 提示：</div>
        <ul class="error-tip-list">
          <li>请检查 NAS 配置中的<strong>共享名称</strong>是否正确</li>
          <li>确认该共享在 NAS 服务器上确实存在</li>
          <li>检查共享名称的大小写是否匹配</li>
          <li>如果共享名称不确定，可以在 Finder 中手动连接查看可用共享</li>
        </ul>
      </div>
      <div class="error-actions">
        <button
          v-if="error.includes('未挂载') || error.includes('不存在该共享')"
          class="error-action-btn error-action-btn-primary"
          @click="handleMountShare"
        >
          🔗 打开/挂载共享
        </button>
        <button class="error-action-btn" @click="handleRefresh">🔄 重试</button>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!items || items.length === 0" class="file-browser-empty">
      <div class="empty-icon">📁</div>
      <div class="empty-title">目录为空</div>
    </div>

    <!-- 文件列表 -->
    <div v-else class="file-browser-list">
      <div
        v-for="item in items"
        :key="item.path"
        :class="['file-item', { 'is-directory': item.type === 'directory', 'is-video': item.isVideo }]"
        @click="handleItemClick(item)"
        @dblclick="handleItemDoubleClick(item)"
      >
        <div class="file-item-icon">
          <span v-if="item.type === 'directory'">📁</span>
          <span v-else-if="item.isVideo">🎬</span>
          <span v-else>📄</span>
        </div>
        <div class="file-item-info">
          <div class="file-item-name" :title="item.name">{{ item.name }}</div>
          <div v-if="item.type === 'file'" class="file-item-meta">
            <span v-if="item.size" class="file-item-size">{{ formatSize(item.size) }}</span>
            <span v-if="item.extension" class="file-item-extension">{{ item.extension.toUpperCase() }}</span>
          </div>
        </div>
        <div v-if="item.type === 'directory'" class="file-item-action">
          <span class="file-item-arrow">→</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { NasConnection } from '../types/mount'

interface FileItem {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: Date
  isVideo?: boolean
  extension?: string
}

interface Props {
  nasConnection: NasConnection
}

interface Emits {
  (e: 'file-play', file: FileItem): void
  (e: 'path-change', path: string): void
  (e: 'mount-share'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const currentPath = ref<string>('')
const items = ref<FileItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// 路径部分（用于面包屑）
const pathParts = computed(() => {
  if (!currentPath.value || currentPath.value === '/') return []
  return currentPath.value.split('/').filter(p => p)
})

// 加载目录
const loadDirectory = async (path?: string) => {
  if (!window.electronAPI) {
    error.value = '无法连接到主进程'
    return
  }

  loading.value = true
  error.value = null

  try {
    const result = await new Promise<{ items: FileItem[]; error?: string }>((resolve, reject) => {
      const handler = (data: { items: FileItem[]; error?: string }) => {
        window.electronAPI.removeListener('nas-directory-read-result', handler)
        resolve(data)
      }
      window.electronAPI.on('nas-directory-read-result', handler)
      window.electronAPI.send('nas-read-directory', {
        connectionId: props.nasConnection.id,
        path
      })
      
      // 超时处理
      setTimeout(() => {
        window.electronAPI.removeListener('nas-directory-read-result', handler)
        reject(new Error('读取目录超时'))
      }, 10000)
    })

    if (result.error) {
      error.value = result.error
      items.value = []
    } else {
      items.value = result.items
      currentPath.value = path === '/' ? '/' : (path || '/')
      emit('path-change', currentPath.value)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取目录失败'
    items.value = []
  } finally {
    loading.value = false
  }
}

// 获取路径到指定索引
const getPathUpTo = (index: number): string => {
  const parts = pathParts.value
  if (parts.length === 0) return '/'
  return parts.slice(0, index + 1).join('/')
}

// 处理项目点击
const handleItemClick = (item: FileItem) => {
  if (item.type === 'directory') {
    const basePath = currentPath.value === '/' ? '' : (currentPath.value || '')
    const newPath = basePath ? `${basePath}/${item.name}` : item.name
    loadDirectory(newPath)
  } else if (item.isVideo) {
    emit('file-play', item)
  }
}

// 处理项目双击
const handleItemDoubleClick = (item: FileItem) => {
  if (item.type === 'directory') {
    const basePath = currentPath.value === '/' ? '' : (currentPath.value || '')
    const newPath = basePath ? `${basePath}/${item.name}` : item.name
    loadDirectory(newPath)
  } else if (item.isVideo) {
    emit('file-play', item)
  }
}

// 处理返回上级
const handleGoUp = () => {
  if (currentPath.value) {
    const parts = currentPath.value.split('/').filter(p => p)
    parts.pop()
    const newPath = parts.length > 0 ? parts.join('/') : '/'
    loadDirectory(newPath)
  }
}

// 处理返回根目录
const handleGoToRoot = () => {
  loadDirectory('/')
}

// 处理导航到路径（面包屑）
const handleNavigateToPath = (path: string) => {
  loadDirectory(path)
}

// 刷新当前目录
const handleRefresh = () => {
  loadDirectory(currentPath.value === '/' ? '/' : (currentPath.value || '/'))
}

// 处理挂载共享
const handleMountShare = () => {
  emit('mount-share')
}

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

// 初始化时加载根目录（挂载点根目录）
loadDirectory('/')
</script>

<style scoped>
.nas-file-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e24;
}

.file-browser-breadcrumb {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #25252d;
  border-bottom: 1px solid #2d2d35;
  flex-shrink: 0;
}

.breadcrumb-btn {
  padding: 6px 12px;
  background: #2a2a32;
  border: 1px solid #2d2d35;
  border-radius: 4px;
  color: #ccc;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
  white-space: nowrap;
}

.breadcrumb-btn:hover {
  background: #2d2d35;
  color: #fff;
}

.breadcrumb-btn-root {
  background: #4a9eff;
  border-color: #4a9eff;
  color: #fff;
}

.breadcrumb-btn-root:hover {
  background: #5aaaff;
  border-color: #5aaaff;
}

.breadcrumb-path {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  font-size: 0.9rem;
}

.breadcrumb-part {
  display: flex;
  align-items: center;
  white-space: nowrap;
}

.breadcrumb-separator {
  color: #666;
  margin: 0 4px;
}

.breadcrumb-link {
  background: none;
  border: none;
  color: #4a9eff;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 2px;
  transition: all 0.2s;
}

.breadcrumb-link:hover {
  background: #2a2a32;
  color: #5aaaff;
}

.breadcrumb-current {
  color: #fff;
  font-weight: 500;
}

.file-browser-loading,
.file-browser-error,
.file-browser-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: #888;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #2d2d35;
  border-top-color: #4a9eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 0.9rem;
  color: #888;
}

.error-icon,
.empty-icon {
  font-size: 3rem;
  margin-bottom: 16px;
}

.error-title,
.empty-title {
  font-size: 1.1rem;
  font-weight: 500;
  color: #fff;
  margin-bottom: 8px;
}

.error-message {
  font-size: 0.9rem;
  color: #888;
  margin-bottom: 16px;
  text-align: center;
  max-width: 600px;
  line-height: 1.5;
}

.error-tips {
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 6px;
  padding: 16px;
  margin: 16px 0;
  max-width: 500px;
  text-align: left;
}

.error-tip-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: #4a9eff;
  margin-bottom: 8px;
}

.error-tip-list {
  margin: 0;
  padding-left: 20px;
  font-size: 0.85rem;
  color: #ccc;
  line-height: 1.6;
}

.error-tip-list li {
  margin-bottom: 4px;
}

.error-tip-list strong {
  color: #fff;
  font-weight: 500;
}

.error-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 16px;
}

.error-action-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.error-action-btn-primary {
  background: #4a9eff;
  border: 1px solid #4a9eff;
}

.error-action-btn-primary:hover {
  background: #5aaaff;
  border-color: #5aaaff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
}

.error-action-btn:not(.error-action-btn-primary) {
  background: #2a2a32;
  border: 1px solid #2d2d35;
  color: #ccc;
}

.error-action-btn:not(.error-action-btn-primary):hover {
  background: #2d2d35;
  border-color: #3a3a42;
  color: #fff;
}

.file-browser-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #25252d;
  border: 1px solid #2d2d35;
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.file-item:hover {
  background: #2a2a32;
  border-color: #3a3a42;
  transform: translateX(2px);
}

.file-item.is-directory {
  border-left: 3px solid #4a9eff;
}

.file-item.is-video {
  border-left: 3px solid #43a047;
}

.file-item-icon {
  font-size: 1.5rem;
  width: 32px;
  text-align: center;
  flex-shrink: 0;
}

.file-item-info {
  flex: 1;
  min-width: 0;
}

.file-item-name {
  font-size: 0.95rem;
  color: #fff;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.file-item-meta {
  display: flex;
  gap: 8px;
  font-size: 0.75rem;
  color: #888;
}

.file-item-size {
  color: #666;
}

.file-item-extension {
  color: #4a9eff;
  font-weight: 500;
}

.file-item-action {
  flex-shrink: 0;
  color: #666;
  font-size: 1.2rem;
}

.file-item.is-directory:hover .file-item-action {
  color: #4a9eff;
}
</style>
