# PlaybackStatus vs PlayerPhase 命名分析

## 1. 当前情况

### PlaybackStatus（领域层枚举）
**位置**：`src/main/domain/models/Playback.ts`

**定义**：
```typescript
export enum PlaybackStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  PLAYING = 'playing',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ENDED = 'ended',
  ERROR = 'error'
}
```

**用途**：
- 领域模型 `PlaybackSession` 的状态字段
- 领域层的语义化枚举

### PlayerPhase（应用层类型）
**位置**：`src/main/application/state/playerStateTypes.ts`

**定义**：
```typescript
export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
```

**用途**：
- `PlayerStatus.phase` 字段的类型
- 应用层的字符串字面量联合类型

## 2. 问题分析

### 2.1 数据重复
- `PlaybackStatus` 枚举的值与 `PlayerPhase` 类型完全一致
- 两者表示相同的状态集合

### 2.2 类型转换
当前代码中存在多处类型转换：
```typescript
// 从 PlaybackStatus 转换为 PlayerPhase
const phase = session.status as unknown as PlayerPhase

// 从 PlayerPhase 转换为 PlaybackStatus
function phaseToStatus(p: PlayerPhase): PlaybackStatus {
  return p as unknown as PlaybackStatus
}
```

### 2.3 使用场景
- `PlaybackStatus`：用于领域模型（`PlaybackSession`）
- `PlayerPhase`：用于应用层状态（`PlayerStatus`）

## 3. 优化方案

### 方案 1：统一使用 PlaybackStatus（推荐）

**思路**：在应用层也使用 `PlaybackStatus` 枚举，而不是字符串字面量类型

**优点**：
- ✅ 消除数据重复
- ✅ 减少类型转换
- ✅ 类型更安全（枚举比字符串字面量更严格）
- ✅ 保持领域层的语义化

**缺点**：
- ⚠️ 需要修改 `PlayerStatus.phase` 的类型定义
- ⚠️ 应用层依赖领域层（但这是合理的，因为状态概念来自领域）

**实施**：
1. 将 `PlayerStatus.phase` 改为 `PlaybackStatus` 类型
2. 移除 `PlayerPhase` 类型（或保留为 `PlaybackStatus` 的别名）
3. 更新所有使用 `PlayerPhase` 的地方

### 方案 2：统一使用 PlayerPhase

**思路**：在领域层也使用字符串字面量类型，移除 `PlaybackStatus` 枚举

**优点**：
- ✅ 消除数据重复
- ✅ 减少类型转换

**缺点**：
- ❌ 失去枚举的类型安全性
- ❌ 失去领域层的语义化（枚举比字符串字面量更有意义）
- ❌ 违反 DDD 原则（领域层应该使用领域概念）

### 方案 3：保留两者，但建立明确关系

**思路**：保留 `PlaybackStatus` 和 `PlayerPhase`，但通过类型工具建立关系

**优点**：
- ✅ 保持领域层和应用层的分离
- ✅ 不需要大量修改

**缺点**：
- ⚠️ 仍然存在数据重复
- ⚠️ 仍然需要类型转换

## 4. 推荐方案

### 推荐：方案 1（统一使用 PlaybackStatus）

**理由**：
1. **领域驱动设计**：状态概念来自领域层，应用层应该使用领域层的类型
2. **类型安全**：枚举比字符串字面量类型更安全，编译时检查更严格
3. **消除转换**：不需要在 `PlaybackStatus` 和 `PlayerPhase` 之间转换
4. **语义清晰**：`PlaybackStatus` 作为枚举，语义更清晰

**实施步骤**：
1. 将 `PlayerStatus.phase` 改为 `PlaybackStatus` 类型
2. 将 `PlayerPhase` 改为 `PlaybackStatus` 的别名（向后兼容）
3. 更新所有使用 `PlayerPhase` 的地方，直接使用 `PlaybackStatus`
4. 移除不必要的类型转换

**示例**：
```typescript
// 之前
interface PlayerStatus {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'
}

// 之后
interface PlayerStatus {
  phase: PlaybackStatus
}

// PlayerPhase 作为别名
export type PlayerPhase = PlaybackStatus
```

## 5. 架构考虑

### 5.1 依赖方向
- 应用层依赖领域层是合理的（符合 DDD）
- 领域层不应该依赖应用层

### 5.2 类型安全
- 枚举提供更好的类型安全
- 字符串字面量类型在运行时没有保护

### 5.3 可维护性
- 统一使用一个类型，减少维护成本
- 状态值的修改只需要在一个地方

## 6. 最终建议

**统一使用 `PlaybackStatus` 枚举**，将 `PlayerPhase` 改为 `PlaybackStatus` 的别名。

这样可以：
- 保持领域层的语义化
- 提高类型安全性
- 减少类型转换
- 简化代码维护
