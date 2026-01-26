<template>
  <div class="main-view">
    <header class="main-header">
      <div class="logo">
        <span>🎬</span>
        <span>MPV Player</span>
      </div>
      <div class="header-actions">
        <SearchBox
          v-model="searchQuery"
          placeholder="搜索视频、文件夹..."
          @search="handleSearch"
        />
        <button class="btn-icon" title="设置" @click="handleSettings">
          ⚙️
        </button>
      </div>
    </header>
    <div class="main-content-wrapper">
      <Sidebar
        :active-filter="activeFilter"
        :mount-paths="mountPathsList"
        :selected-mount-path="selectedMountPath"
        @filter-change="handleFilterChange"
        @mount-path-select="handleMountPathSelect"
        @mount-path-add="handleMountPathAdd"
        @mount-path-remove="handleMountPathRemove"
        @mount-path-refresh="handleMountPathRefresh"
      />
      <div class="content-area-wrapper">
        <Toolbar
          :view-mode="viewMode"
          @add-file="handleAddFile"
          @add-url="handleAddUrl"
          @mount-path="handleMountPathAdd"
          @update:view-mode="handleViewModeChange"
        />
        <ContentArea
          :title="contentTitle"
          :subtitle="contentSubtitle"
          :videos="filteredResources"
          :view-mode="viewMode"
          :loading="loading"
          @video-play="handlePlayVideo"
          @video-context-menu="handleContextMenu"
        />
      </div>
    </div>
    <!-- URL 输入对话框 -->
    <el-dialog
      v-model="urlDialogVisible"
      title="添加视频URL"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form>
        <el-form-item label="URL地址">
          <el-input
            v-model="urlInput"
            placeholder="请输入视频URL（http:// 或 https://）"
            @keyup.enter="handleUrlConfirm"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button class="url-dialog-cancel" @click="handleUrlCancel">取消</el-button>
          <el-button type="primary" class="url-dialog-confirm" @click="handleUrlConfirm">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import Sidebar from '../components/Sidebar.vue'
import Toolbar from '../components/Toolbar.vue'
import ContentArea from '../components/ContentArea.vue'
import SearchBox from '../components/SearchBox.vue'
import { useMediaLibrary } from '../composables/useMediaLibrary'
import { useMountPaths } from '../composables/useMountPaths'
import type { MediaResource } from '../types/media'

// 使用 composables
const mediaLibrary = useMediaLibrary()
const mountPaths = useMountPaths()

const {
  resources,
  activeFilter,
  selectedMountPath,
  viewMode,
  searchQuery,
  filteredResources,
  stats,
  addResource,
  addResources,
  removeResource,
  removeResourcesByMountPath,
  setFilter,
  setSearchQuery,
  setViewMode,
  setMountPathFilter
} = mediaLibrary

const { mountPaths: mountPathsList, addMountPath, removeMountPath, refreshMountPath, initMountPaths } = mountPaths

const loading = ref(false)

// URL 对话框相关
const urlDialogVisible = ref(false)
const urlInput = ref('')

// 内容标题和副标题
const contentTitle = computed(() => {
  if (activeFilter.value === 'all') return '全部资源'
  if (activeFilter.value === 'local') return '本地文件'
  if (activeFilter.value === 'network') return '网络资源'
  if (activeFilter.value === 'nas') return 'NAS 存储'
  if (selectedMountPath.value) {
    const mountPath = mountPathsList.value.find(mp => mp.id === selectedMountPath.value)
    return mountPath ? mountPath.path : '挂载路径'
  }
  return '全部资源'
})

const contentSubtitle = computed(() => {
  const { all, local, network, nas, mounted } = stats.value
  if (activeFilter.value === 'all') {
    return `共 ${all} 个资源${local > 0 || network > 0 || mounted > 0 ? `（${local > 0 ? `${local} 个本地文件` : ''}${local > 0 && network > 0 ? '，' : ''}${network > 0 ? `${network} 个网络资源` : ''}${(local > 0 || network > 0) && mounted > 0 ? '，' : ''}${mounted > 0 ? `${mounted} 个挂载路径` : ''}）` : ''}`
  }
  return `共 ${filteredResources.value.length} 个资源`
})

// 处理筛选器改变
const handleFilterChange = (filter: string) => {
  setFilter(filter)
}

// 处理挂载路径选择
const handleMountPathSelect = (id: string) => {
  // 找到对应的挂载路径
  const mountPath = mountPathsList.value.find(mp => mp.id === id)
  if (mountPath) {
    // 使用专门的挂载路径筛选方法
    setMountPathFilter(id, mountPath.path)
  } else {
    // 如果找不到，只设置筛选器
    setFilter(id)
  }
}

// 处理添加文件
const handleAddFile = () => {
  if (!window.electronAPI) return
  window.electronAPI.send('select-video-file')
}

// 处理添加URL
const handleAddUrl = () => {
  urlInput.value = ''
  urlDialogVisible.value = true
}

// 确认添加URL
const handleUrlConfirm = () => {
  const trimmedUrl = urlInput.value.trim()
  if (!trimmedUrl) {
    return
  }
  
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    ElMessage.error('请输入有效的URL（http:// 或 https://）')
    return
  }

  const resource: MediaResource = {
    id: `network-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: trimmedUrl,
    path: trimmedUrl,
    source: 'network',
    addedAt: new Date()
  }

  addResource(resource)
  syncPlaylist()
  urlDialogVisible.value = false
  urlInput.value = ''
}

// 取消添加URL
const handleUrlCancel = () => {
  urlDialogVisible.value = false
  urlInput.value = ''
}

// 处理挂载路径添加
const handleMountPathAdd = async () => {
  if (!window.electronAPI) return
  
  // 发送IPC消息，打开文件夹选择对话框
  window.electronAPI.send('select-mount-path')
}

// 处理挂载路径移除
const handleMountPathRemove = (id: string) => {
  const mountPath = mountPathsList.value.find(mp => mp.id === id)
  if (mountPath) {
    // 移除该挂载路径的所有资源
    removeResourcesByMountPath(mountPath.path)
    // 移除挂载路径
    removeMountPath(id)
  }
}

// 处理挂载路径刷新
const handleMountPathRefresh = async (id: string) => {
  await refreshMountPath(id)
  // 刷新后重新扫描资源
  if (window.electronAPI) {
    window.electronAPI.send('mount-path-refresh', { id })
  }
}

// 处理播放视频
const handlePlayVideo = (video: MediaResource) => {
  if (!window.electronAPI) return
  window.electronAPI.send('play-video', {
    name: video.name,
    path: video.path
  })
}

// 处理右键菜单
const handleContextMenu = (event: MouseEvent, video: MediaResource) => {
  // TODO: 实现右键菜单
  console.log('Context menu:', video)
}

// 处理搜索
const handleSearch = (query: string) => {
  setSearchQuery(query)
}

// 处理视图模式改变
const handleViewModeChange = (mode: 'grid' | 'list') => {
  setViewMode(mode)
}

// 处理设置
const handleSettings = () => {
  // TODO: 打开设置窗口
  console.log('Settings clicked')
}

// 同步播放列表
const syncPlaylist = () => {
  if (!window.electronAPI) return
  const items = resources.value.map((resource) => ({
    name: resource.name,
    path: resource.path
  }))
  window.electronAPI.send('set-playlist', items)
}

// 处理文件选择
const handleVideoFileSelected = (file: { name: string; path: string }) => {
  const resource: MediaResource = {
    id: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: file.name,
    path: file.path,
    source: 'local',
    addedAt: new Date()
  }
  addResource(resource)
  syncPlaylist()
}

// 处理挂载路径添加成功
const handleMountPathAdded = (data: { mountPath: any; resources: any[] }) => {
  // 将扫描到的资源添加到媒体库
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || '未知文件',
    path: r.path,
    source: 'mounted' as const,
    mountPath: data.mountPath.path,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
}

// 处理挂载路径扫描完成
const handleMountPathScanned = (data: { id: string; resources: any[] }) => {
  // 先移除该挂载路径的旧资源
  const mountPath = mountPathsList.value.find(mp => mp.id === data.id)
  if (mountPath) {
    removeResourcesByMountPath(mountPath.path)
  }
  
  // 添加新扫描到的资源
  const newResources: MediaResource[] = data.resources.map((r: any) => ({
    id: r.id || `mounted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: r.name || r.path.split(/[/\\]/).pop() || '未知文件',
    path: r.path,
    source: 'mounted' as const,
    mountPath: mountPath?.path,
    duration: r.duration,
    size: r.size,
    addedAt: new Date()
  }))
  addResources(newResources)
  syncPlaylist()
}

onMounted(() => {
  if (window.electronAPI) {
    // 初始化挂载路径
    initMountPaths()
    
    // 请求挂载路径列表
    window.electronAPI.send('get-mount-paths')
    
    // 监听文件选择
    window.electronAPI.on('video-file-selected', handleVideoFileSelected)
    
    // 监听挂载路径相关事件
    window.electronAPI.on('mount-path-added', handleMountPathAdded)
    window.electronAPI.on('mount-path-scanned', handleMountPathScanned)
    window.electronAPI.on('mount-paths-updated', (data: { mountPaths: any[] }) => {
      mountPathsList.value = data.mountPaths
    })
    
    // 获取现有播放列表
    window.electronAPI.send('get-playlist')
    
    // 监听播放列表更新
    window.electronAPI.on('playlist-updated', (items: any[]) => {
      // 将播放列表项转换为资源（如果还没有）
      items.forEach(item => {
        const existing = resources.value.find(r => r.path === item.path)
        if (!existing) {
          const source: MediaResource['source'] = item.path.startsWith('http://') || item.path.startsWith('https://')
            ? 'network'
            : 'local'
          const resource: MediaResource = {
            id: `${source}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: item.name,
            path: item.path,
            source,
            addedAt: new Date()
          }
          addResource(resource)
        }
      })
    })
  }
})

onUnmounted(() => {
  if (window.electronAPI) {
    window.electronAPI.removeListener('video-file-selected', handleVideoFileSelected)
    window.electronAPI.removeListener('mount-path-added', handleMountPathAdded)
    window.electronAPI.removeListener('mount-path-scanned', handleMountPathScanned)
    window.electronAPI.removeListener('mount-paths-updated', () => {})
  }
})
</script>

<style scoped>
.main-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1e1e24;
  color: #fff;
  overflow: hidden;
}

.main-header {
  background: #25252d;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #2d2d35;
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
  color: #ffffff;
  font-size: 1.1rem;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.btn-icon {
  background: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: all 0.2s;
  font-size: 1.1rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover {
  background: #2a2a32;
  color: #fff;
}

.main-content-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.content-area-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* URL 对话框样式 - 统一项目风格 */
:deep(.el-dialog) {
  background: #25252d;
  border: 1px solid #2d2d35;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

:deep(.el-dialog__header) {
  background: #25252d;
  border-bottom: 1px solid #2d2d35;
  padding: 16px 20px;
}

:deep(.el-dialog__title) {
  color: #ffffff;
  font-weight: 600;
  font-size: 1rem;
}

:deep(.el-dialog__headerbtn) {
  top: 16px;
  right: 20px;
}

:deep(.el-dialog__close) {
  color: #ccc;
  font-size: 18px;
}

:deep(.el-dialog__close:hover) {
  color: #ffffff;
}

:deep(.el-dialog__body) {
  background: #25252d;
  padding: 20px;
  color: #ffffff;
}

:deep(.el-form-item__label) {
  color: #cccccc;
  font-size: 0.9rem;
}

:deep(.el-input__wrapper) {
  background: #1e1e24;
  border: 1px solid #2d2d35;
  border-radius: 6px;
  box-shadow: none;
}

:deep(.el-input__wrapper:hover) {
  border-color: #4a9eff;
}

:deep(.el-input__wrapper.is-focus) {
  border-color: #4a9eff;
  box-shadow: 0 0 0 1px #4a9eff inset;
}

:deep(.el-input__inner) {
  color: #ffffff;
  background: transparent;
}

:deep(.el-input__inner::placeholder) {
  color: #888888;
}

:deep(.el-dialog__footer) {
  background: #25252d;
  border-top: 1px solid #2d2d35;
  padding: 12px 20px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

:deep(.el-button) {
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 500;
  transition: all 0.2s;
}

/* 取消按钮样式 - 使用更高优先级 */
:deep(.url-dialog-cancel),
:deep(.el-button--default),
:deep(.el-button:not(.el-button--primary)) {
  background: #2a2a32 !important;
  border-color: #2d2d35 !important;
  color: #cccccc !important;
}

:deep(.url-dialog-cancel:hover),
:deep(.el-button--default:hover),
:deep(.el-button:not(.el-button--primary):hover) {
  background: #2d2d35 !important;
  border-color: #3a3a42 !important;
  color: #ffffff !important;
}

:deep(.el-button--primary) {
  background: #4a9eff;
  border-color: #4a9eff;
  color: #ffffff;
}

:deep(.el-button--primary:hover) {
  background: #5aaaff;
  border-color: #5aaaff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
}

:deep(.el-button--primary:active) {
  transform: translateY(0);
}
</style>
