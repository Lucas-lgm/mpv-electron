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
        
        // 设置初始窗口尺寸（从 Electron 传入）
        const display = screen.getDisplayMatching(this.videoWindow!.getBounds())
        const scaleFactor = display.scaleFactor || 1.0
        const contentSize = this.videoWindow!.getContentSize()
        let lastWidth = 0
        let lastHeight = 0
        if (Array.isArray(contentSize) && contentSize.length >= 2) {
          const logicalWidth = contentSize[0]
          const logicalHeight = contentSize[1]
          if (logicalWidth > 10 && logicalHeight > 10) {
            const pixelWidth = Math.round(logicalWidth * scaleFactor)
            const pixelHeight = Math.round(logicalHeight * scaleFactor)
            await (this.controller as LibMPVController).setWindowSize(pixelWidth, pixelHeight)
            lastWidth = pixelWidth
            lastHeight = pixelHeight
            console.log(`[MPVManager] Initial window size: ${pixelWidth}x${pixelHeight} (logical: ${logicalWidth}x${logicalHeight}, scale: ${scaleFactor})`)
          }
        }
        
        // 设置窗口大小变化监听（通知 native 端更新尺寸）
        // 注意：虽然 native 端可以从 NSView 读取，但为了确保尺寸同步和性能，由 Electron 主动通知
        let resizeTimer: NodeJS.Timeout | null = null
        
        this.videoWindow?.on('resize', () => {
          if (resizeTimer) {
            clearTimeout(resizeTimer)
          }
          
          resizeTimer = setTimeout(() => {
            if (!this.videoWindow || this.videoWindow.isDestroyed()) {
              return
            }
            
            try {
              const display = screen.getDisplayMatching(this.videoWindow!.getBounds())
              const scaleFactor = display.scaleFactor || 1.0
              const contentSize = this.videoWindow!.getContentSize()
              
              if (!Array.isArray(contentSize) || contentSize.length < 2) {
                return
              }
              
              const logicalWidth = contentSize[0]
              const logicalHeight = contentSize[1]
              
              if (logicalWidth < 10 || logicalHeight < 10) {
                return
              }
              
              const pixelWidth = Math.round(logicalWidth * scaleFactor)
              const pixelHeight = Math.round(logicalHeight * scaleFactor)
              
              console.log(`[MPVManager] Resize event: logical=${logicalWidth}x${logicalHeight}, scale=${scaleFactor}, pixel=${pixelWidth}x${pixelHeight}`)
              
              // 通知 native 端更新尺寸
              ;(this.controller as LibMPVController).setWindowSize(pixelWidth, pixelHeight).catch(err => {
                console.error('[MPVManager] Error setting window size:', err)
              })
              
              // 调试：延迟打印视频状态（给 mpv 一点时间处理）
              setTimeout(async () => {
                try {
                  await (this.controller as LibMPVController).debugVideoState()
                } catch (e) {
                  // 忽略错误
                }
              }, 100)
            } catch (error) {
              console.error('[MPVManager] Error in resize handler:', error)
            }
          }, 16) // 16ms 节流，约 60fps
        })
        
        // 加载并播放文件
        await (this.controller as LibMPVController).loadFile(filePath)
        
        // 加载文件后，再次设置窗口尺寸，确保 mpv 知道正确的窗口尺寸
        // 因为加载文件时可能会重置某些状态
        const display2 = screen.getDisplayMatching(this.videoWindow!.getBounds())
        const scaleFactor2 = display2.scaleFactor || 1.0
        const contentSize2 = this.videoWindow!.getContentSize()
        if (Array.isArray(contentSize2) && contentSize2.length >= 2) {
          const logicalWidth2 = contentSize2[0]
          const logicalHeight2 = contentSize2[1]
          if (logicalWidth2 > 10 && logicalHeight2 > 10) {
            const pixelWidth2 = Math.round(logicalWidth2 * scaleFactor2)
            const pixelHeight2 = Math.round(logicalHeight2 * scaleFactor2)
            await (this.controller as LibMPVController).setWindowSize(pixelWidth2, pixelHeight2)
            console.log(`[MPVManager] Window size after load: ${pixelWidth2}x${pixelHeight2}`)
          }
        }
        
        // 设置事件监听
        this.setupEventHandlers()

        return
      } catch (error) {
        console.error('[MPVManager] Failed to use libmpv, falling back to IPC mode:', error)
        this.useLibMPV = false
        // 继续使用 IPC 模式
      }
    }
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

