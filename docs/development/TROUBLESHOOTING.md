# 故障排除指南

> **最后更新**: 2026-01-25  
> **适用版本**: mpv-player v1.4+  
> **目标平台**: macOS (主要), Windows (次要)

## 🚨 紧急问题

### 应用无法启动
**症状**: 点击应用图标无反应，或立即崩溃

**解决步骤**:
1. **检查控制台日志**
   ```bash
   # 通过终端启动应用查看日志
   /Applications/mpv-player.app/Contents/MacOS/mpv-player
   ```

2. **检查依赖库**
   ```bash
   # 检查libmpv是否正确加载
   otool -L /Applications/mpv-player.app/Contents/Resources/app.asar.unpacked/vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
   ```

3. **检查native addon**
   ```bash
   # 检查native addon是否存在
   find /Applications/mpv-player.app -name "mpv_binding.node"
   ```

**常见原因**:
- ❌ Native addon被压缩到asar中
- ❌ libmpv依赖使用绝对路径(`/opt/homebrew/...`)
- ❌ 缺少依赖库

### 黑屏/无视频输出
**症状**: 应用启动正常，但视频窗口全黑

**诊断命令**:
```bash
# 发送调试命令
window.electronAPI.send('debug-hdr-status')
```

**解决步骤**:
1. **检查MPV初始化**
   - 查看控制台是否有MPV初始化错误
   - 检查native addon是否正确加载

2. **检查窗口绑定**
   - macOS: 确认NSView指针正确传递
   - Windows: 确认HWND正确传递

3. **检查渲染模式**
   ```typescript
   // 尝试切换渲染模式 (macOS)
   controller.setJsDrivenRenderMode(!controller.getJsDrivenRenderMode())
   ```

---

## 🎬 播放问题

### 视频无法播放
**症状**: 文件选择后无反应，或立即报错

**排查流程**:
```
1. 检查文件路径 → 2. 检查文件权限 → 3. 检查编解码器支持 → 4. 检查MPV日志
```

**详细步骤**:
1. **文件检查**
   ```bash
   # 确认文件存在且可读
   ls -la "/path/to/video.mp4"
   file "/path/to/video.mp4"
   ```

2. **编解码器检查**
   ```bash
   # 使用ffprobe检查视频格式
   ffprobe -v error -show_format -show_streams "/path/to/video.mp4"
   ```

3. **MPV日志**
   ```typescript
   // 启用详细日志
   await controller.setOption('log-file', '/tmp/mpv.log')
   await controller.setOption('msg-level', 'all=v')
   ```

### 播放卡顿/掉帧
**症状**: 视频播放不流畅，频繁卡顿

**性能优化**:
1. **硬件解码**
   ```typescript
   // 启用硬件解码 (Apple Silicon)
   await controller.setOption('hwdec', 'videotoolbox')
   ```

2. **渲染优化**
   ```typescript
   // 调整渲染参数
   await controller.setOption('video-sync', 'audio')      // 音频同步
   await controller.setOption('interpolation', 'yes')     // 帧插值
   await controller.setOption('tscale', 'oversample')     // 时间缩放
   ```

3. **缓存调整**
   ```typescript
   // 增加缓存
   await controller.setOption('demuxer-max-bytes', '150M')
   await controller.setOption('demuxer-readahead-secs', '60')
   ```

### 音频不同步
**症状**: 音频和视频不同步

**解决方法**:
```typescript
// 调整音频延迟
await controller.setProperty('audio-delay', 0.1)  // 增加0.1秒延迟
await controller.setProperty('audio-delay', -0.1) // 减少0.1秒延迟

// 或调整视频延迟
await controller.setProperty('video-delay', 0.1)
```

---

## 🌈 HDR/Dolby Vision问题

### HDR内容过曝光
**症状**: HDR视频看起来太亮，白色区域过曝

**状态**: ✅ **已解决** (v1.3+)

**当前解决方案**:
1. **保守的target-peak设置**
   - EDR ≤ 2.0: 500 nits
   - EDR ≤ 3.0: 700 nits  
   - EDR > 3.0: 1000 nits

2. **正确的色调映射**
   ```typescript
   // 自动配置
   // HDR10: bt.2390
   // Dolby Vision: st2094-10
   // 禁用动态峰值检测
   await controller.setOption('hdr-compute-peak', 'no')
   ```

**调试命令**:
```bash
# 检查HDR状态
window.electronAPI.send('debug-hdr-status')

# 手动调整
await controller.setProperty('target-peak', 800)  # 根据显示器调整
```

### Dolby Vision颜色异常
**症状**: DV内容显示绿色/紫色伪影

**状态**: ✅ **已解决** (v1.4+)

**解决方案**:
1. **使用gpu-next后端**
2. **正确配置libplacebo**
3. **固定版本**: 使用支持Profile 5/8的libplacebo版本

**检查项目**:
- [ ] 使用gpu-next后端 (`vo=gpu-next`)
- [ ] libplacebo版本 ≥ 4.0
- [ ] macOS版本 ≥ 14.0 (完整EDR支持)

### SDR内容发灰
**症状**: SDR视频颜色暗淡，发灰

**状态**: ✅ **已解决** (v1.2+)

**解决方案**:
```typescript
// 明确设置SDR颜色空间
await controller.setOption('target-trc', 'srgb')
await controller.setOption('target-colorspace-hint', 'yes')
```

---

## 📺 渲染问题

### 字幕渲染问题
**症状**: 字幕位置错误、旋转、或闪烁

**状态**: ✅ **已解决** (v1.3+)

**具体问题**:
1. **字幕位置错误**
   - **原因**: Y坐标翻转问题 (FLIP_Y=1)
   - **解决**: 在gpu-next backend中修复坐标转换

2. **字幕旋转**
   - **原因**: 视频旋转时字幕未同步旋转
   - **解决**: 正确处理video-params/rotate元数据

**检查命令**:
```typescript
// 检查视频旋转
const rotate = await controller.getProperty('video-params/rotate')
console.log('视频旋转:', rotate)

// 检查字幕格式
const subFormat = await controller.getProperty('current-tracks/sub/codec')
console.log('字幕格式:', subFormat)
```

### 视频旋转问题
**症状**: iPhone拍摄的视频方向错误

**状态**: ✅ **已解决** (v1.3+)

**解决方案**:
1. **正确解析旋转元数据**
2. **在libplacebo中应用旋转**
3. **同步旋转字幕和视频**

**相关属性**:
```typescript
// 检查视频参数
const rotate = await controller.getProperty('video-params/rotate')  // 90, 180, 270
const width = await controller.getProperty('video-params/w')
const height = await controller.getProperty('video-params/h')
```

---

## 🖥️ 窗口/UI问题

### 窗口大小/位置问题
**症状**: 窗口位置错误，大小异常

**解决方法**:
```typescript
// 重置窗口大小
corePlayer.setVideoWindow(null)
corePlayer.setVideoWindow(window)  // 重新设置

// 或手动调整
window.setSize(1920, 1080)
window.center()
```

### 控制栏不显示/不隐藏
**症状**: 控制栏无法自动隐藏，或不显示

**IPC检查**:
```typescript
// 发送控制栏命令
window.electronAPI.send('control-bar-show')
window.electronAPI.send('control-bar-schedule-hide')

// 检查IPC处理
// ipcHandlers.ts:202-224
```

---

## 🔧 构建/部署问题

### 构建失败
**常见错误及解决**:

#### 错误1: node-gyp构建失败
```
gyp ERR! find Python
gyp ERR! stack Error: Can't find Python executable "python"
```
**解决**:
```bash
# 设置Python3
npm config set python python3
export PYTHON=python3

# 或安装python2
brew install python@2
```

#### 错误2: Electron下载失败
```
RequestError: connect ETIMEDOUT
```
**解决**:
```bash
# 设置镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

#### 错误3: 缺少Meson/Ninja
```
meson: command not found
```
**解决**:
```bash
brew install meson ninja
```

### 打包后无法运行
**症状**: 开发环境正常，打包后崩溃

**检查清单**:
- [ ] Native addon在unpacked目录中 (`app.asar.unpacked/`)
- [ ] libmpv使用相对路径 (`@loader_path/...`)
- [ ] 所有依赖库都打包
- [ ] 权限正确 (`chmod +x`)

**验证命令**:
```bash
# 检查打包结构
find YourApp.app -name "*.dylib" -exec otool -L {} \;
find YourApp.app -name "mpv_binding.node"
```

---

## 📡 网络/流媒体问题

### 网络流无法播放
**症状**: URL无法播放，或缓冲时间长

**调试步骤**:
1. **检查URL格式**
   ```typescript
   // 正确格式
   await controller.loadFile('https://example.com/video.m3u8')
   
   // 可能需要协议前缀
   await controller.loadFile('http://example.com/video.mp4')
   ```

2. **调整缓冲设置**
   ```typescript
   // 增加网络缓冲
   await controller.setOption('cache', 'yes')
   await controller.setOption('cache-secs', '300')  // 300秒缓存
   await controller.setOption('demuxer-max-bytes', '150M')
   ```

3. **检查网络权限**
   - macOS: 检查网络访问权限
   - Electron: 检查是否启用网络功能

### 直播流问题
**症状**: 直播流卡顿、中断

**优化配置**:
```typescript
// 直播优化设置
await controller.setOption('stream-lavf-o', 'reconnect=1')
await controller.setOption('stream-lavf-o', 'reconnect_streamed=1')
await controller.setOption('stream-lavf-o', 'reconnect_delay_max=30')

// HLS特定设置
await controller.setOption('hls-bitrate', 'max')
await controller.setOption('prefetch-playlist', 'yes')
```

---

## 💾 内存/性能问题

### 内存泄漏
**症状**: 内存使用持续增长

**检测方法**:
1. **使用活动监视器** (macOS) 或 **任务管理器** (Windows)
2. **检查内存使用模式**
3. **使用Electron内存分析工具**

**常见泄漏点**:
- ❌ 事件监听器未移除
- ❌ 定时器未清理  
- ❌ 大对象未释放

**代码检查**:
```typescript
// 正确的事件监听管理
controller.on('status', handler)
// 使用后清理
controller.removeAllListeners('status')

// 正确的定时器管理
const timer = setInterval(() => {}, 1000)
// 使用后清理
clearInterval(timer)
```

### CPU使用率高
**症状**: 播放时CPU占用过高

**优化措施**:
1. **启用硬件解码**
   ```typescript
   await controller.setOption('hwdec', 'videotoolbox')  // macOS
   await controller.setOption('hwdec', 'd3d11va')       // Windows
   ```

2. **降低渲染负载**
   ```typescript
   // 降低OSD复杂度
   await controller.setOption('osd-level', 1)
   
   // 减少滤镜
   await controller.setOption('vf', '')
   ```

3. **调整解码线程**
   ```typescript
   await controller.setOption('vd-lavc-threads', '4')
   ```

---

## 🐛 调试工具

### 内置调试命令
```typescript
// 视频状态调试
await corePlayer.debugVideoState()

// HDR状态调试  
await corePlayer.debugHdrStatus()

// 发送按键调试
await corePlayer.sendKey('i')  // 显示统计信息
```

### 外部调试工具
1. **Electron DevTools**
   ```javascript
   // 在主进程中
   mainWindow.webContents.openDevTools()
   ```

2. **Console日志**
   ```bash
   # 启动时启用详细日志
   ./mpv-player --log-level=debug
   ```

3. **性能分析**
   ```bash
   # 使用Instruments (macOS)
   instruments -t Time Profiler
   ```

### 日志收集
```typescript
// 启用MPV详细日志
await controller.setOption('log-file', '/tmp/mpv-debug.log')
await controller.setOption('msg-level', 'all=v')

// 查看日志
tail -f /tmp/mpv-debug.log
```

---

## 📋 问题报告模板

遇到新问题？请提供以下信息：

### 基础信息
- **应用版本**: 
- **操作系统**: macOS/Windows 版本
- **硬件**: CPU, GPU, 内存
- **显示器**: 型号, HDR支持

### 问题描述
- **问题现象**: 
- **复现步骤**:
- **期望行为**:
- **实际行为**:

### 错误信息
- **控制台输出**:
- **错误堆栈**:
- **日志文件**:

### 环境信息
```bash
# 运行诊断命令
./scripts/verify_environment.sh
./scripts/verify_distribution.sh

# 检查HDR状态
window.electronAPI.send('debug-hdr-status')
```

---

## 🔄 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-01-25 | 创建综合故障排除指南 |
| 2026-01-21 | 初始FAQ在README.md中 |

## 📚 相关文档

- [开发环境指南](./SETUP_GUIDE.md) - 环境设置问题
- [API参考](./API_REFERENCE.md) - API使用问题
- [部署指南](../deployment/DEPLOYMENT.md) - 打包部署问题
- [架构文档](../ARCHITECTURE.md) - 理解系统架构

## 🆘 紧急支持

如果问题无法解决：
1. **检查GitHub Issues** - 查看是否有已知问题
2. **提交新Issue** - 使用问题报告模板
3. **提供诊断信息** - 运行诊断命令并提供输出
4. **提供示例文件** - 如可能，提供能复现问题的视频文件