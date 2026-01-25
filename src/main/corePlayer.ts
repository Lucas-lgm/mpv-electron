import { BrowserWindow, BrowserView, screen } from 'electron'
import { PlayerStateMachine, type PlayerState, type PlayerPhase } from './playerState'
import type { MPVStatus } from './libmpv'
import { LibMPVController, isLibMPVAvailable } from './libmpv'
import { getNSViewPointer, getHWNDPointer } from './nativeHelper'
import { Timeline } from './timeline'

export interface CorePlayer {
  setVideoWindow(window: BrowserWindow | null): void
  setControlView(view: BrowserView | null): void
  setControlWindow(window: BrowserWindow | null): void
  play(filePath: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  isUsingEmbeddedMode(): boolean
  cleanup(): Promise<void>
  getPlayerState(): PlayerState
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  broadcastToPlaybackUIs(channel: string, payload?: any): void
  sendKey(key: string): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
  setHdrEnabled(enabled: boolean): void
}

class CorePlayerImpl implements CorePlayer {
  private controller: LibMPVController | null = null
  private videoWindow: BrowserWindow | null = null
  private useLibMPV: boolean = false
  private isCleaningUp: boolean = false
  private initPromise: Promise<void> | null = null
  private stateMachine = new PlayerStateMachine()
  private timeline: Timeline | null = null
  private pendingResizeTimer: NodeJS.Timeout | null = null
  private resizeStableTimer: NodeJS.Timeout | null = null // Resize 稳定检测定时器
  private lastPhysicalWidth: number = -1
  private lastPhysicalHeight: number = -1
  // 数据驱动的渲染状态标记
  private isResizing: boolean = false // 是否正在 resize（resize 过程中不渲染）
  private pendingResizeRender: boolean = false // resize 完成后需要渲染的标记
  private pendingSeekRender: boolean = false // seek 完成后需要渲染的标记
  private controlView: BrowserView | null = null
  private controlWindow: BrowserWindow | null = null // 双窗口模式：控制窗口
  private renderLoopActive: boolean = false
  private renderLoopHandle: NodeJS.Timeout | null = null
  private readonly DEFAULT_RENDER_INTERVAL_MS = 20 // 默认 50fps
  private currentVideoFps: number | null = null // 当前视频帧率
  private currentRenderInterval: number = 20 // 当前渲染间隔（毫秒）
  private lastIsSeeking: boolean = false // 上次的 isSeeking 状态，用于检测 seek 完成
  private baseRenderInterval: number = 20 // 基础渲染间隔（根据帧率计算）
  private lastRenderRequestTime: number = 0 // 上次渲染请求的时间戳
  private renderRequestCount: number = 0 // 渲染请求计数（用于检测延迟）
  private readonly MIN_RENDER_INTERVAL_MS = 8 // 最小渲染间隔（120fps）
  private readonly ADJUSTMENT_FACTOR = 0.75 // 调整因子：降低到75%
  private readonly CHECK_INTERVAL = 10 // 每10次请求检查一次

  constructor() {
    if (isLibMPVAvailable()) {
      this.controller = new LibMPVController()
      this.initPromise = this.controller.initialize().catch(() => {
        this.controller = null
        this.initPromise = null
      })
    }
    this.timeline = new Timeline({
      interval: 100,
      getStatus: () => this.getStatus(),
      send: (payload) => {
        this.sendToPlaybackUIs('video-time-update', payload)
      }
    })
    // 数据驱动架构：renderLoop 持续运行，根据状态决定是否渲染
    // 不再根据 phase 启动/停止循环，而是让循环持续运行并检查状态
    this.stateMachine.on('state', (st) => {
      this.timeline?.handlePlayerStateChange(st.phase)
      // 确保渲染循环运行（如果还没运行）
      if (!this.renderLoopActive && this.controller && process.platform === 'darwin') {
        const isJsDriven = this.controller.getJsDrivenRenderMode()
        if (isJsDriven) {
          this.startRenderLoop()
        }
      }
    })
    
    // 监听视频帧率变化，动态调整渲染间隔
    if (this.controller) {
      this.controller.on('fps-change', (fps: number | null) => {
        this.updateRenderInterval(fps)
      })
    }
  }
  
  /**
   * 根据视频帧率更新渲染间隔
   * @param fps 视频帧率（fps），null 表示未知或无效
   */
  private updateRenderInterval(fps: number | null): void {
    this.currentVideoFps = fps
    
    if (fps && fps > 0.1) {
      // 根据视频帧率计算基础渲染间隔：1000ms / fps
      // 限制范围：最小 8ms (120fps)，最大 42ms (24fps)
      const calculatedInterval = Math.round(1000 / fps)
      this.baseRenderInterval = Math.max(8, Math.min(calculatedInterval, 42))
      this.currentRenderInterval = this.baseRenderInterval
      this.renderRequestCount = 0 // 重置计数
      this.lastRenderRequestTime = 0 // 重置时间戳
      console.log(`[CorePlayer] 📹 Video FPS: ${fps.toFixed(2)}, Base render interval: ${this.baseRenderInterval}ms`)
    } else {
      // 帧率未知或无效，使用默认值
      this.baseRenderInterval = this.DEFAULT_RENDER_INTERVAL_MS
      this.currentRenderInterval = this.baseRenderInterval
      this.renderRequestCount = 0 // 重置计数
      this.lastRenderRequestTime = 0 // 重置时间戳
      console.log(`[CorePlayer] 📹 Video FPS: unknown, using default render interval: ${this.baseRenderInterval}ms`)
    }
    
    // 如果渲染循环正在运行，需要重启以应用新的间隔
    if (this.renderLoopActive) {
      this.stopRenderLoop()
      this.startRenderLoop()
    }
  }
  
  /**
   * 检测渲染是否跟上，如果跟不上则降低渲染间隔（增加渲染频率）
   * 通过监控实际渲染请求的时间间隔来判断
   */
  private checkAndAdjustRenderInterval(): void {
    const now = Date.now()
    this.renderRequestCount++
    
    // 每 CHECK_INTERVAL 次请求检查一次
    if (this.renderRequestCount < this.CHECK_INTERVAL) {
      return
    }
    
    this.renderRequestCount = 0
    
    if (this.lastRenderRequestTime === 0) {
      // 第一次请求，记录时间戳
      this.lastRenderRequestTime = now
      return
    }
    
    // 计算实际的时间间隔
    const actualInterval = now - this.lastRenderRequestTime
    this.lastRenderRequestTime = now
    
    // 如果实际间隔明显小于设置的间隔，说明渲染跟不上
    // 例如：设置 20ms，但实际只过了 15ms 就调用了，说明需要更频繁的渲染
    // 或者：实际间隔远小于设置间隔的 80%，说明渲染积压
    const threshold = this.currentRenderInterval * 0.8
    
    if (actualInterval < threshold && actualInterval > 0) {
      // 渲染跟不上，降低间隔（增加频率）
      const newInterval = Math.max(
        this.MIN_RENDER_INTERVAL_MS,
        Math.floor(this.currentRenderInterval * this.ADJUSTMENT_FACTOR)
      )
      
      if (newInterval < this.currentRenderInterval) {
        this.currentRenderInterval = newInterval
        console.log(`[CorePlayer] ⚠️ Render falling behind! Actual interval: ${actualInterval.toFixed(1)}ms, reducing to ${this.currentRenderInterval}ms (base: ${this.baseRenderInterval}ms)`)
      }
    } else if (actualInterval >= this.baseRenderInterval * 0.9 && this.currentRenderInterval < this.baseRenderInterval) {
      // 渲染跟上了，恢复到基础间隔
      this.currentRenderInterval = this.baseRenderInterval
      console.log(`[CorePlayer] ✅ Render caught up! Actual interval: ${actualInterval.toFixed(1)}ms, restoring to ${this.currentRenderInterval}ms`)
    }
  }

  // JavaScript 驱动渲染循环（根据视频帧率动态调整间隔，并自适应检测延迟）
  /**
   * 统一的渲染判断逻辑（完全数据驱动）
   * 所有渲染决策都基于状态数据，不依赖事件
   * @param state 播放器状态
   * @returns 是否应该渲染
   */
  private shouldRender(state: PlayerState): boolean {
    // 1. Seek 过程中不渲染
    if (state.isSeeking) {
      return false
    }
    
    // 2. Resize 过程中不渲染（等待稳定）
    if (this.isResizing) {
      return false
    }
    
    // 3. Seek 完成后需要渲染（无论什么状态）
    if (this.pendingSeekRender) {
      this.pendingSeekRender = false // 清除标记
      return true
    }
    
    // 4. Resize 完成后需要渲染（非播放状态）
    if (this.pendingResizeRender) {
      this.pendingResizeRender = false // 清除标记
      // 只在非播放状态时渲染（播放中由循环自动处理）
      if (state.phase !== 'playing') {
        return true
      }
      return false
    }
    
    // 5. 正常播放状态渲染
    if (state.phase === 'playing') {
      return true
    }
    
    return false
  }


  private renderLoop = () => {
    if (!this.renderLoopActive) return
    
    const currentState = this.stateMachine.getState()
    
    // 使用统一的判断逻辑
    if (this.shouldRender(currentState)) {
      // 检测渲染是否跟上，如果跟不上则降低间隔（增加频率）
      this.checkAndAdjustRenderInterval()
      
      // 请求渲染
      if (this.controller) {
        this.controller.requestRender()
      }
    }
    
    // 继续下一帧（使用动态计算的间隔）
    this.renderLoopHandle = setTimeout(this.renderLoop, this.currentRenderInterval)
  }

  private startRenderLoop() {
    if (this.renderLoopActive) {
      return
    }
    // 数据驱动架构：renderLoop 持续运行，不依赖播放状态
    if (this.controller && process.platform === 'darwin') {
      const isJsDriven = this.controller.getJsDrivenRenderMode()
      if (isJsDriven) {
        this.renderLoopActive = true
        this.renderLoopHandle = setTimeout(this.renderLoop, this.currentRenderInterval)
        console.log(`[CorePlayer] ✅ Started data-driven render loop (interval: ${this.currentRenderInterval}ms)`)
      }
    }
  }

  private stopRenderLoop() {
    // 数据驱动架构：renderLoop 持续运行，通常不需要停止
    // 只有在清理时才停止
    if (!this.renderLoopActive) {
      return
    }
    this.renderLoopActive = false
    if (this.renderLoopHandle) {
      clearTimeout(this.renderLoopHandle)
      this.renderLoopHandle = null
    }
  }

  setVideoWindow(window: BrowserWindow | null) {
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      this.videoWindow.removeAllListeners('resize')
    }
    this.videoWindow = window
  }
  setControlView(view: BrowserView | null) {
    this.controlView = view
  }

  setControlWindow(window: BrowserWindow | null) {
    this.controlWindow = window
  }

  isUsingEmbeddedMode(): boolean {
    return this.useLibMPV
  }

  setHdrEnabled(enabled: boolean): void {
    if (this.controller) {
      this.controller.setHdrEnabled(enabled)
    }
  }

  async play(filePath: string): Promise<void> {
    if (this.isCleaningUp) {
      return
    }
    let windowId: number | undefined
    if (this.videoWindow && !this.videoWindow.isDestroyed()) {
      try {
        if (!this.videoWindow.isVisible()) {
          this.videoWindow.show()
        }
        this.videoWindow.focus()
        // Windows 上需要等待窗口完全准备好
        const waitTime = process.platform === 'win32' ? 500 : 300
        await new Promise(resolve => setTimeout(resolve, waitTime))
        if (this.videoWindow.isDestroyed()) {
          console.warn('[CorePlayer] Window was destroyed while waiting')
        } else {
          // 按平台获取窗口句柄
          if (process.platform === 'darwin') {
            const windowHandle = getNSViewPointer(this.videoWindow)
            if (windowHandle) {
              windowId = windowHandle
              console.log('[CorePlayer] Got NSView pointer:', windowHandle)
            }
          } else if (process.platform === 'win32') {
            // Windows 上，确保窗口完全显示后再获取 HWND
            if (!this.videoWindow.isVisible()) {
              this.videoWindow.show()
              await new Promise(resolve => setTimeout(resolve, 100))
            }
            const windowHandle = getHWNDPointer(this.videoWindow)
            if (windowHandle) {
              windowId = windowHandle
              console.log('[CorePlayer] Got HWND:', windowHandle)
            } else {
              console.error('[CorePlayer] Failed to get HWND')
            }
          }
        }
      } catch (error) {
        console.error('[CorePlayer] Error getting window handle:', error)
      }
    }
    if (isLibMPVAvailable() && windowId) {
      this.useLibMPV = true
      try {
        if (!this.controller) {
          this.controller = new LibMPVController()
          // Windows 上需要在初始化前设置 wid
          if (process.platform === 'win32' && windowId) {
            this.initPromise = this.controller.initialize(windowId)
          } else {
            this.initPromise = this.controller.initialize()
          }
        }
        if (this.initPromise) {
          await this.initPromise
          this.initPromise = null
        }
      // macOS 和 Windows 都需要调用 setWindowId 来创建渲染上下文
      if (windowId) {
        await this.controller.setWindowId(windowId)
        // setWindowId 后，JavaScript 驱动模式已启用，如果正在播放则启动渲染循环
        const currentState = this.getPlayerState()
        if (currentState.phase === 'playing') {
          this.startRenderLoop()
        }
      }
      await this.syncWindowSize()
        this.setupResizeHandler()
        this.setupEventHandlers()
        await this.controller.loadFile(filePath)
        await this.syncWindowSize()
        return
      } catch {
        this.useLibMPV = false
      }
    }
  }

  private async syncWindowSize(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  private setupResizeHandler(): void {
    if (!this.videoWindow || this.videoWindow.isDestroyed()) {
      return
    }
    this.videoWindow.removeAllListeners('resize')
    this.videoWindow.on('resize', () => {
      // 数据驱动：标记正在 resize，renderLoop 会检测并跳过渲染
      this.isResizing = true
      
      // 重置稳定检测定时器（防抖机制）
      // 只有在 resize 事件停止 100ms 后才认为稳定
      if (this.resizeStableTimer) {
        clearTimeout(this.resizeStableTimer)
      }
      this.resizeStableTimer = setTimeout(() => {
        this.resizeStableTimer = null
        // 100ms 内没有新的 resize 事件，认为已稳定
        this.isResizing = false
        const currentState = this.stateMachine.getState()
        // 只在非播放状态时标记需要渲染（播放中由循环自动处理）
        if (currentState.phase !== 'playing') {
          this.pendingResizeRender = true
          console.log('[CorePlayer] ✅ Resize stabilized, marked for render (non-playing)')
        } else {
          console.log('[CorePlayer] Resize stabilized (playing), render loop will handle it')
        }
      }, 100) // 100ms 内没有新事件 = 稳定
      
      this.scheduleWindowSizeSync()
    })
  }

  private scheduleWindowSizeSync(): void {
    if (this.pendingResizeTimer) {
      clearTimeout(this.pendingResizeTimer)
    }
    this.pendingResizeTimer = setTimeout(() => {
      this.pendingResizeTimer = null
      this.syncWindowSizeThrottled().catch(() => {})
    }, 16)
  }

  private async syncWindowSizeThrottled(): Promise<void> {
    if (!this.videoWindow || this.videoWindow.isDestroyed() || !this.controller) {
      return
    }
    const bounds = this.videoWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.videoWindow.getBounds())
    const scaleFactor = display.scaleFactor
    const width = Math.round(bounds.width * scaleFactor)
    const height = Math.round(bounds.height * scaleFactor)
    if (width === this.lastPhysicalWidth && height === this.lastPhysicalHeight) {
      return
    }
    console.log(`[CorePlayer] Window size changed: ${this.lastPhysicalWidth}x${this.lastPhysicalHeight} -> ${width}x${height} (scale: ${scaleFactor})`)
    this.lastPhysicalWidth = width
    this.lastPhysicalHeight = height
    if (this.controller instanceof LibMPVController) {
      await this.controller.setWindowSize(width, height)
    }
  }

  private setupEventHandlers(): void {
    if (!this.controller) return
    const videoWindow = this.videoWindow
    if (!videoWindow) return
    
    // 先移除旧的监听器，避免重复注册
    this.controller.removeAllListeners('status')
    this.controller.removeAllListeners('file-loaded')
    this.controller.removeAllListeners('fps-change')
    
    this.controller.on('status', (status: MPVStatus) => {
      // 检测 seek 完成（isSeeking 从 true 变为 false）
      const wasSeeking = this.lastIsSeeking
      const isSeeking = status.isSeeking ?? false
      this.lastIsSeeking = isSeeking
      
      // 先更新状态，确保 stateMachine 中的状态是最新的
      this.updateFromMPVStatus(status)
      
      // 数据驱动：seek 完成后，标记需要渲染
      // renderLoop 会检测到 pendingSeekRender 并触发渲染
      if (wasSeeking && !isSeeking) {
        this.pendingSeekRender = true
        console.log('[CorePlayer] ✅ Seek completed, marked for render')
      }
      
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    })
    
    // 监听视频帧率变化，动态调整渲染间隔
    this.controller.on('fps-change', (fps: number | null) => {
      this.updateRenderInterval(fps)
    })
    
    // 监听文件加载完成事件，确保自动播放
    this.controller.on('file-loaded', async () => {
      if (!this.controller) return
      try {
        // 主动获取一次视频帧率，确保渲染间隔及时更新
        const fps = await this.controller.getProperty('estimated-vf-fps')
        if (typeof fps === 'number' && fps > 0.1) {
          this.updateRenderInterval(fps)
        }
        
        // 检查 pause 状态，如果为 true 则自动播放
        const pauseState = await this.controller.getProperty('pause')
        if (pauseState === true) {
          await this.controller.play()
        }
      } catch (error) {
        // 忽略错误，继续执行
      }
    })
  }

  async togglePause(): Promise<void> {
    if (this.controller) {
      await this.controller.togglePause()
      const status = this.controller.getStatus()
      if (status) {
        this.updateFromMPVStatus(status as MPVStatus)
      }
    }
  }

  async pause(): Promise<void> {
    if (this.controller) {
      await this.controller.pause()
    }
  }

  async resume(): Promise<void> {
    if (this.controller) {
      await this.controller.play()
    }
  }

  async seek(time: number): Promise<void> {
    if (!this.controller) {
      return
    }
    this.timeline?.markSeek(time)
    await this.controller.seek(time)
    const status = this.controller.getStatus()
    if (status) {
      this.updateFromMPVStatus(status as MPVStatus)
      await this.timeline?.broadcastTimeline({ currentTime: time, duration: status.duration })
      this.sendToPlaybackUIs('player-state', this.getPlayerState())
    }
  }

  async setVolume(volume: number): Promise<void> {
    if (this.controller) {
      await this.controller.setVolume(volume)
      const status = this.controller.getStatus()
      if (status) {
        this.updateFromMPVStatus(status as MPVStatus)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.controller) {
      await this.controller.stop()
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
      // 停止渲染循环
      this.stopRenderLoop()
      
      if (this.pendingResizeTimer) {
        clearTimeout(this.pendingResizeTimer)
        this.pendingResizeTimer = null
      }
      if (this.resizeStableTimer) {
        clearTimeout(this.resizeStableTimer)
        this.resizeStableTimer = null
      }
      // 清除数据驱动的状态标记
      this.isResizing = false
      this.pendingResizeRender = false
      this.pendingSeekRender = false
      this.timeline?.dispose()
      if (this.controller) {
        if (this.controller instanceof LibMPVController) {
          await this.controller.stop()
          await this.controller.destroy()
        }
        this.controller = null
      }
      this.controlView = null
    } finally {
      this.isCleaningUp = false
    }
  }

  updateFromMPVStatus(status: MPVStatus) {
    this.stateMachine.updateFromStatus(status)
  }

  setPhase(phase: PlayerPhase) {
    this.stateMachine.setPhase(phase)
  }

  setError(message: string) {
    this.stateMachine.setError(message)
  }

  getPlayerState(): PlayerState {
    return this.stateMachine.getState()
  }

  onPlayerState(listener: (state: PlayerState) => void) {
    this.stateMachine.on('state', listener)
  }

  offPlayerState(listener: (state: PlayerState) => void) {
    this.stateMachine.off('state', listener)
  }

  private sendToPlaybackUIs(channel: string, payload?: any) {
    // 发送到视频窗口
    const vw = this.videoWindow
    if (vw && !vw.isDestroyed()) {
      vw.webContents.send(channel, payload)
    }
    // 发送到控制窗口（双窗口模式）
    const cw = this.controlWindow
    if (cw && !cw.isDestroyed()) {
      cw.webContents.send(channel, payload)
    }
    // 发送到控制视图（BrowserView，向后兼容）
    const cv = this.controlView
    if (cv && !cv.webContents.isDestroyed()) {
      cv.webContents.send(channel, payload)
    }
  }

  broadcastToPlaybackUIs(channel: string, payload?: any) {
    this.sendToPlaybackUIs(channel, payload)
  }

  async sendKey(key: string): Promise<void> {
    if (!this.controller) {
      return
    }
    if (this.initPromise) {
      try {
        await this.initPromise
        this.initPromise = null
      } catch {
      }
    }
    await this.controller.keypress(key)
  }
 
  async debugVideoState(): Promise<void> {
    if (this.controller) {
      await this.controller.debugVideoState()
    }
  }

  async debugHdrStatus(): Promise<void> {
    if (this.controller) {
      await this.controller.debugHdrStatus()
    }
  }
}

export const corePlayer: CorePlayer = new CorePlayerImpl()

export function setCorePlayerBackend(impl: CorePlayer) {
  Object.assign(corePlayer, impl)
}

export function updateFromMPVStatus(status: MPVStatus) {
  ;(corePlayer as CorePlayerImpl).updateFromMPVStatus(status)
}

export function setPhase(phase: PlayerPhase) {
  ;(corePlayer as CorePlayerImpl).setPhase(phase)
}

export function getPlayerState(): PlayerState {
  return corePlayer.getPlayerState()
}

export function onPlayerState(listener: (state: PlayerState) => void) {
  corePlayer.onPlayerState(listener)
}

export function offPlayerState(listener: (state: PlayerState) => void) {
  corePlayer.offPlayerState(listener)
}

export function setError(message: string) {
  ;(corePlayer as CorePlayerImpl).setError(message)
}
