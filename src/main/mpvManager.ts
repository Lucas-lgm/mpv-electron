import { LibMPVController, isLibMPVAvailable } from './libmpv'
import { BrowserWindow, screen } from 'electron'
import { getNSViewPointer } from './nativeHelper'
import { windowSync } from './windowSync'

// 统一控制器类型：要么是 IPC 控制器，要么是 libmpv 控制器
type Controller = LibMPVController

class MPVManager {
  private controller: Controller | null = null
  private videoWindow: BrowserWindow | null = null
  private useLibMPV: boolean = false
  private embedMode: boolean = false // 暂时禁用嵌入模式，先确保 video 窗口显示

  /**
   * 设置视频窗口
   */
  setVideoWindow(window: BrowserWindow | null) {
    // 如果之前有窗口，先移除监听
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.removeAllListeners('close')
      this.videoWindow.removeAllListeners('closed')
      this.videoWindow.removeAllListeners('resize')
    }
    
    this.videoWindow = window
    
    // 为新窗口添加关闭监听，确保窗口关闭时立即停止渲染循环
    if (window && !window.isDestroyed()) {
      window.on('close', () => {
        this.cleanup()
      })
      window.on('closed', () => {
        // 窗口已关闭，清理引用
        if (this.videoWindow === window) {
          this.videoWindow = null
        }
      })
    }
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
  getController(): Controller | null {
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
      if (this.controller instanceof LibMPVController) {
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
        
        // 设置窗口 ID（真正嵌入 + 创建 GL/render context）
        await (this.controller as LibMPVController).setWindowId(windowId)
        console.log('[MPVManager] ✅ Render context created for Electron window')
        
        // 设置窗口大小变化监听
        this.setupWindowResizeListener()
        
        // 加载并播放文件
        await (this.controller as LibMPVController).loadFile(filePath)
        
        // 设置事件监听
        this.setupEventHandlers()
        
        // 渲染循环现在在原生代码中自动运行，不需要手动启动
        // this.startRenderLoop() // 已移除：渲染循环在原生代码中处理
        
        return
      } catch (error) {
        console.error('[MPVManager] Failed to use libmpv, falling back to IPC mode:', error)
        this.useLibMPV = false
        // 继续使用 IPC 模式
      }
    }
  }
  
  /**
   * 设置窗口大小变化监听
   * 简化：native 端会在每次渲染时自动从 view 获取最新尺寸
   * 这里只设置一次初始尺寸，之后由 native 端自动处理
   */
  private setupWindowResizeListener(): void {
    if (!this.videoWindow || !this.controller || !(this.controller instanceof LibMPVController)) {
      return
    }
    
    // 只在窗口创建时设置一次初始尺寸
    // native 端会在每次渲染时自动从 view 获取最新尺寸，所以不需要频繁更新
    const setInitialSize = () => {
      if (!this.videoWindow || this.videoWindow.isDestroyed()) {
        return
      }
      
      try {
        const display = screen.getDisplayMatching(this.videoWindow!.getBounds())
        const scaleFactor = display.scaleFactor || 1.0
        const contentSize = this.videoWindow!.getContentSize()
        
        if (Array.isArray(contentSize) && contentSize.length >= 2) {
          const logicalWidth = contentSize[0]
          const logicalHeight = contentSize[1]
          
          if (logicalWidth > 10 && logicalHeight > 10) {
            const pixelWidth = Math.round(logicalWidth * scaleFactor)
            const pixelHeight = Math.round(logicalHeight * scaleFactor)
            
            // 设置初始尺寸（native 端会在渲染时自动更新）
            ;(this.controller as LibMPVController).setWindowSize(pixelWidth, pixelHeight)
            console.log(`[MPVManager] Initial window size: ${pixelWidth}x${pixelHeight} (logical: ${logicalWidth}x${logicalHeight}, scale: ${scaleFactor})`)
          }
        }
      } catch (error) {
        console.error('[MPVManager] Error setting initial window size:', error)
      }
    }
    
    // 延迟一点设置，确保窗口完全准备好
    setTimeout(setInitialSize, 100)
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.controller) return
    
    const videoWindow = this.videoWindow
    if (!videoWindow) return
    
    // 监听状态更新
    ;(this.controller as LibMPVController).on('status', (status: any) => {
      if (videoWindow && !videoWindow.isDestroyed()) {
        // 将时间信息发给渲染层
        videoWindow.webContents.send('video-time-update', {
          currentTime: status.position,
          duration: status.duration
        })
      }
    })
    
    // 监听错误
    ;(this.controller as any).on('error', (error: any) => {
      console.error('MPV controller error:', error)
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('mpv-error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    })
    
    // 监听播放结束
    ;(this.controller as any).on('ended', () => {
      console.log('MPV playback ended')
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('video-ended')
      }
    })
    
    // 监听停止
    ;(this.controller as any).on('stopped', () => {
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

  // 渲染循环已移至原生代码，不再需要 JS 层面的循环

  /**
   * 清理
   */
  async cleanup(): Promise<void> {
    // 先停止 windowSync，避免访问已销毁的窗口
    windowSync.stop()
    windowSync.cleanup()
    
    // 然后销毁 controller（会停止渲染循环）
    if (this.controller) {
      if (this.controller instanceof LibMPVController) {
        await this.controller.destroy()
      }
      this.controller = null
    }
    this.useLibMPV = false
  }
}

export const mpvManager = new MPVManager()

