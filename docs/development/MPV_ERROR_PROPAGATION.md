## MPV 错误信息链路与展示方案

> 目标：在不破坏现有分层的前提下，把 mpv 的错误信息从 native 层传到前端，实现「友好的错误提示 + 可选技术详情」。

---

### 1. 总体链路概览

数据流向：

1. **LibMPVController**（基础设施层）  
   - 接收 mpv 事件（包括 `LOG_MESSAGE`、`END_FILE` 等）；  
   - 维护 `MPVStatus`，新增错误字段；  
   - 通过 `emit('status', MPVStatus)` 向上游广播。

2. **MpvAdapter → PlaybackSession**（领域层）  
   - 将 `MPVStatus` 适配为 `PlaybackSession`；  
   - 把 mpv 错误映射成：
     - 用户可读的 `PlaybackSession.error`；  
     - 可选的 `PlaybackSession.diagnostics`（原始 mpv 错误、日志片段）。

3. **PlayerStateMachine → PlayerState**（应用状态层）  
   - 将 `PlaybackSession` 映射为 `PlayerState`；  
   - 前端可以直接通过 `PlayerState.error` 显示友好错误文案。

4. **CorePlayer / VideoPlayerApp → 渲染进程**  
   - `CorePlayer` 发出 `player-state` 事件；  
   - `VideoPlayerApp` 转发为 IPC（`player-state`）；  
   - 前端订阅后渲染错误页和技术详情。

---

### 2. MPVStatus：承载底层错误信息

文件：`src/main/infrastructure/mpv/types.ts`

在现有 `MPVStatus` 上新增两个字段：

```ts
export interface MPVStatus {
  position: number
  duration: number
  volume: number
  path: string | null
  phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
  isSeeking?: boolean
  isCoreIdle?: boolean
  isIdleActive?: boolean
  isNetworkBuffering?: boolean
  networkBufferingPercent?: number

  /** 最近一次 mpv 错误的简要信息（单行，人类可读） */
  errorMessage?: string

  /** 最近一次错误相关的若干日志行（技术详情，可选） */
  errorLogSnippet?: string[]
}
```

设计要点：

- `errorMessage`：只保存 mpv log 的核心文本（例如 `Failed to recognize file format.`），不包含 `[mpv:...:...]` 前缀，便于后续映射成用户文案。
- `errorLogSnippet`：保留完整的 `[mpv:level:prefix] text` 行，长度限制在 50 行内，作为错误详情的诊断数据。

---

### 3. LibMPVController：采集 mpv 错误

文件：`src/main/infrastructure/mpv/LibMPVController.ts`

#### 3.1 字段

```ts
private lastMpvErrorLogLine: string | null = null
private recentMpvLogLines: string[] = []
```

#### 3.2 在 LOG_MESSAGE 中记录最后一条 error

在 `handleEvent` 的 `MPV_EVENT_LOG_MESSAGE` 分支内：

```ts
case MPV_EVENT_LOG_MESSAGE: {
  const logPrefix = event?.logPrefix
  const logLevel = event?.logLevel
  const logText = event?.logText

  const prefix = typeof logPrefix === 'string' ? logPrefix : ''
  const level = typeof logLevel === 'string' ? logLevel : ''
  const text = typeof logText === 'string' ? logText.trim() : ''

  if (!text) break

  const line = `[mpv:${level || 'unknown'}:${prefix || 'core'}] ${text}`

  // 保留最近若干条日志
  this.recentMpvLogLines.push(line)
  if (this.recentMpvLogLines.length > 50) {
    this.recentMpvLogLines.splice(0, this.recentMpvLogLines.length - 50)
  }

  // 记录最后一条 error/fatal 日志的“纯文本部分”
  if (level === 'error' || level === 'fatal') {
    this.lastMpvErrorLogLine = text
  }

  console.log(line)
  break
}
```

#### 3.3 在 END_FILE 错误分支中填充 MPVStatus 错误字段

在 `MPV_EVENT_END_FILE` 且 reason 为 `MPV_END_FILE_REASON_ERROR` 时：

```ts
} else if (reason === MPV_END_FILE_REASON_ERROR) {
  this.currentStatus.phase = 'error'
  this.currentStatus.isSeeking = false
  this.currentStatus.isNetworkBuffering = false
  this.currentStatus.networkBufferingPercent = 0

  // 1）记录简要错误信息（行内文本）
  this.currentStatus.errorMessage =
    this.lastMpvErrorLogLine ?? 'Unknown mpv error'

  // 2）记录最近一小段日志片段，用于技术详情
  this.currentStatus.errorLogSnippet = [...this.recentMpvLogLines]

  this.emit('status', { ...this.currentStatus })
  this.emit('ended')
}
```

> 注意：`errorLogSnippet` 可能略大，如有 IPC 体积考虑，可以只截断末尾 10 行。

---

### 4. MpvAdapter：映射到 PlaybackSession

文件：`src/main/infrastructure/mpv/MpvAdapter.ts`

`toPlaybackSession` 负责把 `MPVStatus` 适配到 `PlaybackSession`：

1. **生成领域级状态**：

```ts
const phase = options?.overridePhase ?? mpvStatus.phase
const status = this.mapPhaseToStatus(phase)
```

2. **从 mpv 错误生成用户可读的错误文案**：

```ts
const userFriendlyError =
  status === PlaybackStatus.ERROR && mpvStatus.errorMessage
    ? mapMpvErrorToUserMessage(mpvStatus.errorMessage)
    : null
```

3. **创建 PlaybackSession**：

```ts
return PlaybackSession.create(
  media,
  status,
  {
    currentTime: mpvStatus.position,
    duration: mpvStatus.duration,
    updatedAt: Date.now()
  },
  mpvStatus.volume,
  {
    isBuffering: mpvStatus.isNetworkBuffering ?? false,
    bufferingPercent: mpvStatus.networkBufferingPercent ?? 0
  },
  userFriendlyError,
  mpvStatus.isSeeking ?? false,
  {
    mpvErrorMessage: mpvStatus.errorMessage,
    mpvLogSnippet: mpvStatus.errorLogSnippet
  }
)
```

示例 `mapMpvErrorToUserMessage`：

```ts
function mapMpvErrorToUserMessage(raw: string): string {
  if (raw.includes('Failed to recognize file format')) {
    return '无法识别媒体格式，当前文件可能不是有效的视频或音频。'
  }
  // TODO: 后续可以根据 mpv 其它错误逐步扩展映射
  return `播放出错：${raw}`
}
```

约定：

- `PlaybackSession.error`：**仅用于前端展示的用户友好文案**；
- 诊断信息（原始 mpv 错误、日志片段）放在 `PlaybackSession.diagnostics`（可选）。

---

### 5. PlayerStateMachine 与前端使用

文件：`src/main/application/state/playerState.ts`

`sessionToPlayerState` 已经把 `PlaybackSession.error` 映射到 `PlayerState.error`：

```ts
return {
  phase,
  currentTime: session.progress.currentTime,
  duration: session.progress.duration,
  volume: session.volume,
  path: session.media?.uri ?? null,
  error: session.error,
  // ...
}
```

前端通过 IPC 接收 `player-state`：

- 错误页触发条件：

```ts
if (state.phase === 'error') {
  showErrorOverlay.value = true
  errorMessage.value = state.error || '播放出错'
}
```

- 如需展示技术详情，可以在后续扩展 `PlayerState` 增加诊断字段，或通过单独 IPC 请求主进程返回 `PlaybackSession.diagnostics`。

---

### 6. 设计原则与最佳实践

- **区分用户文案 vs 技术详情**：
  - `errorMessage`（mpvStatus）和 `PlaybackSession.error` 面向用户；
  - `errorLogSnippet` / `diagnostics` 面向开发和高级用户。

- **保持分层**：
  - 基础设施层（LibMPVController）只负责「采集并填充 MPVStatus」；
  - 领域层（MpvAdapter / PlaybackSession）负责「语义化、领域化」；
  - 应用状态层（PlayerStateMachine）只桥接领域状态给前端。

- **可渐进扩展**：
  - 先支持最常见的错误（如 `Failed to recognize file format`）；
  - 随着收集的 mpv 错误增多，在 `mapMpvErrorToUserMessage` 中逐步完善映射即可，无需改动 UI 或状态机。

