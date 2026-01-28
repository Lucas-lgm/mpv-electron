# 状态更新机制优化计划

## 1. 当前问题分析

### 1.1 三层事件传递链条

**当前状态更新流程**：

```
LibMPVController
  └── 发出 'status' 事件 (MPVStatus)
      └── MpvMediaPlayer.setupEventHandlers()
          └── controller.on('status', (status) => {
                this.updateSessionFromStatus(status)  // MPVStatus → PlaybackSession
              })
              └── this.updateSession(session)
                  └── 发出 'session-change' 事件 (PlaybackSession)
                      └── CorePlayer.sessionChangeListener()
                          └── mediaPlayer.onSessionChange((session) => {
                                const status = mediaPlayer.getStatus()  // 调用 getStatus()
                                this.updateFromPlayerStatus(status)    // PlayerStatus → PlayerStateMachine
                              })
```

### 1.2 存在的问题

1. **事件传递冗余**
   - 3 层事件传递：`status` → `session-change` → `state`
   - 每次状态变化都要经过多次事件触发

2. **数据转换冗余**
   - `MPVStatus` → `PlaybackSession` → `PlayerStatus` → `PlayerStatus`
   - 中间层 `PlaybackSession` 在状态更新流程中作用有限

3. **职责不清**
   - `CorePlayer` 监听 `session-change`，但实际使用 `getStatus()`
   - `session` 参数基本被忽略（仅在 `getStatus()` 返回 null 时使用）

4. **性能开销**
   - 每次状态变化：3 次事件传递 + 3 次数据转换
   - 多次函数调用和内存分配

### 1.3 当前代码位置

- `MpvMediaPlayer.setupEventHandlers()` (第58-70行)
- `MpvMediaPlayer.updateSessionFromStatus()` (第102-107行)
- `MpvMediaPlayer.updateSession()` (第112-126行)
- `CorePlayer.sessionChangeListener()` (第90-114行)

## 2. 优化方案

### 2.1 核心思路

**添加 `onStatusChange` 事件，直接传递 `PlayerStatus`**，减少事件传递层数和数据转换次数。

### 2.2 优化后的流程

```
LibMPVController
  └── 发出 'status' 事件 (MPVStatus)
      └── MpvMediaPlayer.setupEventHandlers()
          └── controller.on('status', (status) => {
                // 同时更新 session（保留，用于 getCurrentSession）
                this.updateSessionFromStatus(status)
                
                // 直接发出 PlayerStatus 变化事件
                const playerStatus = this.adaptMPVStatusToPlayerStatus(status)
                this.emit('status-change', playerStatus)
              })
              └── CorePlayer.statusChangeListener()
                  └── mediaPlayer.onStatusChange((status) => {
                        this.updateFromPlayerStatus(status)  // 直接更新，无需转换
                      })
                      └── PlayerStateMachine.updateFromStatus(status)
```

**改进**：
- 事件传递：3 层 → 2 层
- 数据转换：3 次 → 1 次（MPVStatus → PlayerStatus）
- 职责清晰：状态更新用 `onStatusChange`，领域模型用 `onSessionChange`

### 2.3 接口设计

```typescript
// MediaPlayer 接口
interface MediaPlayer {
  // 新增：状态变化事件（用于状态更新）
  onStatusChange(listener: (status: PlayerStatus) => void): void
  offStatusChange(listener: (status: PlayerStatus) => void): void
  
  // 保留：会话管理（用于其他业务逻辑）
  getCurrentSession(): PlaybackSession | null
  onSessionChange(listener: (session: PlaybackSession) => void): void
  offSessionChange(listener: (session: PlaybackSession) => void): void
  
  // 保留：状态获取（用于轮询）
  getStatus(): PlayerStatus | null
}
```

**设计原则**：
- `onStatusChange`：用于状态更新（事件驱动）
- `onSessionChange`：用于业务逻辑（领域模型）
- `getStatus()`：用于轮询（Timeline 等）

## 3. 实施步骤

### 步骤 1：扩展 MediaPlayer 接口

**文件**：`src/main/application/core/MediaPlayer.ts`

```typescript
export interface MediaPlayer extends EventEmitter {
  // ... 现有方法
  
  // 新增：状态变化事件
  /**
   * 监听播放器状态变化
   * @param listener 状态变化回调，参数为 PlayerStatus
   * 注意：此事件用于状态更新，比 onSessionChange 更直接高效
   */
  onStatusChange(listener: (status: PlayerStatus) => void): void
  
  /**
   * 移除状态变化监听
   */
  offStatusChange(listener: (status: PlayerStatus) => void): void
}
```

### 步骤 2：实现 MpvMediaPlayer.onStatusChange

**文件**：`src/main/infrastructure/mpv/MpvMediaPlayer.ts`

```typescript
export class MpvMediaPlayer {
  private statusChangeListeners: Set<(status: PlayerStatus) => void> = new Set()
  
  // 新增方法
  onStatusChange(listener: (status: PlayerStatus) => void): void {
    this.statusChangeListeners.add(listener)
    
    // 如果已有状态，立即通知
    const currentStatus = this.getStatus()
    if (currentStatus) {
      try {
        listener(currentStatus)
      } catch (error) {
        console.error('[MpvMediaPlayer] Error in status change listener:', error)
      }
    }
  }
  
  offStatusChange(listener: (status: PlayerStatus) => void): void {
    this.statusChangeListeners.delete(listener)
  }
  
  // 修改 setupEventHandlers
  private setupEventHandlers(): void {
    if (!this.controller) return

    // 监听 MPV 状态变化
    this.controller.on('status', (status: MPVStatus) => {
      // 更新 session（保留，用于 getCurrentSession 和 onSessionChange）
      this.updateSessionFromStatus(status)
      
      // 直接发出 PlayerStatus 变化事件
      const playerStatus = this.adaptMPVStatusToPlayerStatus(status)
      this.statusChangeListeners.forEach(listener => {
        try {
          listener(playerStatus)
        } catch (error) {
          console.error('[MpvMediaPlayer] Error in status change listener:', error)
        }
      })
      this.emit('status-change', playerStatus)
    })
    
    // ... FPS 变化处理
  }
  
  // 修改 cleanup
  async cleanup(): Promise<void> {
    this.sessionChangeListeners.clear()
    this.statusChangeListeners.clear()  // 新增
    // ... 其他清理
  }
}
```

### 步骤 3：更新 CorePlayer 使用 onStatusChange

**文件**：`src/main/application/core/corePlayer.ts`

```typescript
class CorePlayerImpl {
  private statusChangeListener?: (status: PlayerStatus) => void
  
  constructor(mediaPlayer?: MediaPlayer) {
    // ... 其他初始化
    
    // 替换：使用 onStatusChange 替代 onSessionChange
    this.statusChangeListener = (status: PlayerStatus) => {
      // 直接更新状态机，无需转换
      this.updateFromPlayerStatus(status)
    }
    this.mediaPlayer.onStatusChange(this.statusChangeListener)
    
    // 移除：不再需要 sessionChangeListener
    // this.sessionChangeListener = ...
    // this.mediaPlayer.onSessionChange(this.sessionChangeListener)
  }
  
  async cleanup(): Promise<void> {
    // ... 其他清理
    
    // 移除 status change 监听
    if (this.statusChangeListener) {
      this.mediaPlayer.offStatusChange(this.statusChangeListener)
      this.statusChangeListener = undefined
    }
    
    // 移除：不再需要清理 sessionChangeListener
  }
  
  // 移除：不再需要 mapPlaybackStatusToPhase 方法
  // private mapPlaybackStatusToPhase(...) { ... }
}
```

### 步骤 4：验证 PlaybackSession 的使用

**检查点**：
- `getCurrentSession()` 的使用场景
- `onSessionChange()` 是否还有其他监听者
- 是否需要保留 `PlaybackSession` 相关功能

**文件**：`src/main/application/videoPlayerApp.ts`

```typescript
// 检查：第134行使用 getCurrentSession()
// 可以改为使用 getPlayerState()
const state = this.corePlayer.getPlayerState()
if (state.phase !== 'playing') {
  await this.corePlayer.resume()
}
```

### 步骤 5：更新文档

**文件**：
- `docs/ARCHITECTURE.md` - 更新状态更新机制说明
- `docs/development/PLAYER_STATE_DATAFLOW.md` - 更新数据流图

## 4. 风险评估

### 4.1 兼容性风险

**低风险**：
- `onSessionChange` 和 `getCurrentSession` 保留，不影响现有功能
- 仅新增 `onStatusChange`，不破坏现有接口

### 4.2 功能风险

**需要验证**：
- `getCurrentSession()` 的使用场景（仅 1 处，可替换）
- `onSessionChange()` 是否还有其他监听者（目前仅 CorePlayer 使用）

### 4.3 性能风险

**低风险**：
- 减少事件传递和数据转换，性能应该更好
- 需要验证高频状态更新场景

## 5. 测试计划

### 5.1 功能测试

- [ ] 播放视频，验证状态更新正常
- [ ] Timeline 正常更新
- [ ] RenderManager 正常渲染
- [ ] 暂停/恢复/跳转/音量控制正常
- [ ] 错误处理正常

### 5.2 性能测试

- [ ] 高频状态更新场景（快速 seek）
- [ ] 网络缓冲状态更新
- [ ] 内存使用情况

### 5.3 回归测试

- [ ] `getCurrentSession()` 功能正常（如果保留）
- [ ] `onSessionChange()` 功能正常（如果保留）
- [ ] 所有播放控制功能正常

## 6. 实施优先级

**优先级：中高**

**理由**：
- ✅ 明显改善代码质量和性能
- ✅ 改动范围可控，风险较低
- ✅ 为未来支持 VLC 等播放器做准备
- ⚠️ 需要验证现有功能不受影响

## 7. 后续优化（可选）

### 7.1 完全移除 session-change 事件（如果不需要）

如果确认 `PlaybackSession` 仅用于 `getCurrentSession()`，可以考虑：
- 保留 `getCurrentSession()` 方法
- 移除 `onSessionChange()` 事件（如果不再需要）

### 7.2 统一状态更新机制

未来可以考虑：
- `Timeline` 也使用 `onStatusChange` 事件（替代轮询）
- 进一步减少轮询开销

## 8. 实施时间估算

- **步骤 1-3**：核心实现（1-2 小时）
- **步骤 4**：验证和调整（30 分钟）
- **步骤 5**：文档更新（30 分钟）
- **测试**：功能测试和验证（1 小时）

**总计**：约 3-4 小时

## 9. 回滚方案

如果出现问题，可以：
1. 保留 `onStatusChange` 实现
2. 恢复 `CorePlayer` 使用 `onSessionChange`
3. 两个事件机制并存，逐步迁移
