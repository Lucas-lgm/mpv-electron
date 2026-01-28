# CorePlayer 架构优化建议

## 1. 当前问题分析

### 1.1 MPV 特定代码耦合

**问题**：`CorePlayer` 与 MPV 高度耦合，难以支持其他播放器

| 组件 | MPV 特定代码 | 影响 |
|------|------------|------|
| `CorePlayer` | 直接使用 `LibMPVController` | 无法支持 VLC |
| `CorePlayer` | 直接使用 `MPVStatus` | 状态格式绑定 MPV |
| `CorePlayer` | 硬编码 `new MpvMediaPlayer()` | 无法切换播放器 |
| `RenderManager` | 依赖 `LibMPVController` | 渲染方式绑定 MPV |
| `Timeline` | 依赖 `controller.getStatus()` | 状态获取绑定 MPV |

### 1.2 具体问题点

#### 问题 1：硬编码 MediaPlayer 实现

```typescript
// 当前代码
class CorePlayerImpl {
  private readonly mediaPlayer = new MpvMediaPlayer()  // ❌ 硬编码
  
  constructor() {
    // ...
  }
}
```

**问题**：无法切换不同的播放器实现

#### 问题 2：直接使用 LibMPVController

```typescript
// 当前代码
class CorePlayerImpl {
  private controller: LibMPVController | null = null  // ❌ MPV 特定
  
  constructor() {
    if (isLibMPVAvailable()) {
      this.controller = new LibMPVController()  // ❌ 硬编码
    }
  }
}
```

**问题**：VLC 或其他播放器没有 LibMPVController

#### 问题 3：状态管理绑定 MPV

```typescript
// 当前代码
updateFromMPVStatus(status: MPVStatus) {  // ❌ MPV 特定类型
  // ...
}

getStatus() {
  return this.controller?.getStatus() || null  // ❌ 依赖 MPV controller
}
```

**问题**：状态格式绑定 MPV，其他播放器状态格式不同

#### 问题 4：渲染管理绑定 MPV

```typescript
// RenderManager
class RenderManager {
  private controller: LibMPVController | null = null  // ❌ MPV 特定
  
  requestRender() {
    this.controller?.requestRender()  // ❌ MPV 特定方法
  }
}
```

**问题**：VLC 的渲染方式可能完全不同

## 2. 优化方案

### 2.1 方案概述

**核心思路**：抽象播放器特定功能，使 `CorePlayer` 成为通用桥接层

```
CorePlayer (通用桥接层)
    ├── MediaPlayer (播放器抽象) ✅ 已有
    ├── PlayerController (控制器抽象) ❌ 需要新增
    ├── RenderAdapter (渲染适配器抽象) ❌ 需要新增
    └── StatusAdapter (状态适配器抽象) ❌ 需要新增
```

### 2.2 优化点优先级

#### 高优先级（必须优化）

1. **MediaPlayer 依赖注入**
   - 当前：硬编码 `new MpvMediaPlayer()`
   - 优化：通过构造函数注入或工厂模式

2. **状态管理抽象**
   - 当前：直接使用 `MPVStatus`
   - 优化：定义通用状态接口，通过适配器转换

#### 中优先级（建议优化）

3. **控制器抽象**
   - 当前：直接使用 `LibMPVController`
   - 优化：定义控制器接口，MPV 和 VLC 分别实现

4. **渲染管理抽象**
   - 当前：`RenderManager` 依赖 `LibMPVController`
   - 优化：定义渲染接口，通过适配器适配不同播放器

#### 低优先级（可选优化）

5. **Timeline 抽象**
   - 当前：依赖 `controller.getStatus()`
   - 优化：通过状态适配器获取状态

## 3. 详细优化方案

### 3.1 优化 1：MediaPlayer 依赖注入（高优先级）

**当前代码**：
```typescript
class CorePlayerImpl {
  private readonly mediaPlayer = new MpvMediaPlayer()  // ❌
  
  constructor() {
    // ...
  }
}
```

**优化方案**：
```typescript
class CorePlayerImpl {
  private mediaPlayer: MediaPlayer  // ✅ 使用接口
  
  constructor(mediaPlayer?: MediaPlayer) {
    // 支持依赖注入，默认使用 MpvMediaPlayer
    this.mediaPlayer = mediaPlayer || new MpvMediaPlayer()
    // ...
  }
  
  // 新增：支持运行时切换播放器
  setMediaPlayer(player: MediaPlayer): void {
    this.mediaPlayer = player
  }
}

// 工厂函数
export function createCorePlayer(type: 'mpv' | 'vlc' = 'mpv'): CorePlayer {
  const mediaPlayer = type === 'mpv' 
    ? new MpvMediaPlayer() 
    : new VlcMediaPlayer()  // 未来实现
  return new CorePlayerImpl(mediaPlayer)
}
```

**优点**：
- ✅ 支持依赖注入
- ✅ 可以切换播放器
- ✅ 易于测试（可以注入 mock）

**实施难度**：低

### 3.2 优化 2：状态管理抽象（高优先级）

**当前代码**：
```typescript
updateFromMPVStatus(status: MPVStatus) {  // ❌ MPV 特定
  this.stateMachine.updateFromStatus(status)
}

getStatus() {
  return this.controller?.getStatus() || null  // ❌ 依赖 MPV
}
```

**优化方案**：

**步骤 1：定义通用状态接口**
```typescript
// application/core/PlayerStatus.ts
export interface PlayerStatus {
  currentTime: number
  duration: number
  isPaused: boolean
  isSeeking: boolean
  volume: number
  // ... 其他通用字段
}
```

**步骤 2：在 MediaPlayer 接口中添加状态获取**
```typescript
interface MediaPlayer {
  // ... 现有方法
  
  // 新增：获取播放器状态
  getStatus(): PlayerStatus | null
}
```

**步骤 3：修改 CorePlayer**
```typescript
class CorePlayerImpl {
  updateFromPlayerStatus(status: PlayerStatus | null) {  // ✅ 通用接口
    if (status) {
      this.stateMachine.updateFromStatus(status)
    }
  }
  
  getStatus(): PlayerStatus | null {
    return this.mediaPlayer.getStatus()  // ✅ 通过 MediaPlayer 获取
  }
}
```

**步骤 4：MpvMediaPlayer 实现**
```typescript
class MpvMediaPlayer {
  getStatus(): PlayerStatus | null {
    if (!this.controller) return null
    const mpvStatus = this.controller.getStatus()
    return this.adaptMPVStatusToPlayerStatus(mpvStatus)  // 适配
  }
  
  private adaptMPVStatusToPlayerStatus(mpv: MPVStatus): PlayerStatus {
    return {
      currentTime: mpv.time ?? 0,
      duration: mpv.duration ?? 0,
      isPaused: mpv.pause ?? false,
      // ... 适配逻辑
    }
  }
}
```

**优点**：
- ✅ 状态格式通用化
- ✅ 不依赖 MPV 特定类型
- ✅ 易于支持其他播放器

**实施难度**：中

### 3.3 优化 3：控制器抽象（中优先级）

**当前代码**：
```typescript
class CorePlayerImpl {
  private controller: LibMPVController | null = null  // ❌
  
  constructor() {
    if (isLibMPVAvailable()) {
      this.controller = new LibMPVController()  // ❌
    }
  }
}
```

**优化方案**：

**步骤 1：定义控制器接口**
```typescript
// application/core/PlayerController.ts
export interface PlayerController {
  initialize(windowId?: number): Promise<void>
  setWindowId(windowId: number): Promise<void>
  setWindowSize(width: number, height: number): Promise<void>
  requestRender(): void
  getStatus(): PlayerStatus | null
  sendKey(key: string): Promise<void>
  setHdrEnabled(enabled: boolean): void
  on(event: string, listener: Function): void
  off(event: string, listener: Function): void
  cleanup(): Promise<void>
}
```

**步骤 2：LibMPVController 适配**
```typescript
class LibMPVControllerAdapter implements PlayerController {
  constructor(private controller: LibMPVController) {}
  
  getStatus(): PlayerStatus | null {
    const mpvStatus = this.controller.getStatus()
    return adaptMPVStatusToPlayerStatus(mpvStatus)
  }
  
  // ... 其他方法适配
}
```

**步骤 3：修改 CorePlayer**
```typescript
class CorePlayerImpl {
  private controller: PlayerController | null = null  // ✅ 使用接口
  
  constructor(mediaPlayer: MediaPlayer, controller?: PlayerController) {
    this.mediaPlayer = mediaPlayer
    // 如果 MediaPlayer 是 MpvMediaPlayer，创建 MPV controller
    if (mediaPlayer instanceof MpvMediaPlayer && !controller) {
      this.controller = new LibMPVControllerAdapter(new LibMPVController())
    } else {
      this.controller = controller
    }
  }
}
```

**优点**：
- ✅ 控制器抽象化
- ✅ 可以支持不同的控制器实现

**缺点**：
- ⚠️ 实施复杂度较高
- ⚠️ 可能过度设计（如果只有 MPV）

**实施难度**：高

### 3.4 优化 4：渲染管理抽象（中优先级）

**当前代码**：
```typescript
class RenderManager {
  private controller: LibMPVController | null = null  // ❌
  
  requestRender() {
    this.controller?.requestRender()  // ❌
  }
}
```

**优化方案**：

**步骤 1：定义渲染接口**
```typescript
// application/core/RenderAdapter.ts
export interface RenderAdapter {
  requestRender(): void
  updateFps(fps: number | null): void
  cleanup(): void
}
```

**步骤 2：MPV 渲染适配器**
```typescript
class MPVRenderAdapter implements RenderAdapter {
  constructor(private controller: LibMPVController) {}
  
  requestRender() {
    this.controller.requestRender()
  }
  
  // ...
}
```

**步骤 3：修改 RenderManager**
```typescript
class RenderManager {
  private renderAdapter: RenderAdapter | null = null  // ✅
  
  constructor(renderAdapter: RenderAdapter | null, getState: () => PlayerState) {
    this.renderAdapter = renderAdapter
    this.getState = getState
  }
  
  requestRender() {
    this.renderAdapter?.requestRender()  // ✅
  }
}
```

**优点**：
- ✅ 渲染方式抽象化
- ✅ 可以支持不同的渲染实现

**缺点**：
- ⚠️ VLC 可能不需要 JS 驱动的渲染
- ⚠️ 可能过度设计

**实施难度**：中

## 4. 推荐优化路径

### 阶段 1：基础抽象（必须）

**目标**：使 CorePlayer 可以切换不同的 MediaPlayer 实现

**任务**：
1. ✅ MediaPlayer 依赖注入
2. ✅ 状态管理抽象（在 MediaPlayer 接口中添加 getStatus）

**时间**：1-2 天

**收益**：
- ✅ 可以支持 VLC（只需实现 VlcMediaPlayer）
- ✅ 易于测试

### 阶段 2：深度抽象（可选）

**目标**：完全抽象播放器特定功能

**任务**：
1. ⚠️ 控制器抽象（如果 VLC 需要）
2. ⚠️ 渲染管理抽象（如果 VLC 需要）

**时间**：3-5 天

**收益**：
- ✅ 完全解耦
- ⚠️ 可能过度设计

**建议**：
- 等实际需要支持 VLC 时再实施
- 先实现阶段 1，根据 VLC 的实际需求决定是否需要阶段 2

## 5. 实施建议

### 5.1 立即实施（阶段 1）

1. **MediaPlayer 依赖注入**
   - 修改 `CorePlayerImpl` 构造函数，支持注入 `MediaPlayer`
   - 添加 `setMediaPlayer()` 方法
   - 更新工厂函数

2. **状态管理抽象**
   - 在 `MediaPlayer` 接口中添加 `getStatus(): PlayerStatus | null`
   - 实现 `MpvMediaPlayer.getStatus()`
   - 修改 `CorePlayer` 使用 `mediaPlayer.getStatus()`

### 5.2 未来实施（阶段 2）

**等实际需要支持 VLC 时**：
1. 分析 VLC 的 API 和需求
2. 决定是否需要控制器抽象
3. 决定是否需要渲染管理抽象
4. 按需实施

### 5.3 不推荐立即实施

- ❌ 控制器抽象（可能过度设计）
- ❌ 渲染管理抽象（VLC 可能不需要）
- ❌ Timeline 抽象（当前实现已经足够）

## 6. 总结

### 6.1 必须优化的点

1. **MediaPlayer 依赖注入** - 支持切换播放器
2. **状态管理抽象** - 通用化状态格式

### 6.2 可选优化的点

3. **控制器抽象** - 等 VLC 需求明确后再决定
4. **渲染管理抽象** - 等 VLC 需求明确后再决定

### 6.3 优化原则

- ✅ **渐进式优化**：先做必须的，等实际需求再深入
- ✅ **避免过度设计**：不要为了抽象而抽象
- ✅ **保持简单**：当前架构已经足够好，只需做必要的抽象
