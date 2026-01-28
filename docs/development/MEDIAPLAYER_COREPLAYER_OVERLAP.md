# MediaPlayer 与 CorePlayer 职责重叠分析

## 1. 接口对比

### MediaPlayer 接口方法

```typescript
interface MediaPlayer {
  // 播放控制
  play(media: Media): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  
  // 会话管理
  getCurrentSession(): PlaybackSession | null
  onSessionChange(listener: (session: PlaybackSession) => void): void
  offSessionChange(listener: (session: PlaybackSession) => void): void
  
  // 生命周期
  cleanup(): Promise<void>
}
```

### CorePlayer 接口方法

```typescript
interface CorePlayer {
  // 窗口管理（独有）
  setVideoWindow(window: BrowserWindow | null): Promise<void>
  ensureControllerReadyForPlayback(): Promise<void>
  
  // 播放控制（与 MediaPlayer 重叠）
  play(media: Media): Promise<void>          ✅ 重叠
  pause(): Promise<void>                      ✅ 重叠
  resume(): Promise<void>                     ✅ 重叠
  stop(): Promise<void>                       ✅ 重叠
  seek(time: number): Promise<void>           ✅ 重叠
  setVolume(volume: number): Promise<void>   ✅ 重叠
  getCurrentSession(): PlaybackSession | null ✅ 重叠
  cleanup(): Promise<void>                    ✅ 重叠
  
  // 状态管理（独有）
  getPlayerState(): PlayerState
  resetState(): void
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  
  // 其他功能（独有）
  sendKey(key: string): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
  setHdrEnabled(enabled: boolean): void
  getMediaPlayer(): MediaPlayer
}
```

## 2. 重叠分析

### 2.1 重叠的方法（8 个）

| 方法 | MediaPlayer | CorePlayer | 重叠度 |
|------|------------|-----------|--------|
| `play()` | ✅ | ✅ | 100% |
| `pause()` | ✅ | ✅ | 100% |
| `resume()` | ✅ | ✅ | 100% |
| `stop()` | ✅ | ✅ | 100% |
| `seek()` | ✅ | ✅ | 100% |
| `setVolume()` | ✅ | ✅ | 100% |
| `getCurrentSession()` | ✅ | ✅ | 100% |
| `cleanup()` | ✅ | ✅ | 100% |

**重叠率**：8/8 = 100% 的播放控制方法都重叠

### 2.2 实现方式

**CorePlayer 的实现**：所有重叠方法都是简单委托给 `mediaPlayer`

```typescript
// CorePlayerImpl
async pause(): Promise<void> {
  if (this.controller) await this.mediaPlayer.pause()
}

async resume(): Promise<void> {
  if (this.controller) await this.mediaPlayer.resume()
}

async seek(time: number): Promise<void> {
  if (!this.controller) return
  this.timeline?.markSeek(time)
  await this.mediaPlayer.seek(time)
  // ... 额外的状态同步逻辑
}

getCurrentSession(): PlaybackSession | null {
  return this.mediaPlayer.getCurrentSession()
}
```

**观察**：
- 大部分方法只是简单委托（`pause`, `resume`, `stop`, `getCurrentSession`）
- 部分方法有额外逻辑（`seek` 有 timeline 同步，`play` 有窗口准备）

## 3. 职责分析

### 3.1 MediaPlayer 的职责

**定位**：播放契约接口（基础设施层）

**职责**：
- 定义播放器的标准接口
- 提供播放控制的基本操作
- 管理播放会话（PlaybackSession）
- 不涉及窗口、渲染、状态机等

**实现**：`MpvMediaPlayer`（基础设施层）

### 3.2 CorePlayer 的职责

**定位**：MPV 桥接层（应用层）

**职责**：
- MPV 控制器管理（LibMPVController）
- 窗口管理（setVideoWindow）
- 渲染管理（RenderManager）
- 状态管理（PlayerStateMachine）
- 时间轴管理（Timeline）
- **播放控制委托**（委托给 MediaPlayer）

**实现**：`CorePlayerImpl`（应用层）

## 4. 问题分析

### 4.1 职责重叠问题

**问题 1：接口重复**
- `CorePlayer` 接口包含了 `MediaPlayer` 的所有播放控制方法
- 这导致接口定义重复，维护成本高

**问题 2：简单委托**
- 大部分方法只是简单委托，没有额外价值
- 增加了调用链长度，但没有增加功能

**问题 3：职责不清**
- 不清楚什么时候应该用 `MediaPlayer`，什么时候用 `CorePlayer`
- 实际上，外部只应该用 `CorePlayer`，`MediaPlayer` 是内部实现细节

### 4.2 当前架构

```
VideoPlayerApp
    └── CorePlayer (应用层)
            ├── MediaPlayer (接口)
            │   └── MpvMediaPlayer (基础设施层实现)
            ├── LibMPVController
            ├── PlayerStateMachine
            ├── Timeline
            └── RenderManager
```

**问题**：
- `CorePlayer` 暴露了 `MediaPlayer` 的所有方法，形成"胖接口"
- `MediaPlayer` 作为接口，但外部不应该直接使用（应该通过 `CorePlayer`）

## 5. 解决方案

### 方案 1：CorePlayer 继承 MediaPlayer（推荐）

**思路**：让 `CorePlayer` 继承 `MediaPlayer`，减少接口重复

```typescript
export interface CorePlayer extends MediaPlayer {
  // 窗口管理
  setVideoWindow(window: BrowserWindow | null): Promise<void>
  ensureControllerReadyForPlayback(): Promise<void>
  
  // 状态管理（独有）
  getPlayerState(): PlayerState
  resetState(): void
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  
  // 其他功能（独有）
  sendKey(key: string): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
  setHdrEnabled(enabled: boolean): void
  
  // 移除 getMediaPlayer()，因为不再需要
}
```

**优点**：
- ✅ 减少接口重复
- ✅ 明确继承关系：CorePlayer 是 MediaPlayer 的扩展
- ✅ 符合 Liskov 替换原则：CorePlayer 可以替换 MediaPlayer

**缺点**：
- ⚠️ 需要移除 `getMediaPlayer()` 方法（如果不再需要）

### 方案 2：保持现状，但明确文档

**思路**：保持当前架构，但明确职责边界

**文档化**：
- `MediaPlayer`：播放契约接口，供基础设施层实现
- `CorePlayer`：MPV 桥接层，扩展 MediaPlayer 功能（窗口、渲染、状态）
- 外部只使用 `CorePlayer`，`MediaPlayer` 是内部实现细节

**优点**：
- ✅ 不需要修改代码
- ✅ 保持灵活性

**缺点**：
- ❌ 接口重复仍然存在
- ❌ 维护成本高

### 方案 3：移除 MediaPlayer 接口，直接使用 CorePlayer

**思路**：如果 `MediaPlayer` 只在内部使用，可以考虑移除接口，直接使用 `CorePlayer`

**问题**：
- ❌ 违反依赖倒置原则
- ❌ 难以测试和替换实现
- ❌ 不推荐

## 6. 推荐方案

**推荐方案 1：CorePlayer 继承 MediaPlayer**

**理由**：
1. **减少重复**：接口定义不再重复
2. **明确关系**：CorePlayer 是 MediaPlayer 的扩展，关系清晰
3. **符合原则**：符合面向对象设计原则
4. **易于维护**：接口变更只需在一个地方修改

**实施步骤**：
1. 修改 `CorePlayer` 接口，继承 `MediaPlayer`
2. 从 `CorePlayer` 接口中移除重叠的方法定义
3. 移除 `getMediaPlayer()` 方法（如果不再需要）
4. 更新所有使用 `getMediaPlayer()` 的地方

## 7. 重叠方法的价值评估

### 有额外价值的重叠方法

| 方法 | CorePlayer 额外逻辑 | 价值 |
|------|-------------------|------|
| `play()` | 窗口准备、状态重置 | ✅ 有价值 |
| `seek()` | Timeline 同步、状态更新 | ✅ 有价值 |
| `setVolume()` | 状态同步 | ⚠️ 少量价值 |

### 简单委托的方法

| 方法 | CorePlayer 逻辑 | 价值 |
|------|---------------|------|
| `pause()` | 简单委托 | ❌ 无额外价值 |
| `resume()` | 简单委托 | ❌ 无额外价值 |
| `stop()` | 简单委托 | ❌ 无额外价值 |
| `getCurrentSession()` | 简单委托 | ❌ 无额外价值 |
| `cleanup()` | 简单委托 | ❌ 无额外价值 |

**结论**：大部分重叠方法只是简单委托，没有额外价值。但通过继承可以统一接口，减少维护成本。
