## 视频切换过渡状态设计（Video Switching Transition State）

### 1. 背景与问题

#### 1.1 切换视频的完整流程

切换视频是一个**复合操作**，包含多个步骤：

1. **用户触发**：前端通过 `window.electronAPI.send('play-video', { name, path })` 发送命令
2. **主进程处理**：`VideoPlayerApp.play(target)` 执行：
   - **停止旧视频**（如果有）：`stopPlayback()` → `CorePlayer.stop()` → `MediaPlayer.stop()`
   - **重置状态**：`corePlayer.resetStatus()` → `PlayerStateMachine.resetToIdle()`
   - **准备新项**：
     - 创建/显示视频窗口
     - `corePlayer.setVideoWindow(videoWindow)`
     - `corePlayer.ensureMediaPlayerReadyForPlayback()`（设置 windowId、初始化 MediaPlayer）
   - **通知前端**：`sendToPlaybackUIs('current-video-changed', { name, path })`
   - **开始播放**：`playMedia()` → `CorePlayer.play()` → `MediaPlayer.play()`
3. **底层加载**：MPV 开始解封装/解码，`PlayerStateMachine` 通过 `player-status` 广播状态变化

#### 1.2 实际体验中的问题

- **切换开始时机不明确**：UI 不知道“切换已经开始”，可能还停留在上一个视频的错误/时间轴
- **切换过程无反馈**：从收到 `current-video-changed` 到新视频真正进入 `loading/playing` 之间存在空窗期，用户看不到任何“正在切换”的提示
- **状态清理时机混乱**：目前 `handlePlayVideo` 做了乐观清理，但语义不够清晰，且没有统一的“切换中”状态

#### 1.3 设计目标

**切换应该从“收到新的播放项”（`current-video-changed`）就开始**，而不是等到 `player-status` 变化。

在“收到 `current-video-changed`”到“新视频真正进入 loading/playing 状态”之间，引入一个**显式的过渡状态**，让 UI 有：
- 明确的切换开始信号
- 统一的清理旧状态时机
- 清晰的“正在切换视频...”提示
- 明确的切换结束判断

---

### 2. 设计决策：在后端管理切换状态

**最终方案：在 `PlayerStatus` 中增加 `isSwitching` 字段，由后端管理**

**理由**：
1. **单一数据源**：切换状态由后端完全控制，前端只需响应，避免状态不一致
2. **准确时机**：后端知道切换的每个步骤（停止旧视频、准备新项、开始播放），能准确设置和清除切换状态
3. **多窗口支持**：如果未来有多个前端窗口，它们可以共享同一个状态源
4. **语义清晰**：切换状态通过 `player-status` 统一广播，与播放状态一致

**实现方式**：
- 在 `PlayerStatus` 接口中增加 `isSwitching?: boolean` 字段
- 在 `VideoPlayerApp.play()` 中，**只有在已有活动视频时**（`hasActiveVideo()` 为 true），才调用 `corePlayer.setSwitching(true)`，表示“从旧视频切到新视频”
- 在 `PlayerStateMachine.updateFromStatus()` 中，当 phase 进入有效状态（loading/playing/paused/error）时自动清除切换状态
- 前端根据 `player-status.isSwitching` 显示切换提示

---

### 3. 实现方案：后端管理的切换状态

#### 3.1 数据结构

在 `PlayerStatus` 接口中增加 `isSwitching?: boolean` 字段：

```typescript
export interface PlayerStatus {
  phase: PlaybackStatus
  currentTime: number
  duration: number
  volume: number
  path: string | null
  isPaused: boolean
  isSeeking: boolean
  isNetworkBuffering: boolean
  networkBufferingPercent: number
  errorMessage?: string
  isSwitching?: boolean  // 是否正在切换视频（由后端管理）
}
```

#### 3.2 后端状态管理

**在 `PlayerStateMachine` 中**：
- `InternalState` 包含 `isSwitching: boolean` 字段
- `setSwitching(isSwitching: boolean)` 方法用于设置切换状态
- `updateFromStatus()` 方法中，当 phase 进入有效状态（loading/playing/paused/error）时自动清除切换状态

**在 `VideoPlayerApp.play()` 中**：
1. **仅当存在活动视频时**（`hasActiveVideo()` 返回 true），才认为是“切换到新视频”：  
   - 先调用 `corePlayer.setSwitching(true)` 标记切换开始  
   - 然后执行 `stopPlayback()` + 等待 `STOP_WAIT_MS`
2. 若没有活动视频（首次播放），不会设置 `isSwitching`，只走普通播放流程
3. 之后准备窗口、设置 videoWindow、`ensureMediaPlayerReadyForPlayback()`
4. 发送 `current-video-changed` 通知前端
5. 调用 `playMedia()` 开始播放
6. 切换状态会在第一个有效的 `player-status`（phase 进入 loading/playing/paused/error）时自动清除

#### 3.3 前端响应

**在 `ControlView.vue` 中**：
- `PlayerStatusSnapshot` 类型包含 `isSwitching?: boolean` 字段
- 本地 `isSwitchingVideo` ref 直接绑定到 `status.isSwitching`
- 模板中根据 `isSwitchingVideo` 显示“正在切换视频...”的 overlay

**UI 行为**：
- **当 `status.isSwitching === true` 时**：
  - 显示“正在切换视频...”的 overlay（全屏、居中，类似 `loading-overlay` 样式）
  - 优先级高于 `isLoading` 的 loading-overlay（切换中时，不显示普通的“加载中...”）
  - 错误 overlay 不显示（因为已清理 `playerError`）
  - 时间轴/进度条可以暂时隐藏或禁用，避免旧状态闪现

- **当 `status.isSwitching === false` 或 `undefined` 时**：
  - 正常根据 `PlayerStatus.phase` 决定展示内容：
    - `loading` → 显示 loading-overlay
    - `playing/paused` → 正常播放界面
    - `error` → 显示错误 overlay
    - `idle/stopped/ended` → 对应状态

---

### 4. 与现有逻辑的关系

1. **不修改 `PlaybackStatus` / `PlayerStatus.phase` 枚举集合**
   - 过渡语义完全由 UI 本地状态 `isSwitchingVideo` 表达。
   - 后端状态机仍然只关心真实的播放阶段。

2. **不改变现有事件协议**
   - 继续使用：
     - 命令：`play-video { name, path }`
     - 同步：`current-video-changed { name, path }`
     - 状态：`player-status PlayerStatus`
   - 仅在 UI 层额外增加一个本地过渡状态。

3. **与现有“乐观清理”代码对齐**
   - 现在 `handlePlayVideo` 已经在收到 `current-video-changed` 后做了一轮清理并设置 `isLoading = true`。
   - 将这块明确归档为“过渡状态初始化”，再加上 `isSwitchingVideo` 标志，使得逻辑语义更清晰。

---

### 5. 切换流程的完整时序

```
用户点击播放新视频
  ↓
前端：window.electronAPI.send('play-video', { name, path })
  ↓
主进程：VideoPlayerApp.handlePlayVideo()
  ↓
主进程：VideoPlayerApp.play(target)
  ├─ 1. 停止旧视频（如果有）：stopPlayback() → CorePlayer.stop() → MediaPlayer.stop()
  │   ├─ 如果 hasActiveVideo() 为 true：先调用 corePlayer.setSwitching(true)，表示“正在从旧视频切到新视频”
  │   └─ 如果没有活动视频：不设置 isSwitching（首次播放）
  ├─ 2. 重置状态：corePlayer.resetStatus() → PlayerStateMachine.resetToIdle()
  │   └─ 发出 player-status { phase: 'idle', isSwitching: false 或 true, ... }（取决于是否在切换）
  ├─ 3. 准备新项：
  │   ├─ 创建/显示视频窗口
  │   ├─ corePlayer.setVideoWindow(videoWindow)
  │   └─ corePlayer.ensureMediaPlayerReadyForPlayback()
  ├─ 4. 通知前端：sendToPlaybackUIs('current-video-changed', { name, path })
  │   └─ 前端：handlePlayVideo() → 更新视频信息，执行乐观清理
  └─ 5. 开始播放：playMedia() → CorePlayer.play() → MediaPlayer.play()
      └─ MPV 开始加载新视频
          └─ MpvMediaPlayer 发出 status-change { phase: 'loading', path: newPath, ... }
              └─ CorePlayer.updateFromPlayerStatus() → PlayerStateMachine.updateFromStatus()
                  └─ 检测到 phase 进入 'loading'，自动清除切换状态
                      └─ 发出 player-status { phase: 'loading', isSwitching: false, ... }
                          └─ 前端：handlePlayerState() → isSwitchingVideo = false（切换完成）
```

**关键点**：
- **切换开始**：收到 `current-video-changed` 时立即进入切换状态
- **切换过程**：包含停止旧视频、重置状态、准备新项、开始加载等多个步骤
- **切换结束**：收到新视频的 `player-status`（path 匹配且 phase 进入有效状态）

### 6. 与现有逻辑的关系

1. **不修改 `PlaybackStatus` 枚举集合**
   - `PlayerStatus.phase` 仍然只使用 `idle/loading/playing/paused/stopped/ended/error`
   - 切换状态通过 `isSwitching` 字段表达，不影响 phase 的语义

2. **扩展 `PlayerStatus` 接口**
   - 增加 `isSwitching?: boolean` 字段（可选，减少序列化开销）
   - 通过 `player-status` 统一广播，与播放状态一致

3. **不改变现有事件协议**
   - 继续使用：
     - 命令：`play-video { name, path }`
     - 同步：`current-video-changed { name, path }`（通知前端视频信息）
     - 状态：`player-status PlayerStatus`（包含 `isSwitching` 字段）

4. **与现有“乐观清理”代码对齐**
   - `handlePlayVideo` 仍然在收到 `current-video-changed` 后做乐观清理
   - 切换状态由后端管理，前端只需响应 `player-status.isSwitching`

### 7. 实现细节

#### 7.1 自动清除切换状态

在 `PlayerStateMachine.updateFromStatus()` 中实现自动清除逻辑：

```typescript
// 如果当前 isSwitching 为 true，且 phase 进入有效状态，自动清除切换状态
if (this.state.isSwitching && !status.isSwitching) {
  const validPhases = [
    PlaybackStatus.LOADING,
    PlaybackStatus.PLAYING,
    PlaybackStatus.PAUSED,
    PlaybackStatus.ERROR
  ]
  if (validPhases.includes(playbackStatus)) {
    isSwitching = false  // 自动清除
  }
}
```

这样，当新视频开始加载（phase 进入 `loading`）时，切换状态会自动清除，无需手动调用 `setSwitching(false)`。

#### 7.2 错误处理

如果 `playMedia()` 抛出错误：
- `VideoPlayerApp.play()` 的 catch 块会调用 `corePlayer.setError()`
- `setError()` 会将 phase 设置为 `error`
- `PlayerStateMachine.updateFromStatus()` 检测到 phase 为 `error` 时，会自动清除切换状态

#### 7.3 文档同步

在 `PLAYER_STATE_DATAFLOW.md` 的“状态通道”一节中，补充说明：
- `current-video-changed` 通知前端视频信息已更新
- `player-status` 包含 `isSwitching` 字段，表示是否正在切换视频
- 切换状态由后端管理，在 phase 进入有效状态时自动清除

