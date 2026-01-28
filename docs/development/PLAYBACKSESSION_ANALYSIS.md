# PlaybackSession 必要性分析

## 1. 当前使用情况

### 1.1 PlaybackSession 的定义

**位置**：`src/main/domain/models/Playback.ts`

**包含字段**：
- `media: Media | null` - 当前播放的媒体
- `status: PlaybackStatus` - 播放状态（领域枚举）
- `progress: PlaybackProgress` - 播放进度（包含 percentage）
- `volume: number` - 音量
- `networkBuffering: NetworkBufferingState` - 网络缓冲状态
- `error: string | null` - 错误信息
- `isSeeking: boolean` - 是否正在跳转

**业务方法**：
- `isActive` - 是否处于活动状态（playing 或 paused）
- `canSeek` - 是否可以跳转（duration > 0 && isActive）
- `isPlaying` - 是否正在播放
- `isPaused` - 是否已暂停
- `hasError` - 是否处于错误状态

### 1.2 使用场景

| 使用位置 | 用途 | 是否必要 |
|---------|------|---------|
| `PlayerStateMachine` | 内部状态存储 | ✅ 必要 |
| `MpvMediaPlayer.getCurrentSession()` | 返回当前会话 | ⚠️ 可替代 |
| `MpvMediaPlayer.seek()` | 检查 `canSeek` | ✅ 必要（业务逻辑） |
| `VideoPlayerApp.playMedia()` | 检查状态决定是否恢复 | ⚠️ 可用 `getPlayerState()` 替代 |
| `CorePlayer.sessionChangeListener` | 状态更新（但实际用 `getStatus()`） | ❌ 不必要 |

### 1.3 与其他状态类型对比

| 类型 | 位置 | 用途 | 特点 |
|------|------|------|------|
| **PlaybackSession** | `domain/models/` | 领域模型，业务逻辑 | 包含业务方法（isActive, canSeek） |
| **PlayerStatus** | `application/core/` | 应用层状态接口 | 通用状态，无业务逻辑 |
| **PlayerState** | `application/state/` | 跨进程状态 | 从 PlaybackSession 转换而来 |

## 2. 必要性分析

### 2.1 支持保留的理由

1. **业务逻辑封装**
   - `canSeek` 逻辑：`duration > 0 && isActive`
   - `isActive` 逻辑：`status === PLAYING || status === PAUSED`
   - 这些业务规则应该封装在领域模型中

2. **领域模型价值**
   - `PlaybackSession` 是领域模型，表达业务概念
   - 包含 `Media` 对象，而不仅仅是 URI 字符串
   - 包含 `PlaybackProgress`（有 percentage 计算）

3. **PlayerStateMachine 内部状态**
   - `PlayerStateMachine` 使用 `PlaybackSession` 作为内部状态
   - 然后转换为 `PlayerState` 用于跨进程通信
   - 这是合理的分层设计

### 2.2 支持移除的理由

1. **数据冗余**
   - `PlaybackSession` 和 `PlayerStatus` 包含相同信息
   - 需要频繁转换：`MPVStatus` → `PlaybackSession` → `PlayerStatus`

2. **使用场景有限**
   - `getCurrentSession()` 仅 1 处使用，可用 `getPlayerState()` 替代
   - `onSessionChange()` 主要用于状态更新，但实际用 `getStatus()`

3. **业务逻辑可迁移**
   - `canSeek` 等业务逻辑可以移到应用层
   - 或者直接在 `PlayerStatus` 中添加计算属性

## 3. 架构位置分析

### 3.1 当前位置：领域层（domain/models/）

**优点**：
- ✅ 符合 DDD 原则：领域模型表达业务概念
- ✅ 业务逻辑封装在领域层
- ✅ 不依赖基础设施层

**缺点**：
- ⚠️ 需要从基础设施层（MPV）适配
- ⚠️ 与应用层状态（PlayerStatus）重复

### 3.2 如果移到应用层（application/core/）

**优点**：
- ✅ 更接近使用场景
- ✅ 减少跨层依赖

**缺点**：
- ❌ 违反 DDD 原则：领域模型应该在领域层
- ❌ 业务逻辑与应用层耦合

### 3.3 如果移除，业务逻辑放在哪里？

**选项 A：移到 PlayerStatus**
```typescript
interface PlayerStatus {
  // ... 现有字段
  get canSeek(): boolean  // 计算属性
  get isActive(): boolean
}
```

**选项 B：移到应用层服务**
```typescript
class PlaybackService {
  static canSeek(status: PlayerStatus): boolean {
    return status.duration > 0 && 
           (status.phase === 'playing' || status.phase === 'paused')
  }
}
```

**选项 C：保留在 PlayerStateMachine**
```typescript
class PlayerStateMachine {
  canSeek(): boolean {
    const state = this.getState()
    return state.duration > 0 && 
           (state.phase === 'playing' || state.phase === 'paused')
  }
}
```

## 4. 推荐方案

### 方案 1：保留 PlaybackSession，优化使用（推荐）

**理由**：
1. **领域模型价值**：`PlaybackSession` 是领域模型，应该保留
2. **业务逻辑封装**：`canSeek` 等业务规则应该在领域层
3. **PlayerStateMachine 内部状态**：使用 `PlaybackSession` 作为内部状态是合理的

**优化措施**：
1. **移除不必要的使用**：
   - `CorePlayer` 不再监听 `onSessionChange`（改用 `onStatusChange`）
   - `VideoPlayerApp` 使用 `getPlayerState()` 替代 `getCurrentSession()`

2. **保留必要的使用**：
   - `PlayerStateMachine` 内部状态（必须）
   - `MpvMediaPlayer.seek()` 中的 `canSeek` 检查（业务逻辑）

3. **简化接口**：
   - 保留 `getCurrentSession()`（向后兼容）
   - 移除 `onSessionChange()`（如果不再需要）

**架构位置**：保持在 `domain/models/`（领域层）

### 方案 2：移除 PlaybackSession，迁移业务逻辑

**如果决定移除**：

1. **业务逻辑迁移**：
   - `canSeek` → `PlayerStateMachine` 或 `CorePlayer`
   - `isActive` → `PlayerStateMachine` 或工具函数

2. **PlayerStateMachine 重构**：
   - 内部状态改为使用 `PlayerStatus` 或自定义结构
   - 移除 `PlaybackSession` 依赖

3. **接口简化**：
   - 移除 `getCurrentSession()` 和 `onSessionChange()`
   - 统一使用 `getStatus()` 和 `onStatusChange()`

**架构位置**：业务逻辑移到应用层（`application/core/` 或 `application/state/`）

## 5. 对比分析

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **保留 PlaybackSession** | 符合 DDD、业务逻辑封装、领域模型清晰 | 数据冗余、需要转换 | ⭐⭐⭐⭐⭐ |
| **移除 PlaybackSession** | 简化数据流、减少转换 | 业务逻辑分散、违反 DDD | ⭐⭐⭐ |

## 6. 最终建议

### 建议：保留 PlaybackSession，优化使用

**理由**：
1. **领域模型价值**：`PlaybackSession` 是领域模型，表达"播放会话"这个业务概念
2. **业务逻辑封装**：`canSeek` 等业务规则应该在领域层，而不是应用层
3. **架构清晰**：领域层 → 应用层 → 基础设施层的分层清晰
4. **PlayerStateMachine 设计**：使用领域模型作为内部状态，然后转换为应用层状态，这是合理的

**优化措施**：
1. 移除 `onSessionChange()` 在状态更新中的使用（改用 `onStatusChange`）
2. 保留 `getCurrentSession()` 用于业务逻辑查询
3. 保留 `PlaybackSession` 在 `PlayerStateMachine` 中的使用

**架构位置**：保持在 `domain/models/`（领域层）

## 7. 实施建议

### 短期（当前优化）
- 添加 `onStatusChange` 用于状态更新
- 移除 `CorePlayer` 对 `onSessionChange` 的依赖（状态更新）
- 保留 `PlaybackSession` 和 `getCurrentSession()`

### 长期（可选）
- 评估 `onSessionChange` 是否还有其他用途
- 如果确认不再需要，可以考虑移除 `onSessionChange()` 事件
- 但保留 `PlaybackSession` 类和 `getCurrentSession()` 方法
