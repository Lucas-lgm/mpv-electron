# VideoPlayerApp、CorePlayer、MediaPlayer 关系分析

## 当前架构关系

```
VideoPlayerApp (应用层协调器)
    ├── corePlayer: CorePlayer (MPV 桥接层)
    │       ├── mediaPlayer: MpvMediaPlayer (实现 MediaPlayer 接口)
    │       ├── controller: LibMPVController (MPV 原生绑定)
    │       ├── stateMachine: PlayerStateMachine (状态管理)
    │       ├── timeline: Timeline (时间轴)
    │       └── renderManager: RenderManager (渲染管理)
    └── mediaPlayer (通过 getter: corePlayer.getMediaPlayer())
```

## 问题分析

### 1. 职责混乱

**当前状态**：
- `VideoPlayerApp` 同时使用 `corePlayer` 和 `mediaPlayer`
- `CorePlayer` 接口定义了播放控制方法（`play`, `pause`, `resume`, `stop`, `seek`, `setVolume`）
- 但 `VideoPlayerApp` **不使用** `corePlayer` 的这些方法，而是直接调用 `mediaPlayer` 的方法

**调用关系混乱**：

| 操作 | VideoPlayerApp 实际调用 | CorePlayer 是否提供 | 问题 |
|------|----------------------|-------------------|------|
| 播放控制 | `mediaPlayer.play()` | ✅ `corePlayer.play()` | 绕过 CorePlayer |
| 暂停/恢复 | `mediaPlayer.pause/resume()` | ✅ `corePlayer.pause/resume()` | 绕过 CorePlayer |
| 停止 | `mediaPlayer.stop()` | ✅ `corePlayer.stop()` | 绕过 CorePlayer |
| 跳转 | `mediaPlayer.seek()` | ✅ `corePlayer.seek()` | 绕过 CorePlayer |
| 音量 | `mediaPlayer.setVolume()` | ✅ `corePlayer.setVolume()` | 绕过 CorePlayer |
| 窗口管理 | `corePlayer.setVideoWindow()` | ✅ | 正确 |
| 状态查询 | `corePlayer.getPlayerState()` | ✅ | 正确 |
| HDR | `corePlayer.setHdrEnabled()` | ✅ | 正确 |

### 2. 职责边界不清

**CorePlayer 的职责**（从代码看）：
- MPV 桥接（controller 管理）
- 渲染管理（RenderManager）
- 状态管理（PlayerStateMachine）
- 时间轴（Timeline）
- **播放控制**（定义了接口，但 VideoPlayerApp 不用）

**MediaPlayer 的职责**：
- 播放契约接口（MediaPlayer）
- 实际播放实现（MpvMediaPlayer）
- 播放会话管理（PlaybackSession）

**VideoPlayerApp 的职责**：
- 应用协调
- 窗口管理
- 播放列表管理
- IPC 广播
- **播放控制**（直接调用 mediaPlayer，绕过 CorePlayer）

## 问题根源

1. **CorePlayer 提供了播放控制方法，但 VideoPlayerApp 不使用**
   - `CorePlayer` 接口定义了 `play()`, `pause()`, `resume()`, `stop()`, `seek()`, `setVolume()`
   - 这些方法内部调用 `mediaPlayer` 的对应方法
   - 但 `VideoPlayerApp` 直接使用 `mediaPlayer`，绕过了 `CorePlayer`

2. **职责重叠**
   - `CorePlayer` 和 `VideoPlayerApp` 都在做播放控制
   - `CorePlayer` 的播放控制方法成了"死代码"（定义了但不用）

3. **依赖关系混乱**
   - `VideoPlayerApp` 依赖 `CorePlayer`（构造注入）
   - `VideoPlayerApp` 又通过 `corePlayer.getMediaPlayer()` 直接访问 `MediaPlayer`
   - 这违反了依赖倒置原则：应该依赖抽象（CorePlayer），而不是具体实现（MediaPlayer）

## 解决方案

### 方案 1：统一通过 CorePlayer（推荐）

**原则**：`VideoPlayerApp` 只使用 `CorePlayer`，不直接访问 `MediaPlayer`

**修改点**：
```typescript
// VideoPlayerApp.ts
// 删除这个 getter
// private get mediaPlayer() {
//   return this.corePlayer.getMediaPlayer()
// }

// 所有播放控制改为使用 corePlayer
async playMedia(...) {
  await this.corePlayer.play(media.uri)  // 而不是 mediaPlayer.play(media)
}

async pausePlayback() {
  await this.corePlayer.pause()  // 而不是 mediaPlayer.pause()
}

// ... 其他方法类似
```

**优点**：
- 职责清晰：CorePlayer 是唯一的播放控制入口
- 符合依赖倒置：VideoPlayerApp 只依赖 CorePlayer
- 统一封装：所有播放控制都经过 CorePlayer，便于统一处理（日志、错误处理等）

**缺点**：
- 需要修改 CorePlayer 的 `play()` 方法，接受 `Media` 对象而不是 `string`
- 需要确保 CorePlayer 的所有播放控制方法都能满足需求

### 方案 2：移除 CorePlayer 的播放控制方法

**原则**：`CorePlayer` 只负责 MPV 桥接、渲染、状态管理，不提供播放控制

**修改点**：
```typescript
// CorePlayer 接口移除播放控制方法
export interface CorePlayer {
  // 移除：play, pause, resume, stop, seek, setVolume
  // 保留：setVideoWindow, ensureControllerReadyForPlayback, getPlayerState 等
  getMediaPlayer(): MediaPlayer  // 保留，让 VideoPlayerApp 直接使用
}
```

**优点**：
- 职责更清晰：CorePlayer 专注 MPV 桥接，MediaPlayer 专注播放控制
- 减少接口复杂度

**缺点**：
- VideoPlayerApp 直接依赖 MediaPlayer，违反依赖倒置
- 如果未来需要统一处理播放控制（如日志、错误处理），需要在多个地方修改

### 方案 3：保持现状，但明确文档

**原则**：保持当前架构，但明确职责边界

**文档化**：
- `CorePlayer` 的播放控制方法用于**直接播放场景**（如测试、调试）
- `VideoPlayerApp` 通过 `MediaPlayer` 进行播放控制，用于**业务场景**
- `CorePlayer` 主要负责 MPV 桥接、渲染、状态管理

**优点**：
- 不需要修改代码
- 保持灵活性

**缺点**：
- 职责仍然混乱
- 容易产生误解

## 推荐方案

**推荐方案 1：统一通过 CorePlayer**

理由：
1. **职责清晰**：CorePlayer 是 MPV 桥接层，应该封装所有 MPV 相关操作
2. **符合架构**：VideoPlayerApp 是应用层，应该依赖 CorePlayer（应用层），而不是 MediaPlayer（基础设施层）
3. **便于扩展**：未来如果需要统一处理播放控制（如日志、错误处理、性能监控），只需在 CorePlayer 中修改

## 实施步骤

1. **修改 CorePlayer 接口**：
   - `play()` 方法接受 `Media` 对象而不是 `string`
   - 确保所有播放控制方法都能满足 VideoPlayerApp 的需求

2. **修改 VideoPlayerApp**：
   - 删除 `get mediaPlayer()` getter
   - 所有 `mediaPlayer.xxx()` 调用改为 `corePlayer.xxx()`

3. **测试验证**：
   - 确保所有播放功能正常
   - 确保状态管理正常
   - 确保事件广播正常
