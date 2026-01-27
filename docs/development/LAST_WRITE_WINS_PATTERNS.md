## Last-Write-Wins 模式知识沉淀

> 面向：需要在「多次更新请求/事件竞争」下，保证**最后一次意图生效**的场景  
> 典型例子：播放器的 seek、音量、播放速度，表单自动保存，多端状态同步等

---

### 1. 什么是 Last-Write-Wins？

**Last-Write-Wins（LWW）** 的语义是：

> 当对同一资源/状态有多次「写入意图」竞争时，**最后一次写入（按我们定义的“时间/版本序”）最终获胜，其结果成为真实状态**。

这是一种在存在「并发/乱序/重试」时简化冲突处理的通用策略：

- 不做复杂的合并 / 回滚；
- 不保证所有中间写入都被执行；
- **只保证：最终看到的状态与“最后一次意图”一致**。

在本项目中，典型需求是：

- 多次 `seek` 请求重叠时，「最后一次 seek 的位置」必须是最终播放位置；
- 多次音量滑动中，松手时的那一次应当是最终音量（已在 `useAdjustableValue` 中实现）。

---

### 2. 典型问题形态

如果没有 LWW 设计，常见会出现：

1. **先到先服务（FIFO）而不是最后写赢**  
   - 例：正在 seek 到 10s 时，又来了一个 seek 到 100s 的请求；  
     当前实现用 `isSeeking` 拒绝第二次，结果最终停在 10s，而不是 100s。

2. **旧操作的“完成事件”覆盖新意图**  
   - 例：先发了 seek(10)，随后又发 seek(100)；  
     MPV 先执行了 seek(100)，又迟到了一次 seek(10) 的完成/状态事件，状态机以为「当前在 10s」。

3. **高频控制命令被简单节流/忽略**  
   - 例：拖动进度条发出一串 seek，只允许固定时间窗口内的第一条执行，反而把最终位置丢掉。

这些本质都是：**命令/事件链路是异步 + 可乱序，而我们没有显式地告诉系统“谁应该赢”**。

---

### 3. Last-Write-Wins 的三种常用实现模式

#### 3.1 模式 A：单通道「合并 + 覆盖」队列

**要点**：用一个「最新目标」变量覆盖所有中间请求，只执行最新的。

伪代码（以 seek 为例）：

```ts
class SeekManager {
  private latestRequestedTime: number | null = null
  private isSeeking: boolean = false

  constructor(private doSeek: (time: number) => Promise<void>) {}

  async requestSeek(time: number) {
    // 覆盖之前的目标，只保留最后一次的意图
    this.latestRequestedTime = time

    if (!this.isSeeking) {
      await this.startSeekIfNeeded()
    }
  }

  // 在 MPV/后端报告 seek 已结束时调用
  async onSeekFinishedFromBackend() {
    this.isSeeking = false
    await this.startSeekIfNeeded()
  }

  private async startSeekIfNeeded() {
    if (this.latestRequestedTime == null) return
    this.isSeeking = true

    const target = this.latestRequestedTime
    this.latestRequestedTime = null

    await this.doSeek(target)
  }
}
```

**特征**：

- 并不排「多条 seek 队列」，永远只记「当前最新目标」；
- 正在执行时新请求不会被丢，只是被「合并覆盖」为新的 latest；
- 每次 seek 完成后，如果 latest 仍有值，就立刻再执行一次，直到没新目标。

非常适合：

- 单线程/单执行器的场景（如 MPV 的 seek 调用）；
- 需要「最终位置正确」而不在乎 中间所有位置是否都走到。

#### 3.2 模式 B：版本号 / 时间戳的 LWW 状态合并

**要点**：为每次写入分配一个递增版本号或时间戳，**状态更新时只接受版本号最大的那个**。

伪代码（以后端状态机为例）：

```ts
let seekVersion = 0

async function requestSeek(time: number) {
  const myVersion = ++seekVersion
  await mpvSeek(time)
  // seek 完成时，只有当 myVersion 等于全局 seekVersion 时，才认为是「当前最新」的完成
  if (myVersion === seekVersion) {
    // 更新状态，比如 isSeeking = false、currentTime = time 等
  } else {
    // 这是旧 seek 的完成事件，忽略
  }
}
```

也可以把版本号挂在状态结构中：

```ts
type PlayerState = {
  currentTime: number
  currentTimeVersion: number
}
```

在前端或其他消费者侧：

```ts
let lastAcceptedVersion = 0

function applyStateFromBackend(st: PlayerState) {
  if (st.currentTimeVersion >= lastAcceptedVersion) {
    lastAcceptedVersion = st.currentTimeVersion
    currentTime.value = st.currentTime
  }
}
```

适合：

- 存在多路来源（多端、多窗口、多服务），需要在最终状态上做 LWW 合并；
- 对「谁是最新」的判断不能仅靠本地时间（如跨机房）。

#### 3.3 模式 C：前端/入口层的高频命令合并（Debounce + LWW）

**要点**：在「命令入口」处先做一次 LWW 合并，减轻后端压力。

例：在 `VideoPlayerApp` 层合并高频 seek：

```ts
let pendingSeekTime: number | null = null
let pendingSeekTimer: NodeJS.Timeout | null = null

function scheduleSeek(time: number) {
  pendingSeekTime = time
  if (pendingSeekTimer) {
    clearTimeout(pendingSeekTimer)
  }
  pendingSeekTimer = setTimeout(() => {
    if (pendingSeekTime != null) {
      corePlayer.seek(pendingSeekTime)
      pendingSeekTime = null
    }
  }, 50) // 例如 50ms 窗口内只保留最后一次
}
```

适合：

- 前端/入口层抖动非常频繁（拖动 slider，滚轮等）；
- 不希望每一次抖动都打到 MPV/服务端。

通常会和后端的 SeekManager / 版本号模式一起使用。

---

### 4. 与本项目现有模式的关系

- **前端层（ControlView.vue）**：
  - 已通过 `useAdjustableValue` 为音量、进度条引入了「本地 LWW + 短暂保护期」模式：
    - 拖动时本地优先（`isAdjusting = true` 屏蔽后端旧状态）；
    - 提交时记录最后一次意图 + 时间戳；
    - 之后持续接受后端状态作为最终真相。

- **主进程 seek 问题**：
  - 当前实现中，正在 `seek` 时简单拒绝后续 `seek`，实质上是「先到先服务 + 排他」，**和 LWW 语义不一致**；
  - 应引入 **SeekManager（模式 A）** 或 **版本号（模式 B）**，使：
    - 所有 seek 请求都合并/标记成「最后一次意图」；
    - 旧 seek 的完成事件不会覆盖新 seek 的目标；
    - 最终播放位置一定是「最后一次 seek 的 time」。

---

### 5. 实战落地建议

1. **在状态/命令语义上先明确：是否需要 LWW？**
   - 进度、音量、播放速度：一般是 **LWW + 本地交互优先**；
   - 队列式任务（下载任务队列等）：则可能需要 FIFO，而不是 LWW。

2. **选择合适的模式或组合**：
   - 前端交互抖动多：优先用「前端 AdjustableValue + 短暂保护期」；
   - 后端执行存在「正在进行中的排他逻辑」：加 SeekManager（模式 A）；
   - 多源状态合并、跨进程/跨机房：加版本号/时间戳（模式 B）。

3. **在文档中标注清楚**：
   - 哪些字段/命令遵循 LWW；
   - 采用了哪一种（或几种）具体实现模式；
   - 有哪些边界情况（如最大延迟、多端冲突时的行为）。

这样，在以后遇到类似「seek 不 obey 最后一次」的问题时，可以直接套用本文件中的模式，而不需要从零重新思考。  

