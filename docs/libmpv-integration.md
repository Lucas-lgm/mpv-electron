# libmpv Native Binding 集成指南

## 概述

这个项目现在包含了 mpv 的 Node.js native binding 层，可以直接在 Electron 主进程中使用 libmpv C API。与通过命令行启动 mpv 进程不同，使用 libmpv 可以在**同一进程内**真正嵌入视频窗口到 Electron 窗口中。

## 为什么需要 libmpv？

### 问题：macOS 跨进程窗口嵌入限制

macOS 系统不允许跨进程窗口嵌入。这意味着：
- ❌ 不能通过 `spawn('mpv', ['--wid=...'])` 将 mpv 嵌入到 Electron 窗口
- ❌ 即使传递了窗口句柄，mpv 进程也无法访问 Electron 窗口
- ✅ 使用 libmpv 可以在同一进程内真正嵌入窗口

### 解决方案：libmpv Native Binding

通过 libmpv native binding：
- ✅ 在同一进程内运行，可以真正嵌入窗口
- ✅ 更好的性能和更低的延迟
- ✅ 更精细的控制和事件处理

## 构建步骤

### 1. 安装 libmpv（通过 Homebrew）

最简单的方式是使用 Homebrew 安装 mpv，它包含了 libmpv：

```bash
brew install mpv
```

这会安装 mpv 和 libmpv 到 `/opt/homebrew/opt/mpv`（Apple Silicon）或 `/usr/local/opt/mpv`（Intel Mac）。

### 2. 构建 Native Binding

```bash
npm run build:native
```

或者：

```bash
cd native
node-gyp rebuild
```

## 使用示例

### 基本使用

```typescript
import { LibMPVController, isLibMPVAvailable } from './libmpv'
import { BrowserWindow } from 'electron'
import { getNSViewPointer } from './nativeHelper'

// 检查是否可用
if (!isLibMPVAvailable()) {
  console.error('libmpv native binding not available')
  // 回退到 IPC 模式
  return
}

// 创建控制器
const controller = new LibMPVController()

// 初始化
await controller.initialize()

// 获取 Electron 窗口句柄
const videoWindow = BrowserWindow.getFocusedWindow()
if (videoWindow) {
  const windowId = getNSViewPointer(videoWindow)
  if (windowId) {
    // 设置窗口 ID，将视频嵌入到 Electron 窗口
    await controller.setWindowId(windowId)
  }
}

// 加载并播放视频
await controller.loadFile('/path/to/video.mp4')

// 监听事件
controller.on('status', (status) => {
  console.log('播放状态:', {
    paused: status.paused,
    position: status.position,
    duration: status.duration,
    volume: status.volume
  })
})

controller.on('ended', () => {
  console.log('播放结束')
})

// 控制播放
await controller.play()
await controller.pause()
await controller.seek(100) // 跳转到 100 秒
await controller.setVolume(50) // 设置音量为 50%

// 清理
await controller.destroy()
```

### 与现有代码集成

可以修改 `mpvManager.ts` 来支持 libmpv：

```typescript
import { LibMPVController, isLibMPVAvailable } from './libmpv'
import { MPVController } from './mpvController' // 原有的 IPC 控制器

class MPVManager {
  private controller: LibMPVController | MPVController | null = null
  private useLibMPV: boolean = false

  async playVideo(filePath: string, window?: BrowserWindow): Promise<void> {
    // 优先使用 libmpv（如果可用）
    if (isLibMPVAvailable() && window) {
      this.useLibMPV = true
      this.controller = new LibMPVController()
      await this.controller.initialize()
      
      const windowId = getNSViewPointer(window)
      if (windowId) {
        await this.controller.setWindowId(windowId)
      }
      
      await this.controller.loadFile(filePath)
    } else {
      // 回退到 IPC 模式
      this.useLibMPV = false
      this.controller = new MPVController()
      // ... 原有的 IPC 代码
    }
  }
}
```

## API 参考

### LibMPVController

#### 方法

- `initialize()`: 初始化 MPV 实例
- `setWindowId(windowId: number)`: 设置窗口 ID（用于嵌入）
- `loadFile(path: string)`: 加载视频文件
- `play()`: 播放
- `pause()`: 暂停
- `togglePause()`: 切换暂停/播放
- `seek(time: number)`: 跳转到指定时间（秒）
- `setVolume(volume: number)`: 设置音量（0-100）
- `stop()`: 停止播放
- `getProperty(name: string)`: 获取属性
- `setProperty(name: string, value: any)`: 设置属性
- `command(...args: string[])`: 执行命令
- `getStatus()`: 获取当前状态
- `destroy()`: 销毁实例

#### 事件

- `initialized`: 初始化完成
- `window-set`: 窗口 ID 已设置
- `file-loaded`: 文件已加载
- `status`: 状态更新（每 500ms）
- `ended`: 播放结束
- `shutdown`: MPV 关闭
- `destroyed`: 实例已销毁

## 播放状态模型与 mpv 事件映射

### 主状态 phase

当前主进程里有两层状态：

- `MPVStatus`（libmpv.ts 内部）
  - `position: number`
  - `duration: number`
  - `volume: number`
  - `path: string | null`
  - `phase?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'`
  - `isSeeking?: boolean`
  - `isCoreIdle?: boolean`
  - `isIdleActive?: boolean`
- `PlayerState`（playerState.ts，对外暴露给渲染进程）
  - `phase: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'ended' | 'error'`
  - `currentTime: number`
  - `duration: number`
  - `volume: number`
  - `path: string | null`
  - `error: string | null`
  - `isSeeking: boolean`
  - `isCoreIdle: boolean`
  - `isIdleActive: boolean`

`PlayerState` 的 `phase` 优先使用 libmpv 层填充的 `MPVStatus.phase`，如果缺失再根据 position、duration 等兜底推导。

### mpv 事件 → phase 映射

基于 mpv 官方头文件 `include/mpv/client.h` 和文档：

- 打开文件与启动播放
  - `loadFile()` 调用后：先将 `phase` 设为 `loading`
  - `MPV_EVENT_START_FILE` (`event_id = 6`)：`phase = 'loading'`
  - `MPV_EVENT_FILE_LOADED` (`event_id = 8`) 且有 `path`：`phase = 'playing'`
- 暂停与继续
  - `MPV_EVENT_PROPERTY_CHANGE` (`event_id = 22`) 且 `name = 'pause'`
    - `value = true` 且有 `path`：`phase = 'paused'`
    - `value = false` 且有 `path`：`phase = 'playing'`
- Seek 相关
  - `MPV_EVENT_SEEK` (`event_id = 20`) 且有 `path`：`phase = 'loading'`
  - `MPV_EVENT_PLAYBACK_RESTART` (`event_id = 21`) 且有 `path`：`phase = 'playing'`
- 结束、停止、错误
  - `MPV_EVENT_END_FILE` (`event_id = 7`) 根据 `endFileReason`：
    - `EOF`：`phase = 'ended'`
    - `STOP`：`phase = 'stopped'`
    - `ERROR`：`phase = 'error'`
    - 其他情况：`phase = 'stopped'`
- 关闭与 idle
  - `MPV_EVENT_SHUTDOWN` (`event_id = 1`)：
    - `phase = 'idle'`
    - 清空 `path`、重置 `position`、`duration`

### 辅助状态

在当前实现中，已经基于 mpv 的事件和属性实现了一些辅助状态，用于细化 UX：

- `seeking`
  - 来源：`MPV_EVENT_SEEK` 与 `MPV_EVENT_PLAYBACK_RESTART` 成对出现
  - 实现：
    - 收到 `SEEK` 时：`isSeeking = true`，`phase = 'loading'`
    - 收到 `PLAYBACK_RESTART` 或 `FILE_LOADED` 或 `END_FILE` 时：`isSeeking = false`
- `coreIdle`
  - 来源：`core-idle` 属性（通过 `MPV_EVENT_PROPERTY_CHANGE` 回调）
  - 实现：
    - 收到 `name = 'core-idle'` 的 property-change：`isCoreIdle = !!value`
- `idleActive`
  - 来源：`idle-active` 属性（通过 `MPV_EVENT_PROPERTY_CHANGE` 回调）
  - 实现：
    - 收到 `name = 'idle-active'` 的 property-change：`isIdleActive = !!value`

这些辅助状态不一定要体现在 `phase` 字段中，可以作为单独的布尔字段或次级状态，与主 `phase` 组合使用。例如：

- 主状态：`phase = 'playing' | 'paused' | 'loading' | 'ended' | ...`
- 辅助状态：
  - `isSeeking: boolean`
  - `isCoreIdle: boolean`
  - `isIdleActive: boolean`

这样可以在不破坏现有状态机的前提下，为渲染进程提供更多细节，用于控制 loading 遮罩、seek 中指示、网络缓冲提示等。

## 故障排除

### 构建失败

1. **libmpv 未安装**：
   - 确保已通过 `brew install mpv` 安装
   - 检查 `/opt/homebrew/opt/mpv/lib/libmpv.dylib` 是否存在

2. **找不到头文件**：
   - 检查 `binding.gyp` 中的 `include_dirs` 路径
   - 确保 `/opt/homebrew/opt/mpv/include/mpv/` 目录存在
   - 如果是 Intel Mac，路径应该是 `/usr/local/opt/mpv/include/mpv/`

3. **链接错误**：
   - 检查 `binding.gyp` 中的库路径
   - 确保 libmpv 库文件存在：`ls -la /opt/homebrew/opt/mpv/lib/libmpv.dylib`

### 运行时错误

1. **"libmpv native binding is not available"**：
   - 确保已构建 native binding
   - 检查 `build/Release/mpv_binding.node` 是否存在

2. **窗口嵌入失败**：
   - 确保在 macOS 上运行（libmpv 嵌入在 macOS 上最可靠）
   - 检查窗口句柄是否正确获取

## 性能优势

使用 libmpv native binding 相比 IPC 模式的优势：

1. **更低的延迟**：同一进程内通信，无需 IPC
2. **更好的性能**：直接调用 C API，无序列化开销
3. **真正的窗口嵌入**：在 macOS 上可以真正嵌入窗口
4. **更精细的控制**：可以访问所有 libmpv 功能

## 下一步

- [ ] 添加更多属性支持
- [ ] 实现渲染 API（OpenGL）
- [ ] 添加字幕支持
- [ ] 优化事件处理性能
