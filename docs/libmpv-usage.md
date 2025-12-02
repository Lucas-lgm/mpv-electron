# libmpv 使用指南

## 概述

项目现在支持两种 MPV 集成方式：

1. **libmpv Native Binding**（推荐）：真正的窗口嵌入，同一进程内运行
2. **IPC 模式**（回退）：通过命令行启动 mpv 进程，通过 IPC socket 通信

系统会自动选择最佳方式：如果有窗口句柄且 libmpv 可用，优先使用 libmpv；否则使用 IPC 模式。

## 构建步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 确保系统已安装 mpv

```bash
brew install mpv
```

### 3. 构建 Native Binding

```bash
npm run build:native
```

构建成功后，native binding 会生成在 `native/build/Release/mpv_binding.node`

## 使用方式

### 自动模式（推荐）

代码已经自动集成，无需额外配置。`MPVManager` 会自动：

1. 检查 libmpv 是否可用
2. 如果有窗口句柄，优先使用 libmpv（真正嵌入）
3. 如果 libmpv 不可用或失败，自动回退到 IPC 模式

```typescript
// 在 ipcHandlers.ts 中已经自动使用
await mpvManager.playVideo(filePath)
```

### 手动检查模式

```typescript
import { mpvManager } from './mpvManager'

// 检查当前使用的模式
if (mpvManager.isUsingLibMPV()) {
  console.log('使用 libmpv 模式（真正嵌入）')
} else {
  console.log('使用 IPC 模式（独立窗口）')
}
```

## 功能对比

| 功能 | libmpv 模式 | IPC 模式 |
|------|------------|----------|
| 窗口嵌入 | ✅ 真正嵌入（macOS） | ❌ 不支持（macOS 限制） |
| 性能 | ✅ 更好（同一进程） | ⚠️ 良好（跨进程） |
| 延迟 | ✅ 更低 | ⚠️ 稍高 |
| 依赖 | ✅ 需要构建 native | ✅ 只需系统 mpv |
| 稳定性 | ✅ 高 | ✅ 高 |

## 调试

### 检查 libmpv 是否加载

查看控制台日志：
- `[libmpv] ✅ Native binding loaded from: ...` - 成功加载
- `[libmpv] ⚠️ Native binding not found` - 未找到，使用 IPC 模式

### 检查当前模式

```typescript
console.log('Using libmpv:', mpvManager.isUsingLibMPV())
```

### 常见问题

1. **"Native binding not found"**
   - 确保已运行 `npm run build:native`
   - 检查 `native/build/Release/mpv_binding.node` 是否存在

2. **"libmpv native binding is not available"**
   - 检查系统是否安装了 mpv：`brew list mpv`
   - 检查 libmpv 库是否存在：`ls -la /opt/homebrew/opt/mpv/lib/libmpv.dylib`

3. **构建失败**
   - 确保已安装 Xcode Command Line Tools
   - 检查 `binding.gyp` 中的路径是否正确

## 代码结构

```
src/main/
├── libmpv.ts          # libmpv native binding 包装
├── mpvController.ts   # IPC 模式控制器
├── mpvManager.ts      # 统一管理器（自动选择模式）
└── ipcHandlers.ts     # IPC 处理器（已集成）
```

## 下一步

- [ ] 添加更多 libmpv 功能（字幕、滤镜等）
- [ ] 优化事件处理性能
- [ ] 添加渲染 API 支持（OpenGL）
