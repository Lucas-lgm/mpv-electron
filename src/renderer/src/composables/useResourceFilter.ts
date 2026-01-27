/**
 * 资源筛选 Composable
 */
import { computed, type Ref } from 'vue'
import type { MediaResource, ResourceFilter } from '../types/media'

export function useResourceFilter(
  resources: Ref<MediaResource[]>,
  activeFilter: Ref<ResourceFilter>,
  selectedMountPath: Ref<string | null>,
  searchQuery: Ref<string>
) {
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

  return {
    filteredResources,
    stats
  }
}
