# VideoPlayerApp 与 ApplicationService 职责重叠分析

## 1. 问题分析

### 1.1 当前职责划分

**VideoPlayerApp**（阶段 1 已简化）：
- ✅ 窗口管理（WindowManager、createMainWindow、createVideoWindow）
- ✅ 配置管理（ConfigManager）
- ✅ 播放列表的 PlaylistItem 转换（getList、setList、setCurrentByPath）
- ✅ 播放流程协调（play 方法：窗口创建 + corePlayer 调用 + 错误处理）
- ✅ ~~播放控制委托~~ 已删除（pause/resume/stop/seek/setVolume）；IPC 直接调用 `appService`
- ⚠️ 直接调用 corePlayer（play、setHdrEnabled、sendKey）

**ApplicationService**：
- ✅ 命令/查询协调（CQRS 模式）
- ✅ 播放控制命令（playMedia、pause、resume、seek、setVolume、stop）
- ✅ 查询（getPlaylist、getPlaybackStatus）
- ⚠️ 持有 Playlist 引用（与 videoPlayerApp 重复）

### 1.2 重叠与问题

| 问题 | 描述 | 影响 |
|------|------|------|
| **职责混合** | `videoPlayerApp` 既做窗口协调，又做播放控制 | 违反单一职责原则 |
| **调用不一致** | `play()` 直接调用 `corePlayer`，其他方法通过 `appService` | 架构不统一 |
| **Playlist 重复持有** | `videoPlayerApp` 和 `ApplicationService` 都持有 `Playlist` | 数据同步风险 |
| **多余包装层** | `videoPlayerApp.pause/resume/stop` 只是简单委托 | 增加调用链，无实际价值 |
| **窗口逻辑耦合** | `play()` 方法包含窗口创建逻辑，无法复用 | 难以测试和扩展 |

## 2. 重构方案

### 方案 A：统一通过 ApplicationService（推荐）

**核心思路**：让 `videoPlayerApp.play()` 也通过 `appService.playMedia()`，统一所有播放控制入口。

**优点**：
- ✅ 架构统一，所有播放控制都走 ApplicationService
- ✅ 职责清晰：VideoPlayerApp 负责窗口/UI，ApplicationService 负责业务逻辑
- ✅ 易于测试：业务逻辑与窗口逻辑分离

**缺点**：
- ❌ 需要将窗口创建逻辑提取到 ApplicationService 或新组件
- ❌ 需要调整 PlayMediaCommand 以支持窗口创建

**实施步骤**：
1. 创建 `WindowCoordinator` 或扩展 `ApplicationService` 支持窗口创建
2. 修改 `PlayMediaCommand` 支持窗口创建参数
3. 修改 `videoPlayerApp.play()` 调用 `appService.playMedia()`
4. 删除 `videoPlayerApp` 的播放控制委托方法（pause/resume/stop/seek/setVolume），直接暴露 `appService`

### 方案 B：拆分 VideoPlayerApp

**核心思路**：将 `VideoPlayerApp` 拆分为窗口协调器和应用门面。

```
WindowCoordinator（窗口管理）
  - createMainWindow()
  - createVideoWindow()
  - ensureControlWindow()
  - windowManager

ApplicationFacade（应用门面）
  - appService（ApplicationService）
  - windowCoordinator（WindowCoordinator）
  - config（ConfigManager）
  - playlist（Playlist，但通过 appService 访问）
```

**优点**：
- ✅ 职责更清晰
- ✅ 窗口逻辑可独立测试

**缺点**：
- ❌ 重构成本高
- ❌ 可能过度设计

### 方案 C：提取窗口创建到 ApplicationService

**核心思路**：将窗口创建逻辑提取到 `ApplicationService` 或新服务，`videoPlayerApp.play()` 调用 `appService.playMedia()`。

**优点**：
- ✅ 统一入口
- ✅ 业务逻辑集中

**缺点**：
- ❌ ApplicationService 会依赖 Electron 窗口 API，增加耦合

### 方案 D：保持现状，明确职责边界（保守）

**核心思路**：不重构，但明确职责：
- `VideoPlayerApp`：窗口/UI 协调 + 播放列表 PlaylistItem 转换
- `ApplicationService`：纯业务逻辑（命令/查询）

**优点**：
- ✅ 无重构成本
- ✅ 当前结构已相对清晰

**缺点**：
- ❌ 调用路径不一致（play 走 corePlayer，其他走 appService）
- ❌ 职责仍有重叠

## 3. 推荐方案：方案 A（统一通过 ApplicationService）

### 3.1 重构目标

1. **统一调用路径**：所有播放控制都通过 `ApplicationService`
2. **职责分离**：`VideoPlayerApp` 专注窗口/UI，`ApplicationService` 专注业务逻辑
3. **简化接口**：`VideoPlayerApp` 直接暴露 `appService`，删除多余包装方法

### 3.2 具体实施

#### 步骤 1：扩展 PlayMediaCommand 支持窗口创建

```typescript
// application/commands/PlayMediaCommand.ts
export interface PlayMediaCommand {
  media: Media
  windowOptions?: {
    createWindow?: boolean  // 是否需要创建窗口
    windowId?: string      // 窗口 ID
  }
}
```

#### 步骤 2：PlayMediaCommandHandler 支持窗口创建

```typescript
// application/commands/PlayMediaCommand.ts
export class PlayMediaCommandHandler {
  constructor(
    private player: MediaPlayer,
    private playlist: Playlist,
    private windowCoordinator?: WindowCoordinator  // 可选依赖
  ) {}

  async handle(command: PlayMediaCommand): Promise<void> {
    // 1. 添加到播放列表
    // 2. 如果需要，创建窗口
    // 3. 调用 player.play()
  }
}
```

#### 步骤 3：创建 WindowCoordinator（可选）

```typescript
// application/windows/WindowCoordinator.ts
export class WindowCoordinator {
  constructor(private windowManager: WindowManager) {}
  
  async ensureVideoWindow(): Promise<BrowserWindow | null> {
    // 窗口创建逻辑
  }
}
```

#### 步骤 4：简化 VideoPlayerApp

```typescript
export class VideoPlayerApp {
  readonly windowManager: WindowManager
  readonly config: ConfigManager
  readonly appService: ApplicationService  // 直接暴露，不再包装
  
  // 删除：pause, resume, stop, seek, setVolume 委托方法
  
  async play(target: PlaylistItem) {
    // 创建窗口
    const videoWindow = await this.windowCoordinator.ensureVideoWindow()
    if (!videoWindow) return
    
    // 通过 appService 播放
    await this.appService.playMedia({
      media: Media.create(target.path, { title: target.name }),
      windowOptions: { createWindow: false, windowId: 'video' }
    })
  }
}
```

#### 步骤 5：更新 IPC Handlers

```typescript
// ipcHandlers.ts
ipcMain.on('control-pause', async () => {
  await videoPlayerApp.appService.pausePlayback({})  // 直接调用
})

ipcMain.on('play-video', async (event, file) => {
  await videoPlayerApp.play({ path: file.path, name: file.name })  // 通过 videoPlayerApp（包含窗口逻辑）
})
```

### 3.3 重构后的职责划分

| 组件 | 职责 |
|------|------|
| **VideoPlayerApp** | 窗口/UI 协调、配置管理、PlaylistItem 转换、播放流程入口（包含窗口创建） |
| **ApplicationService** | 命令/查询协调、业务逻辑（播放控制、播放列表管理） |
| **WindowCoordinator**（可选） | 窗口创建逻辑封装 |

## 4. 实施建议

### 4.1 渐进式重构

1. **阶段 1**：创建 `WindowCoordinator`，提取窗口创建逻辑
2. **阶段 2**：扩展 `PlayMediaCommand` 支持窗口创建
3. **阶段 3**：修改 `videoPlayerApp.play()` 通过 `appService.playMedia()`
4. **阶段 4**：删除 `videoPlayerApp` 的播放控制委托方法，直接暴露 `appService`
5. **阶段 5**：更新 IPC Handlers 和测试

### 4.2 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 窗口创建逻辑复杂 | 中 | 先提取到 WindowCoordinator，再集成 |
| 调用路径变更 | 高 | 全面测试，确保所有 IPC 调用正常 |
| ApplicationService 耦合增加 | 中 | 使用可选依赖（WindowCoordinator），保持可测试性 |

## 5. 决策建议

**推荐**：采用**方案 A（统一通过 ApplicationService）**，但保持 `videoPlayerApp.play()` 作为包含窗口创建的高级入口，内部调用 `appService.playMedia()`。

**理由**：
1. 统一架构，所有业务逻辑都走 ApplicationService
2. 职责清晰，VideoPlayerApp 专注窗口/UI 协调
3. 易于测试，业务逻辑与窗口逻辑分离
4. 向后兼容，IPC 调用路径基本不变

**如果暂缓重构**：
- 在代码注释中明确职责边界
- 统一调用路径：要么都走 appService，要么都走 corePlayer（推荐前者）

---

## 6. 执行记录

### 阶段 1（已完成）

- 删除 `VideoPlayerApp` 的 `pause`、`resume`、`stop`、`seek`、`setVolume` 包装方法；IPC 已直接调用 `appService`。
- `control-play` 逻辑：`ended`/`stopped` 时调用 `videoPlayerApp.playCurrentFromPlaylist()`，否则 `appService.resumePlayback({})`。

### 阶段 2（已完成）

- ✅ 扩展 `PlayMediaCommand` 支持 `options`（音量、自动恢复）
- ✅ 修改 `PlayMediaCommandHandler` 处理播放选项（设置音量、自动恢复）
- ✅ 重构 `videoPlayerApp.play()`：保留窗口创建和广播（UI 层），播放逻辑通过 `appService.playMedia()`
- ✅ 统一调用路径：所有播放控制都通过 `ApplicationService`

**结果**：
- `videoPlayerApp.play()` 现在通过 `appService.playMedia()` 调用
- 窗口创建和广播消息保留在 `VideoPlayerApp`（UI 层职责）
- 播放逻辑（play、setVolume、resume）统一在 `ApplicationService` 中处理
- 架构统一：所有业务逻辑都走 `ApplicationService`
