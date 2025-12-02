# MPV Node.js Native Binding

这是 mpv 的 Node.js native binding 层，使用 libmpv C API 直接嵌入到 Electron 应用中。

## 构建要求

### macOS
- Xcode Command Line Tools
- 系统已安装 libmpv（通过 Homebrew）

### 安装 libmpv

使用 Homebrew 安装 mpv（包含 libmpv）：
```bash
brew install mpv
```

### 构建步骤

**构建 native binding**：
```bash
npm run build:native
```

或者直接使用 node-gyp：
```bash
cd native
node-gyp rebuild
```

**注意**：构建配置会自动使用 `/opt/homebrew/opt/mpv` 下的系统 libmpv。如果你使用的是 Intel Mac 或自定义安装路径，需要修改 `binding.gyp` 中的路径。

## 使用

在 TypeScript/JavaScript 代码中：

```typescript
import { LibMPVController, isLibMPVAvailable } from './libmpv'

if (isLibMPVAvailable()) {
  const controller = new LibMPVController()
  await controller.initialize()
  
  // 设置窗口 ID（用于嵌入到 Electron 窗口）
  const windowId = getWindowHandle() // 获取 Electron 窗口句柄
  await controller.setWindowId(windowId)
  
  // 加载并播放视频
  await controller.loadFile('/path/to/video.mp4')
  
  // 控制播放
  await controller.play()
  await controller.pause()
  await controller.seek(100) // 跳转到 100 秒
  
  // 监听事件
  controller.on('status', (status) => {
    console.log('Status:', status)
  })
  
  // 清理
  await controller.destroy()
}
```

## 注意事项

1. **libmpv 必须已安装**：在构建 native binding 之前，必须先通过 Homebrew 安装 mpv
2. **窗口嵌入**：在 macOS 上，使用 libmpv 可以在同一进程内真正嵌入窗口，这是与命令行启动 mpv 的主要区别
3. **事件处理**：事件通过 ThreadSafeFunction 从 C++ 线程传递到 Node.js 主线程
4. **路径配置**：默认使用 `/opt/homebrew/opt/mpv`（Apple Silicon Mac）。Intel Mac 使用 `/usr/local/opt/mpv`

## 故障排除

如果构建失败：

1. **检查 libmpv 是否已安装**：
   ```bash
   brew list mpv
   ls -la /opt/homebrew/opt/mpv/lib/libmpv.dylib
   ```

2. **检查路径**：如果是 Intel Mac，修改 `binding.gyp` 中的路径为 `/usr/local/opt/mpv`

3. **检查依赖**：确保已安装所有必要的依赖：
   ```bash
   npm install
   ```

4. **清理重建**：
   ```bash
   cd native
   node-gyp clean
   node-gyp rebuild
   ```
