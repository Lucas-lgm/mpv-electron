# MediaPlayer 与 CorePlayer 职责重叠分析（考虑多播放器支持）

## 1. 未来需求：支持 VLC

### 1.1 场景分析

**当前架构**：
- `MediaPlayer`：播放器抽象接口
- `MpvMediaPlayer`：MPV 实现
- `CorePlayer`：MPV 特定的桥接层

**未来需求**：
- 支持 VLC 播放器
- 可能需要支持其他播放器（如 FFmpeg、GStreamer 等）

### 1.2 多播放器支持方案

#### 方案 A：每个播放器一个 CorePlayer

```
MediaPlayer (接口)
├── MpvMediaPlayer (MPV 实现)
└── VlcMediaPlayer (VLC 实现)

CorePlayer (MPV 特定)
└── 使用 MpvMediaPlayer

VlcCorePlayer (VLC 特定)
└── 使用 VlcMediaPlayer
```

**问题**：
- ❌ 代码重复：每个 CorePlayer 都需要实现窗口、渲染、状态管理等
- ❌ 维护成本高：多个 CorePlayer 实现

#### 方案 B：通用 CorePlayer + 播放器适配器

```
MediaPlayer (接口)
├── MpvMediaPlayer (MPV 实现)
└── VlcMediaPlayer (VLC 实现)

CorePlayer (通用桥接层)
├── 使用 MediaPlayer (可以是 MpvMediaPlayer 或 VlcMediaPlayer)
├── 通用功能：窗口管理、状态管理、时间轴
└── 播放器特定功能：通过 MediaPlayer 接口抽象
```

**优点**：
- ✅ 代码复用：通用功能只需实现一次
- ✅ 易于扩展：新增播放器只需实现 MediaPlayer 接口
- ✅ 职责清晰：CorePlayer 是通用桥接层

**缺点**：
- ⚠️ 需要抽象播放器特定功能（如渲染方式）

## 2. 当前架构分析

### 2.1 CorePlayer 的 MPV 耦合度

**高度耦合的部分**：
- `LibMPVController`：MPV 特定的控制器
- `RenderManager`：MPV 特定的渲染管理
- `PlayerStateMachine`：从 MPV 状态推导（可能通用）
- `Timeline`：通用，但依赖 `getStatus()` 方法

**可抽象的部分**：
- 播放控制：通过 `MediaPlayer` 接口
- 状态管理：可以通用化
- 窗口管理：通用

### 2.2 接口重叠的价值

**当前重叠**：
- `CorePlayer` 包含 `MediaPlayer` 的所有播放控制方法
- 大部分是简单委托

**如果支持多播放器**：
- `MediaPlayer` 接口作为播放器抽象，**必须保留**
- `CorePlayer` 作为通用桥接层，**应该使用 MediaPlayer，而不是继承**

## 3. 推荐架构（支持多播放器）

### 3.1 架构设计

```
┌─────────────────────────────────────────┐
│         VideoPlayerApp                  │
│  (应用层协调器)                          │
└──────────────┬──────────────────────────┘
               │
               │ 使用
               ▼
┌─────────────────────────────────────────┐
│         CorePlayer                      │
│  (通用播放器桥接层)                      │
│  - 窗口管理                              │
│  - 状态管理 (PlayerStateMachine)        │
│  - 时间轴 (Timeline)                    │
│  - 渲染管理 (RenderManager)             │
└──────────────┬──────────────────────────┘
               │
               │ 使用
               ▼
┌─────────────────────────────────────────┐
│         MediaPlayer (接口)               │
│  (播放器抽象)                             │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌──────────────┐  ┌──────────────┐
│MpvMediaPlayer│  │VlcMediaPlayer│
│  (MPV实现)   │  │  (VLC实现)   │
└──────────────┘  └──────────────┘
```

### 3.2 接口设计

#### MediaPlayer 接口（保持不变）

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

#### CorePlayer 接口（不继承 MediaPlayer）

```typescript
interface CorePlayer {
  // 窗口管理
  setVideoWindow(window: BrowserWindow | null): Promise<void>
  ensureControllerReadyForPlayback(): Promise<void>
  
  // 播放控制（委托给 MediaPlayer，但保留接口）
  play(media: Media): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seek(time: number): Promise<void>
  setVolume(volume: number): Promise<void>
  getCurrentSession(): PlaybackSession | null
  
  // 状态管理（通用）
  getPlayerState(): PlayerState
  resetState(): void
  onPlayerState(listener: (state: PlayerState) => void): void
  offPlayerState(listener: (state: PlayerState) => void): void
  
  // 其他功能
  sendKey(key: string): Promise<void>
  debugVideoState(): Promise<void>
  debugHdrStatus(): Promise<void>
  setHdrEnabled(enabled: boolean): void
  cleanup(): Promise<void>
  
  // 播放器管理
  getMediaPlayer(): MediaPlayer  // 保留，用于获取当前播放器
  setMediaPlayer(player: MediaPlayer): void  // 新增，用于切换播放器
}
```

### 3.3 为什么 CorePlayer 不继承 MediaPlayer？

**理由**：
1. **职责不同**：
   - `MediaPlayer`：播放器抽象，定义播放契约
   - `CorePlayer`：通用桥接层，包含窗口、渲染、状态管理等

2. **组合优于继承**：
   - `CorePlayer` **使用** `MediaPlayer`（组合）
   - 而不是 **是** `MediaPlayer`（继承）

3. **灵活性**：
   - 可以切换不同的 `MediaPlayer` 实现
   - 可以同时支持多个播放器（虽然当前不需要）

4. **未来扩展**：
   - 如果 VLC 的 API 与 MPV 差异很大，可以通过不同的 `MediaPlayer` 实现适配
   - `CorePlayer` 的通用功能（窗口、状态、时间轴）可以复用

## 4. 重叠接口的处理

### 4.1 当前重叠是必要的

**重叠的方法**：
- `play()`, `pause()`, `resume()`, `stop()`, `seek()`, `setVolume()`, `getCurrentSession()`

**为什么需要重叠**：
1. **统一接口**：`VideoPlayerApp` 只需要知道 `CorePlayer`，不需要知道 `MediaPlayer`
2. **扩展功能**：`CorePlayer` 可以在委托前/后添加额外逻辑（如状态同步、Timeline 更新）
3. **未来兼容**：如果切换播放器，`VideoPlayerApp` 不需要修改

### 4.2 重叠的价值

| 方法 | 简单委托 | 有额外逻辑 | 价值 |
|------|---------|-----------|------|
| `play()` | ❌ | ✅ 窗口准备、状态重置 | ✅ 有价值 |
| `pause()` | ✅ | ❌ | ⚠️ 统一接口 |
| `resume()` | ✅ | ❌ | ⚠️ 统一接口 |
| `stop()` | ✅ | ❌ | ⚠️ 统一接口 |
| `seek()` | ❌ | ✅ Timeline 同步 | ✅ 有价值 |
| `setVolume()` | ❌ | ✅ 状态同步 | ✅ 有价值 |
| `getCurrentSession()` | ✅ | ❌ | ⚠️ 统一接口 |
| `cleanup()` | ❌ | ✅ 清理渲染、Timeline | ✅ 有价值 |

**结论**：
- 即使简单委托的方法也有价值：**统一接口，隐藏实现细节**
- 这是**适配器模式**的体现：`CorePlayer` 适配 `MediaPlayer` 给上层使用

## 5. 支持 VLC 的实施路径

### 5.1 阶段 1：保持当前架构

**当前状态**：
- `CorePlayer` 使用 `MpvMediaPlayer`
- 接口重叠存在，但这是必要的

**不需要修改**：
- 保持 `CorePlayer` 不继承 `MediaPlayer`
- 保持接口重叠（这是适配器模式的体现）

### 5.2 阶段 2：抽象播放器特定功能

**需要抽象的部分**：
1. **渲染方式**：
   - MPV：使用 `LibMPVController` 和 `RenderManager`
   - VLC：可能需要不同的渲染方式

2. **状态获取**：
   - MPV：通过 `controller.getStatus()`
   - VLC：通过 VLC API

3. **窗口绑定**：
   - MPV：使用 `setWindowId()`
   - VLC：使用 VLC 的窗口绑定方式

**抽象方案**：
```typescript
interface MediaPlayer {
  // ... 现有方法
  
  // 新增：播放器特定功能抽象
  getStatus(): PlayerStatus | null  // 统一状态接口
  setWindowId(windowId: number): void  // 统一窗口绑定
  getRenderMode(): 'js-driven' | 'native' | 'none'  // 渲染模式
}
```

### 5.3 阶段 3：实现 VLC 支持

1. **实现 `VlcMediaPlayer`**：
   ```typescript
   class VlcMediaPlayer implements MediaPlayer {
     // 实现所有 MediaPlayer 接口方法
     // 使用 VLC API
   }
   ```

2. **修改 `CorePlayer`**：
   ```typescript
   class CorePlayerImpl {
     private mediaPlayer: MediaPlayer  // 可以是 MpvMediaPlayer 或 VlcMediaPlayer
     
     setMediaPlayer(player: MediaPlayer) {
       this.mediaPlayer = player
     }
   }
   ```

3. **工厂模式选择播放器**：
   ```typescript
   function createCorePlayer(type: 'mpv' | 'vlc'): CorePlayer {
     const player = type === 'mpv' 
       ? new MpvMediaPlayer() 
       : new VlcMediaPlayer()
     return new CorePlayerImpl(player)
   }
   ```

## 6. 结论

### 6.1 当前重叠是合理的

**原因**：
1. **适配器模式**：`CorePlayer` 适配 `MediaPlayer` 给上层使用
2. **统一接口**：`VideoPlayerApp` 只需要知道 `CorePlayer`
3. **扩展能力**：可以在委托前后添加额外逻辑

### 6.2 不建议 CorePlayer 继承 MediaPlayer

**原因**：
1. **职责不同**：`CorePlayer` 是桥接层，`MediaPlayer` 是播放器抽象
2. **组合优于继承**：`CorePlayer` 使用 `MediaPlayer`，而不是是 `MediaPlayer`
3. **未来扩展**：支持 VLC 时，可以切换不同的 `MediaPlayer` 实现

### 6.3 支持 VLC 的路径

1. **保持当前架构**：接口重叠是必要的，不需要修改
2. **抽象播放器特定功能**：在 `MediaPlayer` 接口中添加统一的方法
3. **实现 VLC 支持**：创建 `VlcMediaPlayer`，通过工厂模式选择

### 6.4 最终建议

**保持现状**：
- ✅ `CorePlayer` 不继承 `MediaPlayer`
- ✅ 接口重叠是必要的（适配器模式）
- ✅ 当前架构已经为支持多播放器做好了准备

**未来扩展**：
- 当需要支持 VLC 时，只需：
  1. 实现 `VlcMediaPlayer`
  2. 在 `CorePlayer` 中添加 `setMediaPlayer()` 方法
  3. 通过工厂模式选择播放器
