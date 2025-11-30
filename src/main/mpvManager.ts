import { MPVController } from './mpvController'
import { BrowserWindow } from 'electron'
import { getNSViewPointer } from './nativeHelper'
import { windowSync } from './windowSync'

class MPVManager {
  private controller: MPVController | null = null
  private videoWindow: BrowserWindow | null = null
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
  getController(): MPVController | null {
    return this.controller
  }

  /**
   * 启动 MPV 并播放视频
   */
  async playVideo(filePath: string): Promise<void> {
    // 如果已有控制器，先关闭
    if (this.controller) {
      await this.controller.quit()
      this.controller = null
    }

    let windowId: number | undefined

    // 只要有 video 窗口，就尝试获取窗口句柄传给 MPV（不管 embedMode 标志）
    console.log('[MPVManager] Checking for video window...')
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      console.log('[MPVManager] Video window exists, will get window handle for MPV')
      try {
        // 确保窗口显示在前台
        if (!this.videoWindow.isVisible()) {
          this.videoWindow.show()
        }
        this.videoWindow.focus()
        
        // 等待窗口完全准备好（缩短等待时间，因为不需要编译）
        console.log('[MPVManager] Waiting for video window to be ready...')
        await new Promise(resolve => setTimeout(resolve, 300))
        
        // 检查窗口状态
        if (this.videoWindow.isDestroyed()) {
          console.warn('[MPVManager] Video window was destroyed, using standalone window')
        } else {
          console.log('[MPVManager] Video window is ready, getting window handle for MPV...')
          console.log('[MPVManager] Window bounds:', this.videoWindow.getBounds())
          console.log('[MPVManager] Window visible:', this.videoWindow.isVisible())
          
          // 直接获取窗口句柄（不需要编译，直接使用 Electron 返回的句柄）
          console.log('[MPVManager] Getting window handle from video window...')
          const windowHandle = getNSViewPointer(this.videoWindow)
          
          if (windowHandle) {
            windowId = windowHandle
            console.log('[MPVManager] ✅ Got window handle:', windowId)
            console.log('[MPVManager] This handle will be passed to MPV via --wid parameter')
          } else {
            console.error('[MPVManager] ❌ Failed to get window handle!')
          }
        }
      } catch (error) {
        console.error('[MPVManager] Error getting window handle:', error)
      }
    } else {
      if (!this.videoWindow) {
        console.warn('[MPVManager] ⚠️ No video window set! Call setVideoWindow() first.')
      } else {
        console.warn('[MPVManager] ⚠️ Video window is destroyed')
      }
    }

    // 创建新的控制器
    this.controller = new MPVController()

    // 启动 mpv（如果 windowId 存在，则嵌入模式；否则独立窗口）
    if (windowId) {
      console.log('[MPVManager] Starting MPV with window handle:', windowId)
      console.log('[MPVManager] MPV should embed into video window')
    } else {
      console.warn('[MPVManager] Starting MPV without window handle - will create standalone window')
    }
    
    await this.controller.start(filePath, windowId)
    
    // 如果 MPV 创建了独立窗口，启动窗口同步
    if (this.controller.getProcess() && this.videoWindow) {
      console.log('[MPVManager] Setting up window synchronization...')
      windowSync.setVideoWindow(this.videoWindow)
      windowSync.setMPVProcess(this.controller.getProcess())
      // 延迟一下，等 MPV 窗口创建好
      setTimeout(() => {
        windowSync.start()
        console.log('[MPVManager] Window synchronization started')
      }, 1000)
    }
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
      await this.controller.quit()
      this.controller = null
    }
  }
}

export const mpvManager = new MPVManager()

