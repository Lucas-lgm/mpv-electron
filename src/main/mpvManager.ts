import { LibMPVController, MPVStatus, isLibMPVAvailable } from './libmpv'
import { BrowserWindow, screen } from 'electron'
import { getNSViewPointer } from './nativeHelper'
import { PlayerStateMachine } from './playerState'

// 统一控制器类型：要么是 IPC 控制器，要么是 libmpv 控制器
type Controller = LibMPVController

class MPVManager {
  private controller: Controller | null = null
  private videoWindow: BrowserWindow | null = null
  private useLibMPV: boolean = false
  private isCleaningUp: boolean = false
  private initPromise: Promise<void> | null = null
  private stateMachine = new PlayerStateMachine()

  constructor() {
    if (isLibMPVAvailable()) {
      this.controller = new LibMPVController()
      this.initPromise = (this.controller as LibMPVController).initialize().catch((error) => {
        console.error('[MPVManager] Failed to pre-initialize libmpv:', error)
        this.controller = null
        this.initPromise = null
      })
    }
  }

  /**
   * 设置视频窗口
   */
  setVideoWindow(window: BrowserWindow | null) {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.removeAllListeners('resize')
    }
    
    this.videoWindow = window
  }

  /**
   * 同步窗口尺寸到 MPV
   */
  private async syncWindowSize(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }

    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    
    // 计算物理像素尺寸
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    
    // console.log(`[MPVManager] Syncing window size: logical=${bounds.width}x${bounds.height}, physical=${width}x${height}, scale=${scaleFactor}`)
    
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  /**
   * 设置窗口大小变化监听
   */
  private setupResizeHandler(): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
      return
    }

    // 先移除可能存在的旧监听器
    this.videoWindow.removeAllListeners('resize')
    
    // 添加新的监听器
    this.videoWindow.on('resize', () => {
      this.syncWindowSize().catch(err => {
        console.error('[MPVManager] Error syncing window size on resize:', err)
      })
    })
  }

  /**
   * 获取或创建 MPV 控制器
   */
  getController(): Controller | null {
    return this.controller
  }

  getPlayerState() {
    return this.stateMachine.getState()
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
  async play(filePath: string): Promise<void> {
    if (this.isCleaningUp) {
      console.warn('[MPVManager] Warning: A cleanup process is already running. Play request ignored.')
      return
    }

    let windowId: number | undefined

    this.stateMachine.setPhase('loading')

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
        if (!this.controller) {
          this.controller = new LibMPVController()
          this.initPromise = (this.controller as LibMPVController).initialize()
        }

        if (this.initPromise) {
          await this.initPromise
          this.initPromise = null
        }
        
        await (this.controller as LibMPVController).setWindowId(windowId)
        console.log('[MPVManager] ✅ Render context created for Electron window')
        
        await this.syncWindowSize()
        
        this.setupResizeHandler()
        
        await (this.controller as LibMPVController).loadFile(filePath)
        
        await this.syncWindowSize()
        
        this.setupEventHandlers()

        this.stateMachine.setPhase('playing')

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

    ;(this.controller as LibMPVController).on('status', (status: MPVStatus) => {
      this.stateMachine.updateFromStatus(status)
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('video-time-update', {
          currentTime: status.position,
          duration: status.duration
        })
        videoWindow.webContents.send('player-state', this.stateMachine.getState())
      }
    })

    ;(this.controller as any).on('error', (error: any) => {
      console.error('MPV controller error:', error)
      if (error instanceof Error && error.message) {
        this.stateMachine.setError(error.message)
      } else {
        this.stateMachine.setError('Unknown error')
      }
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('player-error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
        videoWindow.webContents.send('player-state', this.stateMachine.getState())
      }
    })

    ;(this.controller as any).on('ended', () => {
      console.log('MPV playback ended')
      this.stateMachine.setPhase('ended')
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('video-ended')
        videoWindow.webContents.send('player-state', this.stateMachine.getState())
      }
    })

    ;(this.controller as any).on('stopped', () => {
      console.log('MPV stopped')
      this.stateMachine.setPhase('stopped')
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.webContents.send('player-state', this.stateMachine.getState())
      }
    })
  }

  async togglePause(): Promise<void> {
    if (this.controller) {
      await this.controller.togglePause()
      const status = this.controller.getStatus()
      if (status) {
        this.stateMachine.updateFromStatus(status as MPVStatus)
      }
    }
  }

  async pause(): Promise<void> {
    if (this.controller) {
      await this.controller.pause()
      this.stateMachine.setPhase('paused')
    }
  }

  async resume(): Promise<void> {
    if (this.controller) {
      await this.controller.play()
      this.stateMachine.setPhase('playing')
    }
  }

  async seek(time: number): Promise<void> {
    if (this.controller) {
      await this.controller.seek(time)
      const status = this.controller.getStatus()
      if (status) {
        this.stateMachine.updateFromStatus(status as MPVStatus)
      }
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (this.controller) {
      await this.controller.setVolume(volume)
      const status = this.controller.getStatus()
      if (status) {
        this.stateMachine.updateFromStatus(status as MPVStatus)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.controller) {
      await this.controller.stop()
      this.stateMachine.setPhase('stopped')
    }
  }

  getStatus() {
    return this.controller?.getStatus() || null
  }

  async cleanup(): Promise<void> {
    if (this.isCleaningUp) {
      return
    }
    this.isCleaningUp = true
    try {
      if (this.controller) {
        if (this.controller instanceof LibMPVController) {
          await this.controller.destroy()
          console.log('[MPVManager] Cleanup: controller destroyed on app exit.')
        }
        this.controller = null
      }
    } finally {
      this.isCleaningUp = false
    }
  }
}

export const mpvManager = new MPVManager()
