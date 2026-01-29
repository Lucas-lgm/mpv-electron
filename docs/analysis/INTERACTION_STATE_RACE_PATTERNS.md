## 交互状态竞态处理模式（Interaction State Race Patterns）

> 面向：前端交互（Vue / React 等） + 后端状态广播（事件流、轮询、IPC）的组合场景  
> 目标：解决「前端刚改完状态，又被后端旧状态覆盖」的典型竞态问题

---

### 1. 问题背景

在播放器等实时交互场景中，常见模式是：

- **命令通道（Command Channel）**：前端发指令  
  例如：`control-volume`、`control-seek`、`control-play`……
- **状态广播通道（State Broadcast Channel）**：后端周期性/事件性推送当前状态  
  例如：`player-state` 中包含 `volume` / `currentTime` / `phase` 等。

这会产生一个常见竞态：

1. 用户在前端拖动 Slider，把音量从 10 调到 50；
2. 前端立即通过命令通道发送 `setVolume(50)`；
3. 后端还没来得及更新内部状态，就按旧状态（`volume = 10`）推送了一帧 `player-state`；
4. 前端在 `handlePlayerState` 里无条件用 `state.volume` 覆盖了本地 `volume`；
5. 用户看到 UI 数值「闪回」或「改不动」，体验非常差。

**本质：** 命令链路与状态链路是异步的，且二者之间缺少因果关系或版本信息。

---

### 2. 通用设计目标

我们在设计上希望同时满足：

1. **后端仍然是最终真相（source of truth）**  
   前端只是视图，最终值以后端状态为准。
2. **用户交互期间，前端有临时优先级**  
   用户正在拖动/输入时，不能被老旧状态「打断」或「打回」。
3. **不强制引入额外 ack 协议**  
   在播放器这类高频小控制场景中，希望保持协议简单。

---

### 3. 模式一：前端短暂保护期（当前播放器采用）

#### 3.1 适用场景

- 命令是**幂等且便宜**的：`setVolume`、`seek`、`setPlaybackRate` 等。
- 有**持续状态广播**：`player-state` 高频推送，前端可以不断被校正。
- 多数情况下只有「本端」在操作（非多端同时控制）。

#### 3.2 通用抽象：AdjustableValue 模式

为了让进度条、音量、播放速度等都能复用同一套逻辑，可以抽象出一个「可调值」模型：

- **核心状态**
  - `value`：当前 UI 显示值（绑定到 slider / input）
  - `lastLocalValue`：最近一次用户希望提交给后端的目标值
  - `lastChangeAt`：最近一次「提交」发生的时间戳（毫秒）
  - `isAdjusting`：是否处于「用户正在手动调整」阶段（拖动中）
- **常量**
  - `JUST_CHANGED_WINDOW`：保护期窗口（如 100–300ms）
- **接口**
  - `onUserInput(v)`：用户正在拖动/输入；更新 UI，标记 `isAdjusting = true`，可选「实时发送命令」
  - `onUserCommit(v)`：用户确认本次变更（松手/回车）；记录时间 + 发送命令，结束 `isAdjusting`
  - `applyServerState(serverValue)`：后端状态广播回来的值；在 `isAdjusting` 期间直接忽略，其他情况按保护期规则合并

伪代码示例（以 TypeScript composable 形式）：

```ts
interface AdjustableValueOptions<T> {
  initial: T
  justChangedWindowMs?: number
  sendCommand: (value: T) => void
  /** 像音量这类希望拖动时实时生效的，可在 input 阶段就发命令 */
  sendOnInput?: boolean
}

interface AdjustableValue<T> {
  value: { value: T }                // Vue ref<T> 或类似容器
  onUserInput: (v: T) => void        // 拖动中：更新 UI，标记 isAdjusting，可选实时发送命令
  onUserCommit: (v: T) => void       // 松手：更新 UI + 记录时间 + 发送命令，结束 isAdjusting
  applyServerState: (serverValue: T) => void // 状态广播回写入口（考虑 isAdjusting + 保护期）
}

function createAdjustableValue<T>(opts: AdjustableValueOptions<T>): AdjustableValue<T> {
  const JUST_CHANGED_WINDOW = opts.justChangedWindowMs ?? 200
  const value = { value: opts.initial }
  let lastLocalValue = opts.initial
  let lastChangeAt = 0
  let isAdjusting = false

  const onUserInput = (v: T) => {
    isAdjusting = true
    value.value = v
    if (opts.sendOnInput) {
      opts.sendCommand(v)
    }
  }

  const onUserCommit = (v: T) => {
    lastLocalValue = v
    lastChangeAt = Date.now()
    value.value = v
    opts.sendCommand(v)
    isAdjusting = false
  }

  const applyServerState = (serverValue: T) => {
    if (isAdjusting) {
      // 用户正在手动调整时，不接受任何后端回写，避免拖动过程中被抢回
      return
    }

    const now = Date.now()
    const inProtectWindow = now - lastChangeAt < JUST_CHANGED_WINDOW
    const looksLikeOldValue = serverValue !== lastLocalValue

    // 保护期内且看起来是旧值 → 忽略（避免覆盖刚刚提交的新值）
    if (inProtectWindow && looksLikeOldValue) {
      return
    }

    // 其余情况正常接受后端状态（后端仍是最终真相）
    value.value = serverValue
  }

  return { value, onUserInput, onUserCommit, applyServerState }
}
```

使用示例（音量 / 进度 / 播放速度）：

```ts
// 音量
const volume = createAdjustableValue<number>({
  initial: 100,
  sendCommand: v => window.electronAPI?.send('control-volume', v)
})

// 播放进度（秒）
const progress = createAdjustableValue<number>({
  initial: 0,
  sendCommand: t => window.electronAPI?.send('control-seek', t)
})

// 播放速度
const playbackSpeed = createAdjustableValue<number>({
  initial: 1.0,
  sendCommand: s => window.electronAPI?.send('control-speed', s)
})

// 在统一的状态广播处理函数中：
const handlePlayerState = (state: PlayerState) => {
  volume.applyServerState(state.volume)
  progress.applyServerState(state.currentTime)
  playbackSpeed.applyServerState(state.playbackSpeed)
}
```

这样，**模式一就从“针对某个字段的临时写法”，升级成了一个可以复用在任意标量可调值上的通用模式**。

#### 3.3 特性与权衡

- **优点**
  - 不改变现有命令/状态协议，只在前端增加极少量状态和判断逻辑；
  - 只屏蔽「刚发命令后那一小段时间里的明显旧值」，不会长期对抗后端；
  - 对播放器这种本地桌面应用而言，用户几乎感知不到任何副作用。

- **潜在边界情况**
  - 如果状态广播链路有极端延迟，可能出现「旧值恰好落在保护窗外」，短时间内 UI 被改回旧值，但随着新的状态推送会再次校正；
  - 多端控制时无法区分「自己刚发的命令」与「其他端刚设置的新值」，此时更适合使用版本号/操作ID方案。

- **本项目约定**
  - 音量、进度等「本地高频小控制」默认采用短暂保护期模式；
  - 若未来出现多端控制、远程高 RTT 等场景，再升级为版本号/操作ID模式。

---

### 4. 模式二：版本号 / 时间戳（升级路径）

在需要更强一致性时，可以为状态引入**版本号或更新时间戳**：

#### 4.1 基本思路

- 后端在状态结构里为关键字段增加：
  - `volumeVersion: number` 或
  - `volumeUpdatedAt: number`（毫秒时间戳）。
- 每次实际更新 volume 时，增加版本或更新时间：

```ts
// 伪代码示例（后端）
state.volume = newVolume
state.volumeVersion += 1
// 或：
state.volumeUpdatedAt = Date.now()
```

- 前端维护「当前已接受的版本」：

```ts
let lastAcceptedVolumeVersion = 0

const handlePlayerState = (state: PlayerState) => {
  if (typeof state.volume === 'number' && state.volumeVersion >= lastAcceptedVolumeVersion) {
    lastAcceptedVolumeVersion = state.volumeVersion
    volume.value = state.volume
  }
}
```

原则：**谁的版本号大，听谁的。**

#### 4.2 适用场景

- 多端/多窗口同时控制同一状态；
- 状态链路可能乱序，且延迟较大；
- 需要在日志或调试中清晰追踪「哪一次操作产生了当前状态」。

---

### 5. 模式三：操作 ID / 请求 ID（高级场景）

再进一步，可以为每一次前端操作分配一个唯一的 **operationId / requestId**。

#### 5.1 基本思路

- 前端：
  - 生成 `opId = uuid()`；
  - 发送命令时附带 `{ value, opId }`；
  - 将 `pendingOpId = opId` 记录下来。

- 后端：
  - 处理完成后，在下一次相关状态中附带：
    - `lastVolumeOpId: string | null`。

- 前端在处理状态时：

```ts
let pendingVolumeOpId: string | null = null

const sendVolume = (v: number) => {
  const opId = generateOpId()
  pendingVolumeOpId = opId
  window.electronAPI?.send('control-volume', { value: v, opId })
}

const handlePlayerState = (state: PlayerState) => {
  if (state.lastVolumeOpId && state.lastVolumeOpId === pendingVolumeOpId) {
    // 这是对当前待确认操作的最终状态回写
    pendingVolumeOpId = null
    volume.value = state.volume
    return
  }

  // 否则按普通状态处理逻辑
}
```

#### 5.2 适用场景

- 操作的副作用较大，需精确知道「这一次请求是否真正落地」；
- 存在「重试 / 超时」等更复杂的请求生命周期管理；
- 与服务端有一致的请求跟踪体系（日志、监控、审计）。

---

### 6. 总结与在本项目中的应用

1. **当前播放器采用的默认模式**：  
   - 命令通道：`control-*` IPC；  
   - 状态通道：`player-state` 事件流；  
   - 交互竞态处理：**前端短暂保护期**（模式一），只需在渲染进程维护少量本地记录和条件判断。

2. **可选升级路径**：
   - 若未来引入多端控制或远程控制场景，可考虑在 `PlayerState` / `PlaybackSession` 中引入字段级版本号或时间戳（模式二），并调整前端状态合并策略；
   - 若需要更精细的请求追踪，则可增加操作 ID（模式三），与后端日志/监控联动。

3. **实践建议**：
   - 对所有「滑块型、可连续调整的控制」（音量、进度、画面参数等），统一按上述模式抽象为**可复用的交互模式/composable**，而不是在每个组件里各自用 ad-hoc 逻辑；
   - 在编写新交互时，优先考虑：
     - 是否需要临时本地优先级；
     - 是否存在「命令 vs 状态」的异步竞态；
     - 选择合适的模式（短暂保护期 / 版本号 / 操作 ID），并在文档中注明所选模式及其边界条件。

