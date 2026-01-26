/**
 * NAS 连接管理 Composable
 */
import { ref } from 'vue'
import type { NasConnection, NasConfig } from '../types/mount'

export function useNas() {
  const nasConnections = ref<NasConnection[]>([])
  const loading = ref(false)

  /**
   * 测试 NAS 连接
   */
  const testConnection = async (config: NasConfig): Promise<{ success: boolean; error?: string }> => {
    if (!window.electronAPI) {
      return { success: false, error: '无法连接到主进程' }
    }

    return new Promise((resolve) => {
      const handler = (data: { success: boolean; error?: string }) => {
        window.electronAPI.removeListener('nas-test-connection-result', handler)
        resolve(data)
      }
      window.electronAPI.on('nas-test-connection-result', handler)
      window.electronAPI.send('nas-test-connection', { config })
      
      // 超时处理
      setTimeout(() => {
        window.electronAPI.removeListener('nas-test-connection-result', handler)
        resolve({ success: false, error: '连接测试超时' })
      }, 10000)
    })
  }

  /**
   * 添加 NAS 连接
   */
  const addNasConnection = async (name: string, config: NasConfig): Promise<NasConnection | null> => {
    if (!window.electronAPI) return null

    loading.value = true
    try {
      return new Promise((resolve) => {
        const handler = (data: { connection: NasConnection }) => {
          // 检查是否已存在
          if (!nasConnections.value.find(nc => nc.id === data.connection.id)) {
            nasConnections.value.push(data.connection)
          }
          window.electronAPI.removeListener('nas-connection-added', handler)
          loading.value = false
          resolve(data.connection)
        }
        window.electronAPI.on('nas-connection-added', handler)
        window.electronAPI.send('nas-add', { name, config })
        
        // 超时处理
        setTimeout(() => {
          window.electronAPI.removeListener('nas-connection-added', handler)
          loading.value = false
          resolve(null)
        }, 30000) // 30秒超时
      })
    } catch (error) {
      console.error('添加 NAS 连接失败:', error)
      loading.value = false
      return null
    }
  }

  /**
   * 移除 NAS 连接
   */
  const removeNasConnection = (id: string) => {
    if (!window.electronAPI) return

    const index = nasConnections.value.findIndex(nc => nc.id === id)
    if (index !== -1) {
      nasConnections.value.splice(index, 1)
      window.electronAPI.send('nas-remove', { id })
    }
  }

  /**
   * 刷新扫描 NAS 连接
   */
  const refreshNasConnection = async (id: string): Promise<void> => {
    if (!window.electronAPI) return

    const nasConnection = nasConnections.value.find(nc => nc.id === id)
    if (!nasConnection) return

    loading.value = true
    try {
      return new Promise((resolve) => {
        const handler = (data: { id: string; resources: any[]; status?: string; error?: string }) => {
          if (data.id === id) {
            const index = nasConnections.value.findIndex(nc => nc.id === id)
            if (index !== -1) {
              nasConnections.value[index].resourceCount = data.resources.length
              nasConnections.value[index].lastScanned = new Date()
              if (data.status) {
                nasConnections.value[index].status = data.status as any
              }
              if (data.error !== undefined) {
                nasConnections.value[index].error = data.error
              }
            }
            window.electronAPI.removeListener('nas-connection-scanned', handler)
            loading.value = false
            resolve()
          }
        }
        window.electronAPI.on('nas-connection-scanned', handler)
        window.electronAPI.send('nas-refresh', { id })
      })
    } catch (error) {
      console.error('刷新扫描失败:', error)
      loading.value = false
    }
  }

  /**
   * 获取 NAS 连接
   */
  const getNasConnection = (id: string): NasConnection | undefined => {
    return nasConnections.value.find(nc => nc.id === id)
  }

  /**
   * 初始化 NAS 连接列表（从主进程获取）
   */
  const initNasConnections = () => {
    if (!window.electronAPI) return

    // 请求 NAS 连接列表
    window.electronAPI.send('get-nas-connections')
    
    // 监听 NAS 连接列表更新
    const handler = (data: { connections: NasConnection[] }) => {
      nasConnections.value = data.connections
    }
    window.electronAPI.on('nas-connections-updated', handler)
  }

  return {
    // 状态
    nasConnections,
    loading,
    // 方法
    testConnection,
    addNasConnection,
    removeNasConnection,
    refreshNasConnection,
    getNasConnection,
    initNasConnections
  }
}
