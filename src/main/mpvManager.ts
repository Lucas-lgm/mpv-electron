import { MPVController } from './mpvController'
import { LibMPVController, isLibMPVAvailable } from './libmpv'
import { BrowserWindow } from 'electron'
import { getNSViewPointer } from './nativeHelper'
import { windowSync } from './windowSync'

// 统一的控制器接口
interface IMPVController {
  pause(): Promise<void>
  play(): Promise<void>
  togglePause(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  stop(): Promise<void>
  getStatus(): any
  on(event: string, listener: (...args: any[]) => void): this
  quit?(): Promise<void>
  destroy?(): Promise<void>
}

class MPVManager {
  private controller: IMPVController | null = null
  private videoWindow: BrowserWindow | null = null
  private useLibMPV: boolean = false
  private embedMode: boolean = false // 暂时禁用嵌入模式，先确保 video 窗口显示

  /**
   * 设置视频窗口
   */
  setVideoWindow(window: BrowserWindow | null) {
    this.videoWindow = window
  }

  /**
   * 设置是否使用嵌入模式
   */
  setEmbedMode(enabled: boolean) {
    this.embedMode = enabled
  }

  /**
   * 获取或创建 MPV 控制器
   */
  getController(): IMPVController | null {
    return this.controller
  }
  
  /**
   * 检查是否使用 libmpv
   */
  isUsingLibMPV(): boolean {
    return this.useLibMPV
  }

  /**
   * 启动 MPV 并播放视频
   */
  async playVideo(filePath: string): Promise<void> {
    // 如果已有控制器，先关闭
    if (this.controller) {
      if (this.controller.quit) {
        await this.controller.quit()
      } else if (this.controller.destroy) {
        await this.controller.destroy()
      }
      this.controller = null
    }

    let windowId: number | undefined

    // 只要有 video 窗口，就尝试获取窗口句柄传给 MPV
    console.log('[MPVManager] Checking for video window...')
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      console.log('[MPVManager] Video window exists, will get window handle for MPV')
      try {
        // 确保窗口显示在前台
        if (!this.videoWindow.isVisible()) {
          this.videoWindow.show()
        }
        this.videoWindow.focus()
        
        // 等待窗口完全准备好
        console.log('[MPVManager] Waiting for video window to be ready...')
        await new Promise(resolve => setTimeout(resolve, 300))
        
        // 检查窗口状态
        if (this.videoWindow.isDestroyed()) {
          console.warn('[MPVManager] Video window was destroyed, using standalone window')
        } else {
          console.log('[MPVManager] Video window is ready, getting window handle for MPV...')
          const windowHandle = getNSViewPointer(this.videoWindow)
          
          if (windowHandle) {
            windowId = windowHandle
            console.log('[MPVManager] ✅ Got window handle:', windowId)
          } else {
            console.error('[MPVManager] ❌ Failed to get window handle!')
          }
        }
      } catch (error) {
        console.error('[MPVManager] Error getting window handle:', error)
      }
    }

    // 优先使用 libmpv（如果可用且需要窗口嵌入）
    if (isLibMPVAvailable() && windowId) {
      console.log('[MPVManager] Using libmpv native binding for true window embedding')
      this.useLibMPV = true
      
      try {
        this.controller = new LibMPVController()
        await (this.controller as LibMPVController).initialize()
        
        // 设置窗口 ID（真正嵌入）
        await (this.controller as LibMPVController).setWindowId(windowId)
        console.log('[MPVManager] ✅ Window embedded via libmpv')
        
        // 加载并播放文件
        await (this.controller as LibMPVController).loadFile(filePath)
        
        // 设置事件监听
        this.setupEventHandlers()
        
        return
      } catch (error) {
        console.error('[MPVManager] Failed to use libmpv, falling back to IPC mode:', error)
        this.useLibMPV = false
        // 继续使用 IPC 模式
      }
    }

    // 使用 IPC 模式（命令行启动 mpv）
    console.log('[MPVManager] Using IPC mode (spawn mpv process)')
    this.useLibMPV = false
    this.controller = new MPVController()

    // 启动 mpv（如果 windowId 存在，则尝试嵌入；否则独立窗口）
    if (windowId) {
      console.log('[MPVManager] Starting MPV with window handle:', windowId)
      console.log('[MPVManager] Note: IPC mode may not support true embedding on macOS')
    } else {
      console.warn('[MPVManager] Starting MPV without window handle - will create standalone window')
    }
    
    await (this.controller as MPVController).start(filePath, windowId)
    
    // 如果 MPV 创建了独立窗口，启动窗口同步
    if ((this.controller as MPVController).getProcess && (this.controller as MPVController).getProcess() && this.videoWindow) {
      console.log('[MPVManager] Setting up window synchronization...')
      windowSync.setVideoWindow(this.videoWindow)
      windowSync.setMPVProcess((this.controller as MPVController).getProcess()!)
      setTimeout(() => {
        windowSync.start()
        console.log('[MPVManager] Window synchronization started')
      }, 1000)
    }
    
    // 设置事件监听
    this.setupEventHandlers()
  }
  
  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.controller) return
    
    const videoWindow = this.videoWindow
    if (!videoWindow) return
    
    // 监听状态更新
    this.controller.on('status', (status: any) => {
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('video-time-update', {
          currentTime: status.position,
          duration: status.duration
        })
      }
    })
    
    // 监听错误
    this.controller.on('error', (error: any) => {
      console.error('MPV controller error:', error)
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('mpv-error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    })
    
    // 监听播放结束
    this.controller.on('ended', () => {
      console.log('MPV playback ended')
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('video-ended')
      }
    })
    
    // 监听停止
    this.controller.on('stopped', () => {
      console.log('MPV stopped')
    })
  }

  /**
   * 暂停/播放
   */
  async togglePause(): Promise<void> {
    if (this.controller) {
      await this.controller.togglePause()
    }
  }

  /**
   * 暂停
   */
  async pause(): Promise<void> {
    if (this.controller) {
      await this.controller.pause()
    }
  }

  /**
   * 播放
   */
  async play(): Promise<void> {
    if (this.controller) {
      await this.controller.play()
    }
  }

  /**
   * 跳转
   */
  async seek(time: number): Promise<void> {
    if (this.controller) {
      await this.controller.seek(time)
    }
  }

  /**
   * 设置音量
   */
  async setVolume(volume: number): Promise<void> {
    if (this.controller) {
      await this.controller.setVolume(volume)
    }
  }

  /**
   * 停止
   */
  async stop(): Promise<void> {
    if (this.controller) {
      await this.controller.stop()
    }
  }

  /**
   * 获取状态
   */
  getStatus() {
    return this.controller?.getStatus() || null
  }

  /**
   * 清理
   */
  async cleanup(): Promise<void> {
    windowSync.stop()
    if (this.controller) {
      if (this.controller.quit) {
        await this.controller.quit()
      } else if (this.controller.destroy) {
        await this.controller.destroy()
      }
      this.controller = null
    }
    this.useLibMPV = false
  }
}

export const mpvManager = new MPVManager()

