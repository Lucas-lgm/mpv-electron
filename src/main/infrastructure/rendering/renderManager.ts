import type { PlayerState } from '../../application/state/playerState'
import type { LibMPVController } from '../mpv/libmpv'

/**
 * 渲染管理器（完全数据驱动）
 * 负责管理渲染循环、状态标记和渲染间隔
 */
export class RenderManager {
  private controller: LibMPVController | null = null
  private getState: () => PlayerState
  
  // 渲染循环状态
  private renderLoopActive: boolean = false
  private renderLoopHandle: NodeJS.Timeout | null = null
  
  // 渲染状态标记
  private isResizing: boolean = false
  private pendingResizeRender: boolean = false
  private pendingSeekRender: boolean = false
  private resizeStableTimer: NodeJS.Timeout | null = null
  
  // 渲染间隔管理
  private readonly DEFAULT_RENDER_INTERVAL_MS = 20 // 默认 50fps
  private currentVideoFps: number | null = null
  private currentRenderInterval: number = 20
  private baseRenderInterval: number = 20
  private readonly MIN_RENDER_INTERVAL_MS = 16 // 最小渲染间隔（60fps）
  private readonly ADJUSTMENT_FACTOR = 0.75 // 调整因子
  private readonly CHECK_INTERVAL = 10 // 每10次请求检查一次
  
  // 性能监控
  private lastRenderRequestTime: number = 0
  private renderRequestCount: number = 0

  constructor(controller: LibMPVController | null, getState: () => PlayerState) {
    this.controller = controller
    this.getState = getState
  }

  /**
   * 设置 controller（用于动态更新）
   */
  setController(controller: LibMPVController | null): void {
    this.controller = controller
  }

  /**
   * 统一的渲染判断逻辑（完全数据驱动）
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

  /**
   * 检测渲染是否跟上，如果跟不上则降低渲染间隔（增加渲染频率）
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
    const threshold = this.currentRenderInterval * 0.8
    
    if (actualInterval < threshold && actualInterval > 0) {
      // 渲染跟不上，降低间隔（增加频率）
      const newInterval = Math.max(
        this.MIN_RENDER_INTERVAL_MS,
        Math.floor(this.currentRenderInterval * this.ADJUSTMENT_FACTOR)
      )
      
      if (newInterval < this.currentRenderInterval) {
        this.currentRenderInterval = newInterval
        console.log(`[RenderManager] ⚠️ Render falling behind! Actual interval: ${actualInterval.toFixed(1)}ms, reducing to ${this.currentRenderInterval}ms (base: ${this.baseRenderInterval}ms)`)
      }
    } else if (actualInterval >= this.baseRenderInterval * 0.9 && this.currentRenderInterval < this.baseRenderInterval) {
      // 渲染跟上了，恢复到基础间隔
      this.currentRenderInterval = this.baseRenderInterval
      console.log(`[RenderManager] ✅ Render caught up! Actual interval: ${actualInterval.toFixed(1)}ms, restoring to ${this.currentRenderInterval}ms`)
    }
  }

  /**
   * 渲染循环（数据驱动）
   */
  private renderLoop = (): void => {
    if (!this.renderLoopActive) return
    
    const currentState = this.getState()
    
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

  /**
   * 检查渲染循环是否激活
   */
  isActive(): boolean {
    return this.renderLoopActive
  }

  /**
   * 启动渲染循环
   */
  start(): void {
    if (this.renderLoopActive) {
      return
    }
    // 数据驱动架构：renderLoop 持续运行，不依赖播放状态
    if (this.controller && process.platform === 'darwin') {
      const isJsDriven = this.controller.getJsDrivenRenderMode()
      if (isJsDriven) {
        this.renderLoopActive = true
        this.renderLoopHandle = setTimeout(this.renderLoop, this.currentRenderInterval)
        console.log(`[RenderManager] ✅ Started data-driven render loop (interval: ${this.currentRenderInterval}ms)`)
      }
    }
  }

  /**
   * 停止渲染循环
   */
  stop(): void {
    if (!this.renderLoopActive) {
      return
    }
    this.renderLoopActive = false
    if (this.renderLoopHandle) {
      clearTimeout(this.renderLoopHandle)
      this.renderLoopHandle = null
    }
  }

  /**
   * 根据视频帧率更新渲染间隔
   */
  updateFps(fps: number | null): void {
    // return;
    console.log(`[RenderManager] 📹 Video FPS: ${fps?.toFixed(2)}`)
    this.currentVideoFps = fps
    
    if (fps && fps > 0.1) {
      // 根据视频帧率计算基础渲染间隔：1000ms / fps
      // 限制范围：最小 16ms (60fps)，最大 42ms (24fps)
      const calculatedInterval = Math.round(1000 / fps)
      this.baseRenderInterval = Math.max(16, Math.min(calculatedInterval, 42))
      this.currentRenderInterval = this.baseRenderInterval
      this.renderRequestCount = 0 // 重置计数
      this.lastRenderRequestTime = 0 // 重置时间戳
      console.log(`[RenderManager] 📹 Video FPS: ${fps.toFixed(2)}, Base render interval: ${this.baseRenderInterval}ms`)
    } else {
      // 帧率未知或无效，使用默认值
      this.baseRenderInterval = this.DEFAULT_RENDER_INTERVAL_MS
      this.currentRenderInterval = this.baseRenderInterval
      this.renderRequestCount = 0 // 重置计数
      this.lastRenderRequestTime = 0 // 重置时间戳
      console.log(`[RenderManager] 📹 Video FPS: unknown, using default render interval: ${this.baseRenderInterval}ms`)
    }
    
    // 如果渲染循环正在运行，需要重启以应用新的间隔
    if (this.renderLoopActive) {
      this.stop()
      this.start()
    }
  }

  /**
   * 标记 Seek 完成（需要渲染）
   */
  markSeekComplete(): void {
    this.pendingSeekRender = true
    console.log('[RenderManager] ✅ Seek completed, marked for render')
  }

  /**
   * 标记 Resize 开始（resize 过程中不渲染）
   */
  markResizeStart(): void {
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
      const currentState = this.getState()
      // 只在非播放状态时标记需要渲染（播放中由循环自动处理）
      if (currentState.phase !== 'playing') {
        this.pendingResizeRender = true
        console.log('[RenderManager] ✅ Resize stabilized, marked for render (non-playing)')
      } else {
        console.log('[RenderManager] Resize stabilized (playing), render loop will handle it')
      }
    }, 100) // 100ms 内没有新事件 = 稳定
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stop()
    if (this.resizeStableTimer) {
      clearTimeout(this.resizeStableTimer)
      this.resizeStableTimer = null
    }
    // 清除状态标记
    this.isResizing = false
    this.pendingResizeRender = false
    this.pendingSeekRender = false
  }
}
