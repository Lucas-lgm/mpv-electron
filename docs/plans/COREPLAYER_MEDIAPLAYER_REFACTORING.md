# CorePlayer 与 MediaPlayer 职责统一重构计划

## 1. 问题分析

### 1.1 当前架构问题

**职责混乱**：
- `VideoPlayerApp` 同时使用 `corePlayer` 和 `mediaPlayer`（通过 `corePlayer.getMediaPlayer()`）
- `CorePlayer` 接口定义了播放控制方法（`play`, `pause`, `resume`, `stop`, `seek`, `setVolume`）
- 但 `VideoPlayerApp` **不使用** `CorePlayer` 的这些方法，而是直接调用 `mediaPlayer` 的方法

**调用关系混乱**：

| 操作 | VideoPlayerApp 实际调用 | CorePlayer 是否提供 | 问题 |
|------|----------------------|-------------------|------|
| 播放 | `mediaPlayer.play()` | ✅ `corePlayer.play()` | 绕过 CorePlayer |
| 暂停 | `mediaPlayer.pause()` | ✅ `corePlayer.pause()` | 绕过 CorePlayer |
| 恢复 | `mediaPlayer.resume()` | ✅ `corePlayer.resume()` | 绕过 CorePlayer |
| 停止 | `mediaPlayer.stop()` | ✅ `corePlayer.stop()` | 绕过 CorePlayer |
| 跳转 | `mediaPlayer.seek()` | ✅ `corePlayer.seek()` | 绕过 CorePlayer |
| 音量 | `mediaPlayer.setVolume()` | ✅ `corePlayer.setVolume()` | 绕过 CorePlayer |
| 会话查询 | `mediaPlayer.getCurrentSession()` | ❌ 无 | 需要添加 |
| 窗口管理 | `corePlayer.setVideoWindow()` | ✅ | 正确 |
| 状态查询 | `corePlayer.getPlayerState()` | ✅ | 正确 |

### 1.2 架构层次问题

**当前依赖关系**：
```
VideoPlayerApp (应用层)
    ├── corePlayer: CorePlayer (应用层)
    │       └── mediaPlayer: MpvMediaPlayer (基础设施层)
    └── mediaPlayer (通过 getter 直接访问基础设施层) ❌
```

**问题**：
1. **违反依赖倒置原则**：应用层（VideoPlayerApp）直接依赖基础设施层（MediaPlayer）
2. **职责重叠**：CorePlayer 定义了播放控制方法但不用，成了"死代码"
3. **维护困难**：播放控制逻辑分散在两个地方（CorePlayer 和 VideoPlayerApp）

### 1.3 影响范围

**需要修改的文件**：
- `src/main/application/videoPlayerApp.ts` - 9 处 `mediaPlayer` 调用
- `src/main/application/core/corePlayer.ts` - 需要增强接口

**影响的功能**：
- 播放控制（play/pause/resume/stop/seek/volume）
- 播放会话查询（getCurrentSession）
- 播放状态管理

## 2. 重构目标

### 2.1 架构目标

1. **统一入口**：所有播放控制都通过 `CorePlayer`，`VideoPlayerApp` 不再直接访问 `MediaPlayer`
2. **职责清晰**：
   - `CorePlayer`：MPV 桥接层，封装所有播放相关操作
   - `MediaPlayer`：播放契约接口，由 `CorePlayer` 内部使用
   - `VideoPlayerApp`：应用协调层，只依赖 `CorePlayer`
3. **符合依赖倒置**：应用层不直接依赖基础设施层

### 2.2 目标架构

```
VideoPlayerApp (应用层)
    └── corePlayer: CorePlayer (应用层)
            ├── mediaPlayer: MpvMediaPlayer (基础设施层)
            ├── controller: LibMPVController
            ├── stateMachine: PlayerStateMachine
            └── timeline: Timeline
```

## 3. 重构方案

### 3.1 方案概述

**核心思路**：`VideoPlayerApp` 统一通过 `CorePlayer` 进行播放控制，删除对 `MediaPlayer` 的直接访问。

### 3.2 详细修改点

#### 阶段 1：增强 CorePlayer 接口

**文件**：`src/main/application/core/corePlayer.ts`

**修改内容**：
1. **修改 `play()` 方法签名**：
   ```typescript
   // 当前
   play(filePath: string): Promise<void>
   
   // 修改为
   play(media: Media): Promise<void>
   ```

2. **添加 `getCurrentSession()` 方法**：
   ```typescript
   getCurrentSession(): PlaybackSession | null
   ```

3. **确保所有播放控制方法完整**：
   - ✅ `play(media: Media)` - 需要修改
   - ✅ `pause()` - 已实现
   - ✅ `resume()` - 已实现
   - ✅ `stop()` - 已实现
   - ✅ `seek(time: number)` - 已实现
   - ✅ `setVolume(volume: number)` - 已实现
   - ❌ `getCurrentSession()` - 需要添加

#### 阶段 2：修改 VideoPlayerApp

**文件**：`src/main/application/videoPlayerApp.ts`

**修改内容**：
1. **删除 `get mediaPlayer()` getter**（第 116-118 行）

2. **修改 `playMedia()` 方法**（第 121-144 行）：
   ```typescript
   // 当前
   await this.mediaPlayer.play(media)
   await this.mediaPlayer.setVolume(...)
   await this.mediaPlayer.resume()
   const session = this.mediaPlayer.getCurrentSession()
   
   // 修改为
   await this.corePlayer.play(media)
   await this.corePlayer.setVolume(...)
   await this.corePlayer.resume()
   const session = this.corePlayer.getCurrentSession()
   ```

3. **修改播放控制方法**（第 146-165 行）：
   ```typescript
   // 当前
   async pausePlayback(): Promise<void> {
     await this.mediaPlayer.pause()
   }
   
   // 修改为
   async pausePlayback(): Promise<void> {
     await this.corePlayer.pause()
   }
   
   // 其他方法类似：resumePlayback, seek, setVolume, stopPlayback
   ```

#### 阶段 3：更新 CorePlayer 实现

**文件**：`src/main/application/core/corePlayer.ts`

**修改内容**：
1. **修改 `play()` 方法实现**（第 276-288 行）：
   ```typescript
   // 当前
   async play(filePath: string): Promise<void> {
     const windowId = await this.prepareControllerForPlayback()
     if (!windowId) return
     try {
       this.resetState()
       await this.mediaPlayer.play(Media.create(filePath))
       await this.syncWindowSize()
     } catch {
       this.useLibMPV = false
     }
   }
   
   // 修改为
   async play(media: Media): Promise<void> {
     const windowId = await this.prepareControllerForPlayback()
     if (!windowId) {
       throw new Error('Failed to prepare controller for playback')
     }
     try {
       this.resetState()
       await this.mediaPlayer.play(media)
       await this.syncWindowSize()
     } catch (error) {
       this.useLibMPV = false
       throw error
     }
   }
   ```

2. **添加 `getCurrentSession()` 方法**：
   ```typescript
   getCurrentSession(): PlaybackSession | null {
     return this.mediaPlayer.getCurrentSession()
   }
   ```

3. **优化错误处理**：
   - 统一错误处理逻辑
   - 确保错误能正确向上传播

#### 阶段 4：更新接口定义

**文件**：`src/main/application/core/corePlayer.ts`

**修改内容**：
```typescript
export interface CorePlayer extends EventEmitter {
  // ... 其他方法
  
  // 修改签名
  play(media: Media): Promise<void>  // 从 string 改为 Media
  
  // 添加新方法
  getCurrentSession(): PlaybackSession | null
}
```

## 4. 实施步骤

### 步骤 1：准备阶段

- [ ] 创建功能分支：`refactor/coreplayer-mediaplayer-unification`
- [ ] 阅读相关代码，确认所有调用点
- [ ] 编写测试用例（如果有）

### 步骤 2：修改 CorePlayer 接口和实现

- [ ] 修改 `CorePlayer` 接口，`play()` 接受 `Media` 对象
- [ ] 添加 `getCurrentSession()` 方法到接口
- [ ] 修改 `CorePlayerImpl.play()` 实现
- [ ] 实现 `CorePlayerImpl.getCurrentSession()`
- [ ] 优化错误处理

**验证点**：
- TypeScript 编译通过
- 接口定义完整

### 步骤 3：修改 VideoPlayerApp

- [ ] 删除 `get mediaPlayer()` getter
- [ ] 修改 `playMedia()` 方法，使用 `corePlayer` 替代 `mediaPlayer`
- [ ] 修改 `pausePlayback()` 方法
- [ ] 修改 `resumePlayback()` 方法
- [ ] 修改 `seek()` 方法
- [ ] 修改 `setVolume()` 方法
- [ ] 修改 `stopPlayback()` 方法

**验证点**：
- TypeScript 编译通过
- 所有 `mediaPlayer` 引用已移除

### 步骤 4：测试验证

- [ ] 功能测试：播放、暂停、恢复、停止、跳转、音量
- [ ] 状态测试：播放状态查询、会话查询
- [ ] 错误测试：播放失败、窗口创建失败
- [ ] 集成测试：完整播放流程

### 步骤 5：代码审查和清理

- [ ] 检查是否有遗漏的 `mediaPlayer` 引用
- [ ] 检查错误处理是否完整
- [ ] 更新相关文档
- [ ] 代码审查

### 步骤 6：合并和文档

- [ ] 合并到主分支
- [ ] 更新架构文档
- [ ] 更新 API 文档

## 5. 风险评估

### 5.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `CorePlayer.play()` 修改可能影响现有调用 | 中 | 检查是否有其他地方调用 `corePlayer.play()` |
| 错误处理不当导致播放失败 | 中 | 完善错误处理，添加日志 |
| 状态同步问题 | 低 | 确保状态机正常工作 |

### 5.2 兼容性风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 接口变更影响其他模块 | 低 | 检查所有 `CorePlayer` 的使用 |
| 播放流程中断 | 中 | 充分测试播放流程 |

## 6. 测试计划

### 6.1 单元测试

- [ ] `CorePlayer.play()` 接受 `Media` 对象
- [ ] `CorePlayer.getCurrentSession()` 返回正确会话
- [ ] `VideoPlayerApp` 所有播放控制方法正常工作

### 6.2 集成测试

- [ ] 完整播放流程：选择文件 → 播放 → 暂停 → 恢复 → 停止
- [ ] 播放列表切换
- [ ] 音量控制
- [ ] 跳转功能
- [ ] 窗口管理

### 6.3 回归测试

- [ ] 所有现有功能正常
- [ ] 错误处理正常
- [ ] 状态管理正常

## 7. 回滚方案

如果重构出现问题，可以：

1. **立即回滚**：使用 git revert 回滚到重构前的版本
2. **部分回滚**：只回滚有问题的部分，保留其他修改
3. **临时方案**：保留 `get mediaPlayer()` getter 作为临时方案，逐步迁移

## 8. 后续优化

重构完成后，可以考虑：

1. **移除 `getMediaPlayer()` 方法**：如果不再需要直接访问 `MediaPlayer`
2. **统一错误处理**：在 `CorePlayer` 中统一处理播放错误
3. **性能监控**：在 `CorePlayer` 中添加性能监控点
4. **日志统一**：统一播放控制的日志格式

## 9. 时间估算

- **准备阶段**：0.5 天
- **CorePlayer 修改**：1 天
- **VideoPlayerApp 修改**：0.5 天
- **测试验证**：1 天
- **代码审查和文档**：0.5 天

**总计**：约 3.5 天

## 10. 成功标准

- [ ] 所有播放控制都通过 `CorePlayer`
- [ ] `VideoPlayerApp` 不再直接访问 `MediaPlayer`
- [ ] 所有功能测试通过
- [ ] 代码编译无错误
- [ ] 架构文档已更新
