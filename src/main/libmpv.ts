import { EventEmitter } from 'events'
import * as path from 'path'

// 定义 native binding 的类型
interface MPVBinding {
  create(): number
  initialize(instanceId: number): boolean
  setOption(instanceId: number, name: string, value: string | number | boolean): boolean
  setWindowId(instanceId: number, windowId: number): boolean
  loadFile(instanceId: number, path: string): boolean
  getProperty(instanceId: number, name: string): any
  setProperty(instanceId: number, name: string, value: string | number | boolean): boolean
  command(instanceId: number, args: string[]): boolean
  // 事件现在会传递一个对象，包含 eventId / name / value 等
  setEventCallback(instanceId: number, callback: (event: any) => void): boolean
  destroy(instanceId: number): boolean
}

// 尝试加载 native binding
let mpvBinding: MPVBinding | null = null
try {
  // 尝试多个可能的路径（相对于编译后的 out/main 目录）
  // 在开发和生产环境中的不同路径
  const possiblePaths = [
    // 开发环境：从 out/main 到 native/build/Release
    path.join(__dirname, '../../native/build/Release/mpv_binding.node'),
    // 如果 native 在项目根目录
    path.join(__dirname, '../../../native/build/Release/mpv_binding.node'),
    // 生产环境可能的位置
    path.join(process.resourcesPath || __dirname, 'native/build/Release/mpv_binding.node'),
  ]
  
  for (const bindingPath of possiblePaths) {
    try {
      // @ts-ignore - native module
      mpvBinding = require(bindingPath)
      console.log('[libmpv] ✅ Native binding loaded from:', bindingPath)
      break
    } catch (e: any) {
      // 继续尝试下一个路径
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.warn('[libmpv] Error loading from', bindingPath, ':', e.message)
      }
    }
  }
  
  if (!mpvBinding) {
    console.warn('[libmpv] ⚠️ Native binding not found. Will use IPC mode.')
    console.warn('[libmpv] Tried paths:', possiblePaths)
  }
} catch (error: any) {
  console.warn('[libmpv] Native binding not available, falling back to IPC mode:', error.message)
}

export interface MPVStatus {
  paused: boolean
  position: number
  duration: number
  volume: number
  path: string | null
}

export class LibMPVController extends EventEmitter {
  private instanceId: number | null = null
  private currentStatus: MPVStatus = {
    paused: false,
    position: 0,
    duration: 0,
    volume: 100,
    path: null
  }

  constructor() {
    super()
    
    if (!mpvBinding) {
      throw new Error('libmpv native binding is not available. Please build the native module first.')
    }
  }

  /**
   * 初始化 MPV 实例
   */
  async initialize(): Promise<void> {
    if (this.instanceId !== null) {
      throw new Error('MPV instance already initialized')
    }

    try {
      // 创建实例（未初始化）
      this.instanceId = mpvBinding!.create()
      
      // 在初始化前设置选项（如果需要）
      // 注意：libmpv 默认已经设置了 no-terminal，不需要再设置
      // 某些选项可能不存在，忽略错误
      try {
        await this.setOption('no-osc', true)
      } catch (error) {
        // 忽略，可能不存在
      }
      
      try {
        await this.setOption('no-osd-bar', true)
      } catch (error) {
        // 忽略，可能不存在
      }
      
      try {
        await this.setOption('keep-open', 'yes')
      } catch (error) {
        // 忽略，可能不存在
      }
      
      // 现在初始化
      mpvBinding!.initialize(this.instanceId)
      
      // 设置事件回调
      mpvBinding!.setEventCallback(this.instanceId, (event: any) => {
        console.log('[libmpv] Event:', event)
        this.handleEvent(event)
      })
      
      this.emit('initialized')
    } catch (error) {
      throw new Error(`Failed to initialize MPV: ${error}`)
    }
  }

  /**
   * 设置窗口 ID（用于嵌入到 Electron 窗口）
   */
  async setWindowId(windowId: number): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.setWindowId(this.instanceId, windowId)
      this.emit('window-set', windowId)
    } catch (error) {
      throw new Error(`Failed to set window ID: ${error}`)
    }
  }

  /**
   * 设置选项
   */
  async setOption(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.setOption(this.instanceId, name, value)
    } catch (error) {
      throw new Error(`Failed to set option ${name}: ${error}`)
    }
  }

  /**
   * 加载文件
   */
  async loadFile(path: string): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.loadFile(this.instanceId, path)
      this.currentStatus.path = path
      this.emit('file-loaded', path)
    } catch (error) {
      throw new Error(`Failed to load file: ${error}`)
    }
  }

  /**
   * 获取属性
   */
  async getProperty(name: string): Promise<any> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      return mpvBinding!.getProperty(this.instanceId, name)
    } catch (error) {
      console.warn(`Failed to get property ${name}:`, error)
      return null
    }
  }

  /**
   * 设置属性
   */
  async setProperty(name: string, value: string | number | boolean): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.setProperty(this.instanceId, name, value)
    } catch (error) {
      throw new Error(`Failed to set property ${name}: ${error}`)
    }
  }

  /**
   * 执行命令
   */
  async command(...args: string[]): Promise<void> {
    if (this.instanceId === null) {
      throw new Error('MPV instance not initialized')
    }

    try {
      mpvBinding!.command(this.instanceId, args)
    } catch (error) {
      throw new Error(`Command failed: ${error}`)
    }
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    await this.setProperty('pause', true)
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    await this.setProperty('pause', false)
  }

  /**
   * 切换暂停/播放
   */
  async togglePause(): Promise<void> {
    await this.command('cycle', 'pause')
  }

  /**
   * 跳转到指定时间
   */
  async seek(time: number): Promise<void> {
    await this.setProperty('time-pos', time)
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    await this.setProperty('volume', Math.max(0, Math.min(100, volume)))
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    await this.command('stop')
  }

  /**
   * 获取当前状态
   */
  getStatus(): MPVStatus {
    return { ...this.currentStatus }
  }

  /**
   * 处理事件（来自 C++ 的 ThreadSafeFunction）
   */
  private handleEvent(event: any): void {
    // MPV 事件 ID 定义（从 client.h）
    const MPV_EVENT_PROPERTY_CHANGE = 22
    const MPV_EVENT_END_FILE = 7
    const MPV_EVENT_SHUTDOWN = 1

    const eventId: number = event?.eventId

    switch (eventId) {
      case MPV_EVENT_PROPERTY_CHANGE: {
        const name: string | undefined = event?.name
        const value = event?.value

        if (!name) {
          return
        }

        // 根据属性名更新 currentStatus
        switch (name) {
          case 'pause':
            this.currentStatus.paused = !!value
            break
          case 'time-pos':
            this.currentStatus.position = typeof value === 'number' ? value : 0
            break
          case 'duration':
            this.currentStatus.duration = typeof value === 'number' ? value : 0
            break
          case 'volume':
            this.currentStatus.volume = typeof value === 'number' ? value : 100
            break
        }

        this.emit('status', { ...this.currentStatus })
        break
      }
      case MPV_EVENT_END_FILE:
        this.emit('ended')
        break
      case MPV_EVENT_SHUTDOWN:
        this.emit('shutdown')
        break
    }
  }

  /**
   * 清理资源
   */
  async destroy(): Promise<void> {
    if (this.instanceId !== null) {
      try {
        mpvBinding!.destroy(this.instanceId)
      } catch (error) {
        console.error('Error destroying MPV instance:', error)
      }
      this.instanceId = null
    }

    this.emit('destroyed')
  }
}

/**
 * 检查 native binding 是否可用
 */
export function isLibMPVAvailable(): boolean {
  return mpvBinding !== null
}
