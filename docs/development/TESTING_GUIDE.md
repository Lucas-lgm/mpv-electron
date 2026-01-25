# 语义化重构测试指南

> **创建日期**: 2026-01-25  
> **最后更新**: 2026-01-25  
> **状态**: 活跃  
> **适用范围**: 领域模型、适配器层、应用层测试

## 🚀 快速开始（推荐方法）

### 方法1：使用 IPC 命令（最简单）

```bash
# 1. 编译代码
npm run build

# 2. 启动应用
npm run dev

# 3. 在渲染进程控制台（浏览器控制台）运行：
window.electronAPI.send('test-semantic-refactoring')

# 4. 查看主进程控制台的输出
```

### 方法2：开发模式自动测试

应用已配置为在开发模式下自动运行测试：

```bash
# 启动开发模式（会自动运行测试）
NODE_ENV=development npm run dev
```

启动后，主进程控制台会自动显示测试结果。

---

## 📋 测试层次

### 1. 领域模型测试（可立即测试 ✅）

**测试范围**: `src/main/domain/models/`

**特点**: 
- 纯逻辑，无外部依赖
- 可以立即测试
- 不需要 Electron 环境

**测试方法**:

#### 在 Electron 主进程控制台测试

1. 启动应用：`npm run dev`
2. 打开主进程控制台（`Cmd+Option+I`，选择 Main Process）
3. 运行测试代码：

```javascript
// 测试 Media 模型
const { Media } = require('./out/main/domain/models/Media.js')
const media = Media.create('/test/video.mp4', { title: '测试视频' })
console.log('✅ Media:', media.displayName, media.isLocalFile)

// 测试 Playlist 模型  
const { Playlist } = require('./out/main/domain/models/Playlist.js')
const playlist = new Playlist()
playlist.add(media)
console.log('✅ Playlist size:', playlist.size)

// 测试 PlaybackSession
const { PlaybackSession, PlaybackStatus } = require('./out/main/domain/models/Playback.js')
const session = PlaybackSession.create(media, PlaybackStatus.PLAYING, { currentTime: 30, duration: 120 }, 75)
console.log('✅ Session:', session.isPlaying, session.canSeek)
```

**注意**: 由于 electron-vite 会将代码打包到单个 `main.js` 文件，如果上述方法不工作，请使用 IPC 命令（方法1）。

### 2. 适配器层测试

**测试范围**: `src/main/infrastructure/mpv/MpvAdapter.ts`

**测试方法**:

```javascript
// 在主进程控制台
const { MpvAdapter } = require('./out/main/infrastructure/mpv/MpvAdapter.js')
const { Media } = require('./out/main/domain/models/Media.js')

const media = Media.create('/test.mp4', { title: '测试' })
const mpvStatus = {
  position: 45,
  duration: 180,
  volume: 80,
  path: '/test.mp4',
  phase: 'playing',
  isSeeking: false,
  isNetworkBuffering: false,
  networkBufferingPercent: 0
}

const adapted = MpvAdapter.toPlaybackSession(mpvStatus, media)
console.log('✅ Adapter:', adapted.status, adapted.progress.percentage.toFixed(1) + '%')
```

### 3. 应用层测试

**测试范围**: `src/main/application/`

**测试方法**:

需要创建 `ApplicationService` 实例并测试各个命令和查询处理器。建议在 Electron 环境中进行集成测试。

---

## 🔍 检查编译后的文件

运行以下命令检查文件是否被编译：

```bash
# 检查领域模型文件
ls -la out/main/domain/models/

# 检查适配器文件
ls -la out/main/infrastructure/mpv/

# 检查应用层文件
ls -la out/main/application/
```

**注意**: electron-vite 只编译被 `main.ts` 直接或间接导入的文件。如果文件不存在，说明它们没有被导入。

---

## ⚠️ 常见问题

### 问题1：找不到模块

```
Error: Cannot find module './out/main/domain/models/Media.js'
```

**原因**: electron-vite 将所有代码打包到单个 `main.js` 文件中。

**解决**: 使用 IPC 命令测试（方法1），或使用开发模式自动测试（方法2）。

### 问题2：主进程控制台在哪里？

- 在 Electron 窗口中按 `Cmd+Option+I` (Mac) 或 `Ctrl+Shift+I` (Windows)
- 确保选择 **Main Process** 标签（不是 Renderer）

### 问题3：文件没有被编译

electron-vite 只编译被 `main.ts` 直接或间接导入的文件。

**解决**: 
- 使用 IPC 命令（推荐）
- 或确保测试文件被 `main.ts` 导入（已配置）

---

## 📝 测试检查清单

运行测试后，确认：

- [ ] Media 模型可以创建
- [ ] Media 属性访问正常
- [ ] Playlist 添加、删除、切换正常
- [ ] PlaybackSession 状态转换正确
- [ ] MpvAdapter 转换正确
- [ ] 无错误输出

---

## 🎯 推荐测试流程

### 快速验证

1. 编译：`npm run build`
2. 启动：`npm run dev`
3. 使用 IPC 命令：在渲染进程控制台运行 `window.electronAPI.send('test-semantic-refactoring')`
4. 查看主进程控制台输出

### 完整测试

1. 启动开发模式：`NODE_ENV=development npm run dev`
2. 查看自动运行的测试结果
3. 根据需要手动测试各个模型

---

## 📚 相关文件

- 测试代码：`src/main/test_semantic_refactoring.ts`
- IPC 处理器：`src/main/ipcHandlers.ts`（包含 `test-semantic-refactoring` 命令）
- 主入口：`src/main/main.ts`（开发模式下自动运行测试）
