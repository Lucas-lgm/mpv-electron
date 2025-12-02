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
