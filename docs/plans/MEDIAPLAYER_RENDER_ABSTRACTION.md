# MediaPlayer 渲染能力抽象方案

## 1. 当前问题

### 1.1 RenderManager 对 Controller 的依赖

**RenderManager 使用的 Controller 方法**：
1. `controller.requestRender()` - 请求渲染（第145行）
2. `controller.getJsDrivenRenderMode()` - 获取渲染模式（第169行）
3. `controller.on('fps-change', ...)` - 监听 FPS 变化（通过 CorePlayer 监听）

**CorePlayer 使用的 Controller 方法**：
1. `controller.getStatus()` - 获取状态（多处）
2. `controller.getJsDrivenRenderMode()` - 获取渲染模式（第98行）
3. `controller.on('fps-change', ...)` - 监听 FPS 变化（第113行）

### 1.2 问题

- `RenderManager` 直接依赖 `LibMPVController`（MPV 特定）
- `CorePlayer` 直接使用 `controller`（MPV 特定）
- 无法支持 VLC（VLC 没有 `LibMPVController`）

## 2. 解决方案：在 MediaPlayer 接口中抽象渲染能力

### 2.1 核心思路

**不抽象 Controller**，而是在 `MediaPlayer` 接口中添加渲染相关的方法：
- `requestRender()` - 请求渲染
- `getRenderMode()` - 获取渲染模式
- `onFpsChange()` - 监听 FPS 变化

这样 `RenderManager` 和 `CorePlayer` 都通过 `MediaPlayer` 接口访问，不直接依赖 `LibMPVController`。

### 2.2 MediaPlayer 接口扩展

```typescript
export interface MediaPlayer extends EventEmitter {
  // 现有方法
  play(media: Media): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  getCurrentSession(): PlaybackSession | null
  onSessionChange(listener: (session: PlaybackSession) => void): void
  offSessionChange(listener: (session: PlaybackSession) => void): void
  cleanup(): Promise<void>
  
  // 新增：渲染能力
  /**
   * 请求渲染一帧
   * 对于需要 JS 驱动渲染的播放器（如 MPV），调用此方法触发渲染
   * 对于原生渲染的播放器（如 VLC），此方法可能为空操作
   */
  requestRender(): void
  
  /**
   * 获取渲染模式
   * @returns 'js-driven' | 'native' | 'none'
   *   - 'js-driven': 需要 JS 驱动渲染（如 MPV gpu-next）
   *   - 'native': 原生渲染（如 VLC）
   *   - 'none': 不支持渲染
   */
  getRenderMode(): 'js-driven' | 'native' | 'none'
  
  /**
   * 监听视频帧率变化
   * @param listener 帧率变化回调，参数为 fps (number | null)
   */
  onFpsChange(listener: (fps: number | null) => void): void
  
  /**
   * 移除 FPS 变化监听
   */
  offFpsChange(listener: (fps: number | null) => void): void
  
  // 新增：状态获取（已在优化计划中）
  /**
   * 获取播放器状态
   * @returns 通用播放器状态，如果未初始化则返回 null
   */
  getStatus(): PlayerStatus | null
}
```

### 2.3 MpvMediaPlayer 实现

```typescript
class MpvMediaPlayer implements MediaPlayer {
  private controller: LibMPVController | null = null
  private fpsChangeListeners: Set<(fps: number | null) => void> = new Set()
  
  // 渲染能力实现
  requestRender(): void {
    this.controller?.requestRender()
  }
  
  getRenderMode(): 'js-driven' | 'native' | 'none' {
    if (!this.controller) return 'none'
    // MPV 在 macOS 上使用 JS 驱动渲染
    if (process.platform === 'darwin' && this.controller.getJsDrivenRenderMode()) {
      return 'js-driven'
    }
    return 'native'
  }
  
  onFpsChange(listener: (fps: number | null) => void): void {
    this.fpsChangeListeners.add(listener)
    if (this.controller && this.fpsChangeListeners.size === 1) {
      // 第一个监听器，注册到 controller
      this.controller.on('fps-change', this.handleFpsChange)
    }
  }
  
  offFpsChange(listener: (fps: number | null) => void): void {
    this.fpsChangeListeners.delete(listener)
    if (this.fpsChangeListeners.size === 0 && this.controller) {
      // 最后一个监听器，移除
      this.controller.off('fps-change', this.handleFpsChange)
    }
  }
  
  private handleFpsChange = (fps: number | null) => {
    this.fpsChangeListeners.forEach(listener => listener(fps))
  }
  
  getStatus(): PlayerStatus | null {
    if (!this.controller) return null
    const mpvStatus = this.controller.getStatus()
    return this.adaptMPVStatusToPlayerStatus(mpvStatus)
  }
}
```

### 2.4 RenderManager 修改

```typescript
// 修改前
class RenderManager {
  private controller: LibMPVController | null = null  // ❌ MPV 特定
  
  constructor(controller: LibMPVController | null, getState: () => PlayerState) {
    this.controller = controller
  }
  
  requestRender() {
    this.controller?.requestRender()  // ❌
  }
  
  start() {
    if (this.controller && process.platform === 'darwin') {
      const isJsDriven = this.controller.getJsDrivenRenderMode()  // ❌
      if (isJsDriven) {
        // ...
      }
    }
  }
}

// 修改后
class RenderManager {
  private mediaPlayer: MediaPlayer | null = null  // ✅ 使用接口
  
  constructor(mediaPlayer: MediaPlayer | null, getState: () => PlayerState) {
    this.mediaPlayer = mediaPlayer
  }
  
  requestRender() {
    this.mediaPlayer?.requestRender()  // ✅
  }
  
  start() {
    if (this.mediaPlayer) {
      const renderMode = this.mediaPlayer.getRenderMode()  // ✅
      if (renderMode === 'js-driven') {
        // ...
      }
    }
  }
  
  setMediaPlayer(mediaPlayer: MediaPlayer | null): void {
    this.mediaPlayer = mediaPlayer
  }
}
```

### 2.5 CorePlayer 修改

```typescript
class CorePlayerImpl {
  private mediaPlayer: MediaPlayer
  private renderManager: RenderManager | null = null
  
  constructor(mediaPlayer?: MediaPlayer) {
    this.mediaPlayer = mediaPlayer || new MpvMediaPlayer()
    
    // RenderManager 使用 MediaPlayer
    this.renderManager = new RenderManager(
      this.mediaPlayer,  // ✅ 传递 MediaPlayer
      () => this.stateMachine.getState()
    )
    
    // 监听 FPS 变化
    this.mediaPlayer.onFpsChange((fps: number | null) => {
      this.renderManager?.updateFps(fps)
    })
  }
  
  // 移除 controller 相关代码
  // private controller: LibMPVController | null = null  // ❌ 删除
  
  // 使用 MediaPlayer 获取状态
  getStatus(): PlayerStatus | null {
    return this.mediaPlayer.getStatus()  // ✅
  }
  
  // 检查渲染模式
  private shouldStartRenderLoop(): boolean {
    if (!this.renderManager || process.platform !== 'darwin') return false
    const renderMode = this.mediaPlayer.getRenderMode()
    return renderMode === 'js-driven' && !this.renderManager.isActive()
  }
}
```

## 3. 实施步骤

### 步骤 1：扩展 MediaPlayer 接口

1. 在 `MediaPlayer` 接口中添加渲染方法：
   - `requestRender()`
   - `getRenderMode()`
   - `onFpsChange()` / `offFpsChange()`
   - `getStatus()`（已在优化计划中）

### 步骤 2：实现 MpvMediaPlayer

1. 实现新增的渲染方法
2. 内部委托给 `LibMPVController`
3. 管理 FPS 变化监听器

### 步骤 3：修改 RenderManager

1. 将 `controller: LibMPVController` 改为 `mediaPlayer: MediaPlayer`
2. 使用 `mediaPlayer.requestRender()` 替代 `controller.requestRender()`
3. 使用 `mediaPlayer.getRenderMode()` 替代 `controller.getJsDrivenRenderMode()`

### 步骤 4：修改 CorePlayer

1. 移除 `controller` 字段
2. 移除 controller 的创建和管理代码
3. 通过 `mediaPlayer` 访问所有功能
4. `RenderManager` 使用 `mediaPlayer` 而不是 `controller`

### 步骤 5：MpvMediaPlayer 管理 Controller

1. `MpvMediaPlayer` 负责创建和管理 `LibMPVController`
2. 移除 `setExternalController`（不再需要）
3. `MpvMediaPlayer` 在 `initialize()` 时创建 controller

## 4. 优势

### 4.1 职责清晰

- ✅ `MpvMediaPlayer` 管理 MPV 的所有资源（包括 controller）
- ✅ `CorePlayer` 只依赖 `MediaPlayer` 接口，不知道 MPV 细节
- ✅ `RenderManager` 只依赖 `MediaPlayer` 接口，可以支持任何播放器

### 4.2 易于扩展

- ✅ 支持 VLC：只需实现 `VlcMediaPlayer`，实现渲染接口
- ✅ VLC 可能返回 `'native'` 渲染模式，不需要 JS 驱动渲染
- ✅ 不需要抽象 Controller，只需要抽象 MediaPlayer 的能力

### 4.3 简化架构

- ✅ 不需要 `PlayerController` 接口
- ✅ 不需要 `RenderAdapter` 接口
- ✅ 只需要扩展 `MediaPlayer` 接口

## 5. VLC 支持示例

```typescript
class VlcMediaPlayer implements MediaPlayer {
  private vlcInstance: VlcInstance | null = null
  
  // 渲染能力实现
  requestRender(): void {
    // VLC 使用原生渲染，不需要 JS 驱动
    // 此方法可以为空操作
  }
  
  getRenderMode(): 'js-driven' | 'native' | 'none' {
    return 'native'  // VLC 使用原生渲染
  }
  
  onFpsChange(listener: (fps: number | null) => void): void {
    // VLC 的 FPS 变化监听实现
    this.vlcInstance?.on('fps-change', listener)
  }
  
  // ... 其他方法实现
}
```

## 6. 总结

### 6.1 核心思路

**不抽象 Controller**，而是**在 MediaPlayer 接口中抽象渲染能力**：
- `requestRender()` - 请求渲染
- `getRenderMode()` - 获取渲染模式
- `onFpsChange()` - 监听 FPS 变化
- `getStatus()` - 获取状态

### 6.2 优势

- ✅ 职责清晰：MediaPlayer 管理自己的资源
- ✅ 易于扩展：支持 VLC 只需实现接口
- ✅ 简化架构：不需要额外的抽象层

### 6.3 实施优先级

**高优先级**：
1. 扩展 MediaPlayer 接口
2. 实现 MpvMediaPlayer 的渲染方法
3. 修改 RenderManager 使用 MediaPlayer
4. 修改 CorePlayer 移除 controller 依赖
