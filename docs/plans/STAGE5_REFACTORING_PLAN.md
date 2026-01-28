# 阶段5重构实施计划

> **创建日期**: 2026-01-26  
> **状态**: 执行中（步骤 5.1–5.3 已完成）  
> **优先级**: 中

## 📋 目标

将现有代码逐步迁移到新架构，使用领域模型和应用服务，同时保持向后兼容。

## 🔀 适配层定位

**适配层是重构过程中的过渡产物，不是长期架构的一部分。**

| 适配层 | 作用 | 保留期 | 清理时机 |
|--------|------|--------|----------|
| `PlayerState` ↔ `PlaybackSession` | 桥接旧状态接口与领域模型 | 阶段 5–6 | ✅ 阶段 7 已移除：逻辑内联至 `playerState.ts`（`sessionToPlayerState`） |
| `PlaylistManager` ↔ `Playlist` | 桥接旧播放列表接口与领域模型 | 阶段 5–6 | ✅ 阶段 7 已移除：单一 `playlist`（Playlist）+ `getList`/`setList` 等方法 |
| `CorePlayer` 包装 `MediaPlayer` | 保持现有调用方不变 | 阶段 5–6 | 阶段 7：当调用方改为直接使用 `ApplicationService` 或 `MediaPlayer` 后，可移除 `CorePlayer` 包装 |

**原则**：
- **过渡期**：用适配层做渐进式迁移，保证兼容、可回滚。
- **目标态**：命令层（IPC、UI）直接使用领域模型或专门 DTO，不再依赖旧接口。
- **阶段 7**：在「移除旧代码」步骤中删除所有此类适配层，避免长期两套模型并存。

若长期保留适配层，会导致双模型、双语义，维护成本高，违背语义化重构目标。

## 🎯 重构范围

### 步骤 5.1: 重构 videoPlayerApp

**当前状态**：
- 使用 `PlaylistManager`（内部类）
- 直接调用 `corePlayer`
- 使用 `ConfigManager`（配置管理）

**目标状态**：
- 使用领域模型 `Playlist`
- 使用 `ApplicationService` 替代直接操作
- 保持向后兼容（保留 `playlist` 属性，内部使用新实现）

**实施步骤**：

1. **创建适配层**（保持兼容）
   - 在 `videoPlayerApp.ts` 中创建 `PlaylistAdapter`，将 `PlaylistManager` 接口适配到 `Playlist`
   - 或直接替换 `PlaylistManager` 为 `Playlist`，但需要适配接口差异

2. **集成 ApplicationService**
   - 在 `VideoPlayerApp` 构造函数中创建 `ApplicationService` 实例
   - 传入 `MpvMediaPlayer` 和 `Playlist` 实例

3. **迁移播放控制方法**
   - `play()` → 使用 `ApplicationService.playMedia()`
   - `pause()` → 使用 `ApplicationService.pausePlayback()`
   - `resume()` → 使用 `ApplicationService.resumePlayback()`
   - `seek()` → 使用 `ApplicationService.seek()`
   - `setVolume()` → 使用 `ApplicationService.setVolume()`
   - `stop()` → 使用 `ApplicationService.stopPlayback()`

4. **迁移播放列表操作**
   - `playlist.getList()` → `ApplicationService.getPlaylist()`
   - `playlist.setCurrentByPath()` → `Playlist.setCurrentByUri()`
   - `playlist.next()` → `Playlist.next()`
   - `playlist.prev()` → `Playlist.previous()`

5. **保持窗口管理**
   - 窗口创建和管理逻辑保持不变
   - 窗口 ID 设置到 `MpvMediaPlayer`

**兼容性考虑**：
- 保留 `playlist` 属性（类型为 `PlaylistManager`），内部使用 `Playlist`
- 或创建适配器，让 `playlist` 属性返回适配后的接口

### 步骤 5.2: 重构 corePlayer

**当前状态**：
- 直接使用 `LibMPVController`
- 使用 `PlayerStateMachine`
- 管理窗口、渲染、时间轴

**目标状态**：
- 使用 `MediaPlayer` 接口
- 内部实现使用 `MpvMediaPlayer`
- 保持 `CorePlayer` 接口兼容

**实施步骤**：

1. **创建 MediaPlayer 实例**
   - 在 `CorePlayerImpl` 中创建 `MpvMediaPlayer` 实例
   - 保持 `LibMPVController` 的引用（用于窗口管理和渲染）

2. **迁移播放控制方法**
   - `play()` → 委托给 `MpvMediaPlayer.play()`
   - `pause()` → 委托给 `MpvMediaPlayer.pause()`
   - `resume()` → 委托给 `MpvMediaPlayer.resume()`
   - `seek()` → 委托给 `MpvMediaPlayer.seek()`
   - `setVolume()` → 委托给 `MpvMediaPlayer.setVolume()`
   - `stop()` → 委托给 `MpvMediaPlayer.stop()`

3. **保持窗口管理**
   - `setVideoWindow()` → 设置窗口 ID 到 `MpvMediaPlayer`
   - 窗口大小同步逻辑保持不变

4. **状态转换**
   - `getPlayerState()` → 从 `MpvMediaPlayer.getCurrentSession()` 转换
   - `onPlayerState()` → 监听 `MpvMediaPlayer` 的 `session-change` 事件

5. **保持渲染和时间轴**
   - 渲染管理器继续使用 `LibMPVController`
   - 时间轴逻辑保持不变

**兼容性考虑**：
- `CorePlayer` 接口保持不变
- `getPlayerState()` 返回 `PlayerState`（从 `PlaybackSession` 转换）
- 事件监听器保持兼容

### 步骤 5.3: 重构 playerState

**当前状态**：
- 使用 `PlayerState` 接口
- `PlayerStateMachine` 管理状态

**目标状态**：
- 使用 `PlaybackSession` 领域模型
- 保持事件兼容性

**实施步骤**：

1. **创建适配器**
   - 创建 `PlayerStateAdapter`，将 `PlaybackSession` 转换为 `PlayerState`
   - 或修改 `PlayerStateMachine` 内部使用 `PlaybackSession`

2. **迁移状态管理**
   - `getState()` → 返回从 `PlaybackSession` 转换的 `PlayerState`
   - `updateFromStatus()` → 使用 `MpvAdapter` 转换为 `PlaybackSession`

3. **保持事件兼容**
   - `on('state')` 事件继续发出 `PlayerState`
   - 内部使用 `PlaybackSession`

**兼容性考虑**：
- `PlayerState` 接口保持不变
- 事件格式保持不变
- 或创建适配层，内部使用 `PlaybackSession`，对外暴露 `PlayerState`

## 🔄 实施顺序

### 推荐顺序

1. **步骤 5.3**（playerState）- 影响最小，先建立适配层
2. **步骤 5.2**（corePlayer）- 建立 MediaPlayer 集成
3. **步骤 5.1**（videoPlayerApp）- 最后迁移应用层

### 原因

- playerState 是基础层，其他层依赖它
- corePlayer 是中间层，videoPlayerApp 依赖它
- videoPlayerApp 是应用层，最后迁移

## ⚠️ 注意事项

1. **保持向后兼容**
   - 所有公共接口保持不变
   - 事件格式保持不变
   - IPC 消息格式保持不变（阶段6处理）

2. **渐进式迁移**
   - 每个步骤完成后测试
   - 可以回滚到上一步

3. **窗口管理**
   - 窗口创建和管理逻辑保持不变
   - 窗口 ID 需要正确传递给 `MpvMediaPlayer`

4. **状态同步**
   - 确保 `PlaybackSession` 和 `PlayerState` 同步
   - 使用适配器统一转换

5. **渲染管理**
   - 渲染管理器继续使用 `LibMPVController`
   - 确保渲染逻辑不受影响

## 📝 实施检查清单

### 步骤 5.3: playerState
- [x] 创建 `PlayerStateAdapter`（PlaybackSession → PlayerState）→ 阶段 7 已移除，内联至 `playerState`
- [x] 修改 `PlayerStateMachine` 使用 `PlaybackSession`
- [x] 测试状态转换正确性
- [x] 测试事件兼容性

### 步骤 5.2: corePlayer
- [x] 创建 `MpvMediaPlayer` 实例
- [x] 迁移播放控制方法
- [x] 设置窗口 ID 到 `MpvMediaPlayer`
- [x] 状态转换（PlaybackSession → PlayerState）
- [x] 测试播放功能
- [x] 测试窗口管理
- [x] 测试渲染功能

### 步骤 5.1: videoPlayerApp
- [x] 创建 `ApplicationService` 实例
- [x] 迁移 `PlaylistManager` 到 `Playlist` → 阶段 7 已移除适配器，单一 `playlist` + `getList`/`setList` 等方法
- [x] 迁移播放控制方法（pause/resume/seek/setVolume/stop → ApplicationService）
- [x] 保持窗口管理逻辑
- [x] 测试播放列表功能
- [x] 测试播放控制功能

## 🧪 测试方案

### 功能测试
- [ ] 播放视频
- [ ] 暂停/恢复
- [ ] 跳转
- [ ] 音量控制
- [ ] 播放列表操作
- [ ] 窗口管理
- [ ] 渲染功能

### 兼容性测试
- [ ] IPC 消息正常
- [ ] 事件监听正常
- [ ] 状态查询正常

## 📚 相关文档

- [规划文档](PLANNING_SEMANTIC_REFACTORING.md)（阶段 7 清理时移除适配层）
- [架构文档](../ARCHITECTURE.md)
