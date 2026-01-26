/**
 * 媒体库管理 Composable
 */
import { ref, computed } from 'vue'
import type { MediaResource, ResourceFilter, ViewMode } from '../types/media'

export function useMediaLibrary() {
  const resources = ref<MediaResource[]>([])
  const activeFilter = ref<ResourceFilter>('all')
  const selectedMountPath = ref<string | null>(null)
  const viewMode = ref<ViewMode>('grid')
  const searchQuery = ref('')

  /**
   * 筛选后的资源
   */
  const filteredResources = computed(() => {
    let filtered = resources.value

    // 根据activeFilter筛选
    if (activeFilter.value === 'local') {
      filtered = filtered.filter(r => r.source === 'local')
    } else if (activeFilter.value === 'network') {
      filtered = filtered.filter(r => r.source === 'network')
    } else if (activeFilter.value === 'nas') {
      filtered = filtered.filter(r => r.source === 'nas')
    } else if (activeFilter.value && activeFilter.value !== 'all') {
      // 挂载路径筛选
      if (selectedMountPath.value) {
        filtered = filtered.filter(r => r.mountPath === selectedMountPath.value)
      }
    }

    // 根据搜索关键词筛选
    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      filtered = filtered.filter(r => 
        r.name.toLowerCase().includes(query) ||
        r.path.toLowerCase().includes(query)
      )
    }

    return filtered
  })

  /**
   * 统计信息
   */
  const stats = computed(() => {
    const all = resources.value.length
    const local = resources.value.filter(r => r.source === 'local').length
    const network = resources.value.filter(r => r.source === 'network').length
    const nas = resources.value.filter(r => r.source === 'nas').length
    const mounted = resources.value.filter(r => r.source === 'mounted').length

    return { all, local, network, nas, mounted }
  })

  /**
   * 添加资源
   */
  const addResource = (resource: MediaResource) => {
    // 检查是否已存在
    if (!resources.value.find(r => r.id === resource.id)) {
      resources.value.push(resource)
    }
  }

  /**
   * 批量添加资源
   */
  const addResources = (newResources: MediaResource[]) => {
    newResources.forEach(resource => {
      if (!resources.value.find(r => r.id === resource.id)) {
        resources.value.push(resource)
      }
    })
  }

  /**
   * 移除资源
   */
  const removeResource = (id: string) => {
    const index = resources.value.findIndex(r => r.id === id)
    if (index !== -1) {
      resources.value.splice(index, 1)
    }
  }

  /**
   * 移除挂载路径的所有资源
   */
  const removeResourcesByMountPath = (mountPath: string) => {
    resources.value = resources.value.filter(r => r.mountPath !== mountPath)
  }

  /**
   * 设置筛选器
   */
  const setFilter = (filter: ResourceFilter) => {
    activeFilter.value = filter
    if (filter !== 'all' && !['local', 'network', 'nas'].includes(filter)) {
      // 如果是挂载路径ID，设置selectedMountPath
      selectedMountPath.value = filter
    } else {
      selectedMountPath.value = null
    }
  }

  /**
   * 设置搜索关键词
   */
  const setSearchQuery = (query: string) => {
    searchQuery.value = query
  }

  /**
   * 设置视图模式
   */
  const setViewMode = (mode: ViewMode) => {
    viewMode.value = mode
  }

  /**
   * 清空所有资源
   */
  const clearResources = () => {
    resources.value = []
  }

  return {
    // 状态
    resources,
    activeFilter,
    selectedMountPath,
    viewMode,
    searchQuery,
    // 计算属性
    filteredResources,
    stats,
    // 方法
    addResource,
    addResources,
    removeResource,
    removeResourcesByMountPath,
    setFilter,
    setSearchQuery,
    setViewMode,
    clearResources
  }
}
