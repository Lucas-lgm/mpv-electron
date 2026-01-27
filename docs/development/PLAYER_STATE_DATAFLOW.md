## 播放状态数据流（命令通道 & 状态通道）

本篇文档专门描述从渲染进程到 mpv 内核，再回到渲染进程的「**播放状态数据流**」，用于补充 `ARCHITECTURE.md` 中的组件职责说明，便于分析状态一致性、延迟和竞态问题。

### 1. 总体数据流示意

#### 1.1 命令通道（Command Channel）

```mermaid
flowchart LR
  subgraph Renderer
    UI[ControlView.vue / MainView.vue]
  end

  subgraph Main["Main Process"]
    IPC[ipcHandlers.ts]
    App[VideoPlayerApp]
    Core[CorePlayer]
    MP[MediaPlayer<br/>(MpvMediaPlayer)]
    LC[LibMPVController]
  end

  subgraph MPV["mpv core"]
    MPVCore[(mpv)]
  end

  UI -- IPC 消息<br/>(play / pause / seek / volume / stop) --> IPC
  IPC -- 调用方法 --> App
  App -- 业务调用 --> Core
  Core -- 播放控制 --> MP
  MP -- 属性/命令<br/>setProperty / command --> LC
  LC -- C API 调用 --> MPVCore
```

- **Renderer → ipcHandlers**：通过 `window.electronAPI.send('control-*')` 发送播放控制命令。
- **ipcHandlers → VideoPlayerApp**：只做路由和参数解析，不持有状态。
- **VideoPlayerApp → CorePlayer / MediaPlayer**：封装播放业务（播放入口、播放列表、自动播放下一集等）。
- **MediaPlayer / LibMPVController → mpv core**：发出真正的 mpv 命令或属性设置。

#### 1.2 状态通道（State/Broadcast Channel）

```mermaid
flowchart LR
  subgraph MPV["mpv core"]
    MPVCore[(mpv)]
  end

  subgraph Main["Main Process"]
    LC[LibMPVController]
    SM[PlayerStateMachine]
    Core[CorePlayer]
    App[VideoPlayerApp]
  end

  subgraph Renderer
    UI[ControlView.vue]
  end

  MPVCore -- status 事件 / 属性轮询 --> LC
  LC -- MPVStatus --> SM
  SM -- PlaybackSession 派生<br/>emit('state', PlayerState) --> Core
  Core -- 'player-state' 事件 --> App
  App -- IPC 广播<br/>(sendToPlaybackUIs) --> UI
  UI -- handlePlayerState(state) --> UIState[本地 UI 状态<br/>(loading / error / timeline)]
```

- **mpv core → LibMPVController**：通过事件回调 / `get_property` 周期性获取底层状态。
- **LibMPVController → PlayerStateMachine**：构造 `MPVStatus`，交由状态机推导高层状态。
- **PlayerStateMachine → CorePlayer**：`emit('state', PlayerState)` 事件驱动 Timeline / RenderManager（以及 reset 流程）。
- **CorePlayer → VideoPlayerApp**：将 `PlayerState` 作为 `'player-state'` 事件再对外抛出。
- **VideoPlayerApp → Renderer**：经 `sendToPlaybackUIs('player-state', state)` 广播给视频窗口和控制栏。
- **Renderer → 本地 UI 状态**：`ControlView.vue` 的 `handlePlayerState` 根据 phase/时间轴/错误来更新 loading、错误 overlay、timeline 等本地 state。

### 2. 关键节点详解

#### 2.1 PlayerStateMachine：单一状态源

- 文件：`src/main/application/state/playerState.ts`
- 职责：
  - 从 `MPVStatus` 推导出领域态 `PlaybackSession`；
  - 将领域态映射为跨进程使用的 `PlayerState`；
  - 通过 `emit('state', PlayerState)` 对外广播。
- 对外暴露的主要方法：
  - `getState()`：同步读取当前 `PlayerState`；
  - `resetToIdle()`：重置为「干净的 idle 状态」（清空 media / progress / error / buffering，保留 volume），并**无条件**再发出一帧 `'state'`；
  - `setPhase(phase, error?)`：用于业务态切换（error / paused / stopped 等），`idle` 分支内部委托给 `resetToIdle()`；
  - `setError(message)`：封装错误态转换；
  - `updateFromStatus(status: MPVStatus)`：从 mpv 拉回的原始状态更新内部会话。

> 设计要点：  
> `PlayerStateMachine` 是「应用层的单一状态源」，所有对外可见的 `PlayerState` 都应从这里发出，而不是直接由 `LibMPVController` 或 `CorePlayer` 构造。

#### 2.2 CorePlayer：状态机的使用者 & 转发者

- 文件：`src/main/application/core/corePlayer.ts`
- 与状态机的交互：
  - 在构造函数中订阅 `PlayerStateMachine` 的 `'state'` 事件：

    ```ts
    this.stateMachineStateListener = (st: PlayerState) => {
      this.timeline?.handlePlayerStateChange(st.phase)
      // 渲染相关逻辑（RenderManager）
      // ...
      // 仅作为「桥接者」向外转发，不修改状态本身
      this.emit('player-state', st)
    }
    this.stateMachine.on('state', this.stateMachineStateListener)
    ```

  - 作为业务入口调用状态机：
    - `updateFromMPVStatus(status)` → `stateMachine.updateFromStatus(status)`
    - `setPhase(phase)` / `setError(message)` → `stateMachine.setPhase(...)`
    - `resetState()` → `stateMachine.resetToIdle()`（用于 stop / 新播放前的全局清理）

> 设计要点：  
> `CorePlayer` **不直接管理 PlayerState 的细节**，而是作为「状态机的用户 + 事件转发桥接者」存在：  
> - 向状态机写入状态（来自 mpv 或业务事件）；  
> - 监听状态机变化并转发给上层（VideoPlayerApp / Timeline / RenderManager）。

#### 2.3 VideoPlayerApp：业务协调者 & IPC 广播中枢

- 文件：`src/main/application/videoPlayerApp.ts`
- 与状态数据流相关的职责：
  - 在构造函数中订阅 `CorePlayer` 的 `"player-state"` 事件：

    ```ts
    private readonly onPlayerStateBroadcast = (state: unknown) => {
      this.sendToPlaybackUIs('player-state', state)
    }

    constructor(private readonly corePlayer: CorePlayer) {
      // ...
      this.corePlayer.on('player-state', this.onPlayerStateBroadcast)
    }
    ```

  - 通过 `sendToPlaybackUIs(channel, payload)` 将 `PlayerState` 广播给视频窗口和控制栏。
  - 在播放入口前调用 `corePlayer.resetState()`，确保在新一轮加载前，前后端都对齐到「干净的 idle 状态」。

#### 2.4 Renderer / ControlView：命令 + 状态的消费方

- 文件：`src/renderer/src/views/ControlView.vue`
- 命令通道：

  ```ts
  window.electronAPI.send('control-play')
  window.electronAPI.send('control-stop')
  window.electronAPI.send('control-seek', t)
  window.electronAPI.send('control-volume', v)
  ```

- 状态通道：

  ```ts
  onMounted(() => {
    if (window.electronAPI) {
      window.electronAPI.on('player-state', handlePlayerState)
      window.electronAPI.on('video-time-update', handleVideoTimeUpdate)
      window.electronAPI.on('play-video', handlePlayVideo)
      // ...
    }
  })
  ```

- `handlePlayerState` 根据 `state.phase` 等字段，更新：
  - `isLoading` / `isVideoReady`（黑屏 vs 透明背景）；
  - `currentTime` / `duration`（timeline）；
  - `playerError`（错误 overlay）；
  - `isNetworkBuffering` / `networkBufferingPercent`（网络缓冲提示）。

### 3. 典型场景中的数据流

#### 3.1 「点击播放」场景

1. 渲染进程：`ControlView` 调用 `window.electronAPI.send('play-video', { name, path })`。
2. 主进程：
   - `ipcHandlers` 将请求路由到 `VideoPlayerApp.handlePlayVideo`；
   - `VideoPlayerApp` 更新播放列表 & 当前项，调用 `play(target)`；
   - `play()` 内部：
     1. 通过 `CorePlayer` 完成窗口准备和 controller 初始化；
     2. 调用 `corePlayer.resetState()`（经状态机发出一帧 `idle`）；
     3. 通过 `sendToPlaybackUIs('play-video', { name, path })` 通知前端；
     4. 调用 `playMedia()`，驱动 `MediaPlayer` / `LibMPVController` / mpv 真正开始加载。
3. mpv 开始解封装 / 解码，`LibMPVController` 按间隔拉取 `MPVStatus`，`PlayerStateMachine.updateFromStatus` 推导出 phase=`loading/playing` 等状态，再经整个链路广播给前端。

#### 3.2 「点击停止」场景

1. 渲染进程：`ControlView` 发送 `control-stop`。
2. 主进程：
   - `ipcHandlers` → `VideoPlayerApp.stopPlayback()` → `CorePlayer.stop()`；
   - `CorePlayer.stop()`：
     1. 调用 `MediaPlayer.stop()` 停止 mpv 播放；
     2. 调用 `resetState()`，经 `PlayerStateMachine.resetToIdle()` 发出一帧 `idle`；
3. 前端收到 `player-state { phase: 'idle', currentTime: 0, ... }`，清空 timeline / 错误 / 缓冲提示。

### 4. 后续优化建议（讨论占位）

> 以下为后续重构/优化时可参考的方向，当前实现不必一次完成：

- **统一状态入口**：保证所有对 `PlayerState` 的修改都经 `PlayerStateMachine` 入口（`resetToIdle` / `setPhase` / `updateFromStatus`），避免旁路更新。
- **更细粒度的诊断字段**：在不污染 `PlayerState` 的前提下，通过单独的 diagnostics 通道承载原始 mpv 错误、日志片段，避免 UI 过度依赖低层文案。
- **前端与后端的「乐观清理」策略对齐**：规范哪些场景（如 `play-video`）可以在前端先乐观清理，再由后端状态收敛；哪些场景必须等待后端确认。

