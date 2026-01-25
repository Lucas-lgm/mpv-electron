# API 快速参考手册

> **最后更新**: 2026-01-25  
> **基于架构版本**: ARCHITECTURE.md v1.0  
> **状态**: 生产就绪

## 🎯 核心接口概览

### 1. CorePlayer (核心播放器)
**文件**: `src/main/corePlayer.ts:9-29`  
**描述**: 应用程序的主要入口点，管理播放会话和窗口。

```typescript
// 获取实例
import { corePlayer } from './corePlayer'

// 基本播放控制
await corePlayer.play('/path/to/video.mp4')  // 播放视频
await corePlayer.pause()                     // 暂停
await corePlayer.resume()                    // 继续播放
await corePlayer.stop()                      // 停止播放
await corePlayer.seek(120)                   // 跳转到120秒
await corePlayer.setVolume(75)               // 设置音量75%

// 窗口管理
corePlayer.setVideoWindow(window)            // 设置视频窗口
corePlayer.setControlView(view)              // 设置控制视图（macOS）
corePlayer.setControlWindow(window)          // 设置控制窗口（Windows）

// 状态查询
const state = corePlayer.getPlayerState()    // 获取当前状态
corePlayer.onPlayerState(listener)           // 监听状态变化
corePlayer.offPlayerState(listener)          // 移除监听器

// 实用功能
corePlayer.broadcastToPlaybackUIs('message', data)  // 广播消息
await corePlayer.sendKey('SPACE')             // 发送按键
await corePlayer.debugVideoState()            // 调试视频状态
await corePlayer.debugHdrStatus()             // 调试HDR状态
corePlayer.setHdrEnabled(true)                // 启用HDR
await corePlayer.cleanup()                    // 清理资源
```

### 2. LibMPVController (MPV控制器)
**文件**: `src/main/libmpv.ts:88-872`  
**描述**: 业务逻辑层与原生绑定层之间的主要接口。

```typescript
import { LibMPVController } from './libmpv'

const controller = new LibMPVController()

// 初始化与配置
await controller.initialize()                 // 初始化MPV实例
await controller.setWindowId(windowId)        // 设置窗口ID
await controller.setWindowSize(1920, 1080)    // 设置窗口尺寸

// 播放控制
await controller.loadFile('/path/to/video.mp4') // 加载文件
await controller.play()                       // 播放
await controller.pause()                      // 暂停
await controller.seek(150)                    // 跳转到150秒
await controller.setVolume(80)                // 设置音量
await controller.stop()                       // 停止

// 属性管理
const width = await controller.getProperty('width')      // 获取宽度
await controller.setProperty('pause', true)              // 设置暂停
await controller.command('set', 'pause', 'yes')          // 执行命令（更快）

// 渲染控制 (macOS特定)
controller.setJsDrivenRenderMode(true)        // 启用JS驱动渲染模式
controller.requestRender()                    // 请求渲染
controller.setHdrEnabled(true)                // 启用HDR

// 调试
await controller.debugVideoState()            // 调试视频状态
await controller.debugHdrStatus()             // 调试HDR状态
await controller.destroy()                    // 销毁实例
```

### 3. RenderManager (渲染管理器)
**文件**: `src/main/renderManager.ts:8-274`  
**描述**: 管理渲染循环和渲染决策。

```typescript
import { RenderManager } from './renderManager'

const renderManager = new RenderManager(controller, () => state)

// 生命周期
renderManager.start()                         // 启动渲染循环
renderManager.stop()                          // 停止渲染循环
renderManager.isActive()                      // 检查是否激活
renderManager.cleanup()                       // 清理资源

// 配置
renderManager.updateFps(60)                   // 根据帧率更新渲染间隔
renderManager.markSeekComplete()              // 标记Seek完成（需要渲染）
renderManager.markResizeStart()               // 标记Resize开始
```

### 4. PlayerStateMachine (状态机)
**文件**: `src/main/playerState.ts:20-111`  
**描述**: 管理播放器状态，继承自 EventEmitter。

```typescript
import { PlayerStateMachine } from './playerState'

const stateMachine = new PlayerStateMachine()

// 状态管理
const state = stateMachine.getState()         // 获取当前状态
stateMachine.setPhase('playing')              // 设置播放阶段
stateMachine.setError('播放失败')              // 设置错误状态
stateMachine.updateFromStatus(mpvStatus)      // 从MPV状态更新

// 事件监听
stateMachine.on('state', listener)            // 监听状态变化
stateMachine.off('state', listener)           // 移除监听器
```

---

## 📊 数据结构

### 1. PlayerState (播放器状态)
```typescript
interface PlayerState {
  phase: PlayerPhase        // 播放阶段
  currentTime: number       // 当前时间（秒）
  duration: number          // 总时长（秒）
  volume: number            // 音量（0-100）
  path: string | null       // 文件路径
  error: string | null      // 错误信息
  isSeeking: boolean        // 是否跳转中
  isCoreIdle: boolean       // 核心空闲
  isIdleActive: boolean     // 激活空闲
  isNetworkBuffering: boolean      // 网络缓冲中
  networkBufferingPercent: number  // 缓冲百分比
}
```

### 2. PlayerPhase (播放阶段)
```typescript
type PlayerPhase = 
  | 'idle'      // 空闲状态
  | 'loading'   // 加载中
  | 'playing'   // 播放中
  | 'paused'    // 已暂停
  | 'stopped'   // 已停止
  | 'ended'     // 播放结束
  | 'error'     // 错误状态
```

### 3. MPVStatus (MPV状态)
```typescript
interface MPVStatus {
  position: number          // 当前播放位置（秒）
  duration: number          // 视频总时长（秒）
  volume: number            // 音量（0-100）
  path: string | null       // 当前文件路径
  phase?: PlayerPhase       // 播放阶段
  isSeeking?: boolean       // 是否正在跳转
  isCoreIdle?: boolean      // 核心是否空闲
  isIdleActive?: boolean    // 是否处于激活空闲状态
  isNetworkBuffering?: boolean      // 是否网络缓冲
  networkBufferingPercent?: number  // 网络缓冲百分比
}
```

---

## 🔌 IPC通信

### IPC消息通道

#### 渲染进程 → 主进程
```typescript
// Vue组件中发送消息
window.electronAPI.send('play-video', { name: 'video.mp4', path: '/path/to/video.mp4' })
window.electronAPI.send('control-pause')
window.electronAPI.send('control-seek', 120)
window.electronAPI.send('control-volume', 75)
window.electronAPI.send('control-hdr', true)
window.electronAPI.send('debug-hdr-status')
```

#### 主进程 → 渲染进程
```typescript
// 渲染进程中接收消息
window.electronAPI.on('player-state', (state) => {
  console.log('播放器状态更新:', state)
})

window.electronAPI.on('playlist-updated', (playlist) => {
  console.log('播放列表更新:', playlist)
})

window.electronAPI.on('player-error', ({ message }) => {
  console.error('播放错误:', message)
})
```

### 常用IPC消息

| 消息通道 | 参数类型 | 描述 | 处理函数位置 |
|---------|---------|------|------------|
| `play-video` | `{name: string, path: string}` | 播放视频 | `ipcHandlers.ts:38` |
| `control-pause` | 无 | 暂停播放 | `ipcHandlers.ts:58` |
| `control-play` | 无 | 继续播放 | `ipcHandlers.ts:63` |
| `control-seek` | `number` | 跳转到时间 | `ipcHandlers.ts:81` |
| `control-volume` | `number` | 设置音量 | `ipcHandlers.ts:86` |
| `control-hdr` | `boolean` | 设置HDR | `ipcHandlers.ts:90` |
| `debug-hdr-status` | 无 | 调试HDR状态 | `ipcHandlers.ts:171` |

---

## 🎮 平台特定API

### macOS 特定功能
```typescript
// JavaScript驱动渲染模式（替代CVDisplayLink）
controller.setJsDrivenRenderMode(true)  // 启用
controller.getJsDrivenRenderMode()      // 获取当前模式
controller.requestRender()              // 请求渲染

// HDR配置
controller.setHdrEnabled(true)          // 启用HDR
await controller.debugHdrStatus()       // 调试HDR状态
```

### Windows 特定功能
```typescript
// Windows使用双窗口模式
corePlayer.setControlWindow(controlWindow)  // 设置控制窗口
corePlayer.setVideoWindow(videoWindow)      // 设置视频窗口
```

---

## 🔧 实用工具函数

### NativeHelper (平台窗口句柄获取)
```typescript
import { getNSViewPointer, getHWNDPointer } from './nativeHelper'

// macOS: 获取NSView指针
const viewPtr = getNSViewPointer(window)  // BrowserWindow → NSView指针

// Windows: 获取HWND指针  
const hwndPtr = getHWNDPointer(window)    // BrowserWindow → HWND指针
```

### 时间轴管理
```typescript
// Timeline类提供时间更新功能
timeline.start()                          // 启动时间轴
timeline.stop()                           // 停止时间轴
timeline.dispose()                        // 清理资源
```

---

## 🚀 快速使用示例

### 基本播放流程
```typescript
import { corePlayer } from './corePlayer'

// 1. 播放视频
await corePlayer.play('/path/to/video.mp4')

// 2. 监听状态变化
corePlayer.onPlayerState((state) => {
  console.log('当前状态:', state.phase)
  console.log('当前时间:', state.currentTime, '/', state.duration)
})

// 3. 控制播放
await corePlayer.pause()
await corePlayer.seek(60)  // 跳转到1分钟
await corePlayer.setVolume(80)

// 4. 调试
await corePlayer.debugVideoState()
await corePlayer.debugHdrStatus()

// 5. 清理
await corePlayer.cleanup()
```

### 集成到UI组件
```vue
<script setup lang="ts">
// Vue组件示例
import { onMounted, onUnmounted, ref } from 'vue'

const playerState = ref(null)

onMounted(() => {
  // 监听播放器状态
  window.electronAPI.on('player-state', (state) => {
    playerState.value = state
  })
})

onUnmounted(() => {
  window.electronAPI.removeListener('player-state')
})

// 控制播放
function playVideo(path: string) {
  window.electronAPI.send('play-video', { 
    name: path.split('/').pop(), 
    path 
  })
}

function pauseVideo() {
  window.electronAPI.send('control-pause')
}

function seekTo(time: number) {
  window.electronAPI.send('control-seek', time)
}
</script>
```

---

## ⚡ 性能优化API

### 渲染性能配置
```typescript
// RenderManager 性能参数
const renderManager = new RenderManager(controller, getState)

// 动态调整渲染间隔
renderManager.updateFps(60)  // 根据视频帧率优化

// 默认渲染间隔
DEFAULT_RENDER_INTERVAL_MS = 20ms  // 50fps
MIN_RENDER_INTERVAL_MS = 16ms      // 60fps上限
```

### Apple Silicon 硬件加速
```typescript
// 在初始化时自动启用
if (process.arch === 'arm64' && process.platform === 'darwin') {
  await controller.setOption('hwdec', 'videotoolbox')
}
```

### 响应性优化
```typescript
// 推荐的MPV配置选项
await controller.setOption('osd-level', 1)           // 降低OSD复杂度
await controller.setOption('video-sync', 'audio')    // 音频同步模式
await controller.setOption('input-queue-size', 2)    // 减少输入队列
await controller.setOption('video-latency-hacks', true) // 视频延迟优化
```

---

## 🐛 调试API

### 视频状态调试
```typescript
// 打印详细的视频参数
await controller.debugVideoState()

// 输出示例：
// === MPV Video State Debug ===
// Video size: 1920x1080
// primaries: bt.2020
// gamma (transfer): pq
// tone-mapping: bt.2390
// target-peak: 1000
// ============================
```

### HDR状态调试
```typescript
// 打印HDR相关信息
await controller.debugHdrStatus()

// 输出示例：
// [debug-hdr-status] dvProfile=5 primaries=bt.2020 gamma=pq
```

### 网络缓冲监控
```typescript
// 监听网络缓冲状态
controller.on('status', (status) => {
  if (status.isNetworkBuffering) {
    console.log(`缓冲中: ${status.networkBufferingPercent}%`)
  }
})
```

---

## 📋 API兼容性

### 版本兼容性
| API | 引入版本 | 状态 | 备注 |
|-----|---------|------|------|
| `corePlayer.play()` | v1.0 | ✅ 稳定 | 基础播放功能 |
| `setJsDrivenRenderMode()` | v1.2 | ✅ 稳定 | macOS优化 |
| `setHdrEnabled()` | v1.3 | ✅ 稳定 | HDR支持 |
| `debugHdrStatus()` | v1.4 | ✅ 稳定 | 调试工具 |

### 平台支持
| API | macOS | Windows | Linux |
|-----|-------|---------|-------|
| `setJsDrivenRenderMode()` | ✅ | ❌ | ❌ |
| `requestRender()` | ✅ | ❌ | ❌ |
| `setControlView()` | ✅ | ❌ | ❌ |
| `setControlWindow()` | ❌ | ✅ | ❌ |

---

## 🔗 相关文档

- [完整架构文档](../ARCHITECTURE.md) - 详细接口说明和架构设计
- [开发环境指南](./SETUP_GUIDE.md) - 环境设置和构建说明
- [故障排除指南](./TROUBLESHOOTING.md) - 常见问题解决方法
- [部署指南](../deployment/DEPLOYMENT.md) - 打包和分发指南

---

## 📝 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-01-25 | 创建API快速参考手册 |
| 2026-01-21 | 基于ARCHITECTURE.md v1.0提取核心API |

## 💡 使用建议

1. **异步处理**: 所有播放控制API都是异步的，使用 `await` 或 `.then()`
2. **错误处理**: 使用 try-catch 处理可能的错误
3. **资源清理**: 使用后调用 `cleanup()` 或 `destroy()` 释放资源
4. **状态监听**: 使用事件监听器而不是轮询状态
5. **平台检测**: 使用 `process.platform` 检测平台，调用对应API