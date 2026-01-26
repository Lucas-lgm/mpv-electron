# 主进程目录重组方案

## 1. 目标

将主进程根目录的文件按 DDD 分层原则重组到 `application/`、`domain/`、`infrastructure/` 文件夹中，提高代码组织清晰度。

## 2. 文件分类方案

### 2.1 Infrastructure（基础设施层）

**职责**：技术实现细节，平台特定代码，外部依赖封装

```
src/main/infrastructure/
├── mpv/
│   ├── MpvAdapter.ts          # 已有
│   ├── MpvMediaPlayer.ts      # 已有
│   └── libmpv.ts              # 移动：MPV 原生绑定
├── platform/
│   └── nativeHelper.ts        # 移动：平台窗口句柄
└── rendering/
    └── renderManager.ts       # 移动：渲染循环管理
```

**文件说明**：
- `libmpv.ts` → `infrastructure/mpv/libmpv.ts`：MPV 原生绑定封装
- `nativeHelper.ts` → `infrastructure/platform/nativeHelper.ts`：平台窗口句柄（NSView/HWND）
- `renderManager.ts` → `infrastructure/rendering/renderManager.ts`：渲染循环管理

### 2.2 Application（应用层）

**职责**：用例协调、状态管理、窗口管理、IPC 处理

```
src/main/application/
├── ApplicationService.ts       # 已有
├── commands/                   # 已有
├── queries/                    # 已有
├── core/
│   └── corePlayer.ts          # 移动：播放协调器
├── state/
│   ├── playerState.ts         # 移动：状态机
│   └── playerStateTypes.ts   # 移动：状态类型
├── timeline/
│   └── timeline.ts            # 移动：时间轴管理
├── windows/
│   └── windowManager.ts       # 移动：窗口管理
├── presentation/
│   └── ipcHandlers.ts         # 移动：IPC 处理
└── videoPlayerApp.ts          # 移动：顶层应用协调器
```

**文件说明**：
- `corePlayer.ts` → `application/core/corePlayer.ts`：播放协调器
- `playerState.ts` → `application/state/playerState.ts`：状态机
- `playerStateTypes.ts` → `application/state/playerStateTypes.ts`：状态类型
- `timeline.ts` → `application/timeline/timeline.ts`：时间轴
- `windowManager.ts` → `application/windows/windowManager.ts`：窗口管理
- `ipcHandlers.ts` → `application/presentation/ipcHandlers.ts`：IPC 处理
- `videoPlayerApp.ts` → `application/videoPlayerApp.ts`：顶层协调器

### 2.3 Domain（领域层）

**保持不变**：
```
src/main/domain/
├── models/
│   ├── Media.ts
│   ├── Playback.ts
│   └── Playlist.ts
└── services/
    └── MediaPlayer.ts
```

### 2.4 根目录保留

```
src/main/
├── main.ts                    # 入口文件，保留在根目录
└── test_semantic_refactoring.ts  # 测试文件，可移至 __tests__/
```

## 3. 导入路径更新

### 3.1 需要更新的导入

所有文件移动后，需要更新以下导入路径：

1. **main.ts**：
   - `./videoPlayerApp` → `./application/videoPlayerApp`

2. **application/videoPlayerApp.ts**：
   - `./windowManager` → `./windows/windowManager`
   - `./corePlayer` → `./core/corePlayer`
   - `./ipcHandlers` → `./presentation/ipcHandlers`

3. **application/core/corePlayer.ts**：
   - `./playerState` → `../state/playerState`
   - `./libmpv` → `../../infrastructure/mpv/libmpv`
   - `./nativeHelper` → `../../infrastructure/platform/nativeHelper`
   - `./timeline` → `../timeline/timeline`
   - `./renderManager` → `../../infrastructure/rendering/renderManager`

4. **application/presentation/ipcHandlers.ts**：
   - `./videoPlayerApp` → `../videoPlayerApp`
   - `./corePlayer` → `../core/corePlayer`

5. **其他文件**：根据依赖关系更新路径

### 3.2 循环依赖风险

移动后需要检查：
- `corePlayer` 依赖 `playerState`、`timeline`、`renderManager`、`libmpv`、`nativeHelper`
- `videoPlayerApp` 依赖 `corePlayer`、`windowManager`、`ipcHandlers`
- `ipcHandlers` 依赖 `videoPlayerApp`、`corePlayer`

**注意**：`ipcHandlers` 调用 `setupIpcHandlers()`，而 `videoPlayerApp` 的 `init()` 调用 `setupIpcHandlers()`，需要确保导入顺序正确。

## 4. 利弊分析

### 4.1 优点

✅ **清晰的层次结构**：按 DDD 分层组织，职责明确  
✅ **易于维护**：相关文件集中，便于查找和修改  
✅ **符合最佳实践**：遵循领域驱动设计原则  
✅ **降低耦合**：基础设施与应用层分离

### 4.2 缺点

❌ **大量导入路径更新**：需要修改所有相关文件的导入  
❌ **重构成本高**：需要仔细测试，确保无遗漏  
❌ **可能影响构建**：路径变更可能导致构建工具配置调整  
❌ **当前结构已较清晰**：根目录文件不多，组织已相对合理

## 5. 实施建议

### 5.1 推荐方案：渐进式重构

**阶段 1：基础设施层**（低风险）
1. 移动 `libmpv.ts` → `infrastructure/mpv/libmpv.ts`
2. 移动 `nativeHelper.ts` → `infrastructure/platform/nativeHelper.ts`
3. 移动 `renderManager.ts` → `infrastructure/rendering/renderManager.ts`
4. 更新所有导入路径
5. 测试构建和运行

**阶段 2：应用层状态与时间轴**（中风险）
1. 移动 `playerState.ts` → `application/state/playerState.ts`
2. 移动 `playerStateTypes.ts` → `application/state/playerStateTypes.ts`
3. 移动 `timeline.ts` → `application/timeline/timeline.ts`
4. 更新导入路径
5. 测试

**阶段 3：应用层核心**（高风险）
1. 移动 `windowManager.ts` → `application/windows/windowManager.ts`
2. 移动 `corePlayer.ts` → `application/core/corePlayer.ts`
3. 移动 `ipcHandlers.ts` → `application/presentation/ipcHandlers.ts`
4. 移动 `videoPlayerApp.ts` → `application/videoPlayerApp.ts`
5. 更新 `main.ts` 导入
6. 全面测试

### 5.2 替代方案：保持现状

如果当前结构已满足需求，可以考虑：
- 在文档中明确说明各文件的层级归属
- 通过注释和命名约定体现分层
- 仅在必要时进行局部重构

## 6. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 导入路径错误 | 高 | 使用 IDE 重构工具，批量替换后验证 |
| 循环依赖 | 中 | 检查依赖图，必要时引入接口抽象 |
| 构建失败 | 中 | 分阶段重构，每阶段验证构建 |
| 功能回归 | 高 | 全面功能测试，覆盖播放、暂停、seek 等 |

## 7. 决策建议

**建议**：如果团队希望严格遵循 DDD 分层，可以执行渐进式重构。如果当前结构已足够清晰且团队熟悉，可以暂缓重构，优先关注功能开发。

**如果决定重构**：
1. 先在分支进行
2. 分阶段执行，每阶段验证
3. 更新架构文档
4. 确保测试覆盖

**如果暂缓重构**：
1. 在架构文档中明确各文件的层级归属
2. 通过代码注释和命名体现分层意图
3. 保持当前清晰的目录结构

---

## 8. 执行记录

### 阶段 1：基础设施层（已完成）

- ✅ `libmpv.ts` → `infrastructure/mpv/libmpv.ts`
- ✅ `nativeHelper.ts` → `infrastructure/platform/nativeHelper.ts`
- ✅ `renderManager.ts` → `infrastructure/rendering/renderManager.ts`
- ✅ 更新 corePlayer、playerState、timeline、test_semantic_refactoring、MpvAdapter、MpvMediaPlayer、renderManager 的导入路径
- ✅ 构建通过

### 阶段 2：应用层状态与时间轴（已完成）

- ✅ `playerState.ts` → `application/state/playerState.ts`
- ✅ `playerStateTypes.ts` → `application/state/playerStateTypes.ts`
- ✅ `timeline.ts` → `application/timeline/timeline.ts`
- ✅ 更新 corePlayer、renderManager、MpvAdapter、test_semantic_refactoring 及上述迁移文件内部导入路径
- ✅ 构建通过

### 阶段 3：应用层核心（已完成）

- ✅ `windowManager.ts` → `application/windows/windowManager.ts`（更新 preload/renderer 路径）
- ✅ `corePlayer.ts` → `application/core/corePlayer.ts`（更新所有导入路径）
- ✅ `ipcHandlers.ts` → `application/presentation/ipcHandlers.ts`（更新导入路径）
- ✅ `videoPlayerApp.ts` → `application/videoPlayerApp.ts`（更新导入路径与 __dirname 路径）
- ✅ 更新 `main.ts` 导入路径
- ✅ 构建通过
