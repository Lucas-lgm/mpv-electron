# 调试指南：MPV 嵌入 Electron 窗口

## 如何调试嵌入功能

### 1. 查看日志输出

运行应用时，关注控制台中的以下日志：

```bash
npm run dev
```

**关键日志标记：**
- `[NativeHelper]` - NSView 获取相关
- `[MPVManager]` - MPV 管理相关
- `[MPVController]` - MPV 控制相关
- `Starting mpv with args:` - MPV 启动参数

### 2. 检查 NSView 指针获取

**成功的情况：**
```
[NativeHelper] NSWindow pointer: 1234567890
[NativeHelper] Using NSWindow pointer (some MPV versions may accept this)
[MPVManager] Successfully got NSView pointer: 1234567890
[MPVController] Embedding into window with ID: 1234567890
```

**失败的情况：**
```
[NativeHelper] Failed to get window ID: Error: ...
[MPVManager] Failed to get window pointer, will use standalone window
[MPVController] Creating standalone window
```

### 3. 检查 MPV 启动参数

MPV 启动时会打印所有参数，检查是否包含 `--wid`：

**嵌入模式（成功）：**
```
Starting mpv with args: [
  '--input-ipc-server=/tmp/...',
  '--no-terminal',
  '--no-osc',
  '--no-osd-bar',
  '--keep-open=yes',
  '--wid=1234567890',  // ← 这个参数存在
  '--vo=gpu',
  '/path/to/video.mp4'
]
```

**独立窗口模式（失败回退）：**
```
Starting mpv with args: [
  '--input-ipc-server=/tmp/...',
  '--no-terminal',
  '--no-osc',
  '--no-osd-bar',
  '--keep-open=yes',
  '--no-border',  // ← 注意这里
  '/path/to/video.mp4'
]
```

### 4. 测试 NSWindow 指针是否有效

如果看到使用 NSWindow 指针，但 MPV 没有嵌入，可能需要获取 NSView：

**问题：** MPV 可能需要 contentView 而不是 NSWindow

**解决方案：**
1. 检查 MPV 版本：`mpv --version`
2. 查看 MPV 文档关于 `--wid` 参数的说明
3. 尝试使用 NSView 指针（需要完整的 native 实现）

### 5. 常见问题排查

#### 问题 1：MPV 窗口没有嵌入，仍然是独立窗口

**可能原因：**
- NSWindow 指针无效
- MPV 版本不支持 NSWindow 指针（需要 NSView）
- `--wid` 参数格式错误

**解决方法：**
```typescript
// 在 nativeHelper.ts 中检查指针值
console.log('[NativeHelper] Window pointer:', windowId)
console.log('[NativeHelper] Pointer type:', typeof windowId)

// 检查 MPV 是否接受该指针
// 查看 MPV 的错误输出
```

#### 问题 2：视频区域是黑色的，没有视频

**可能原因：**
- MPV 窗口嵌入了，但位置不对
- 窗口尺寸不匹配
- 视频没有加载

**解决方法：**
- 检查视频文件路径是否正确
- 查看 MPV 的 stderr 输出是否有错误
- 检查控制面板是否正常显示

#### 问题 3：控制面板和视频区域重叠

**可能原因：**
- MPV 视图占据了整个窗口，覆盖了控制面板

**解决方法：**
- 需要调整布局，让 MPV 视图只占据上方区域
- 这需要精确的窗口区域计算（更复杂）

### 6. 使用独立窗口作为临时方案

如果嵌入一直失败，可以临时禁用嵌入模式：

```typescript
// 在 mpvManager.ts 中
setEmbedMode(false)  // 禁用嵌入，使用独立窗口
```

### 7. 测试步骤

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **选择视频文件**

3. **观察日志输出**
   - 是否成功获取窗口指针？
   - MPV 是否使用 `--wid` 参数？

4. **观察窗口行为**
   - 视频是否出现在 Electron 窗口中？
   - 还是仍然是独立窗口？

5. **检查控制面板**
   - 控制面板是否正常显示？
   - 播放控制是否工作？

### 8. 进阶调试：使用开发者工具

在主窗口中打开 DevTools（开发模式下自动打开），查看：

- Console 中的错误信息
- Network 中的 IPC 通信
- 检查 `window.electronAPI` 是否可用

### 9. MPV 命令测试

直接在终端测试 MPV 的嵌入功能：

```bash
# 测试 MPV 是否能接受窗口 ID（需要先获取一个窗口 ID）
# 这个命令不会工作，但可以帮助理解参数格式
mpv --wid=0 --no-terminal test.mp4
```

### 10. 回退机制

如果嵌入失败，代码会自动回退到独立窗口模式。检查：

- 是否触发了回退？
- 独立窗口模式是否正常工作？
- 用户是否能看到两个窗口？

---

## 预期结果

### 成功的情况：
- ✅ MPV 视频显示在 Electron 窗口的视频区域
- ✅ 控制面板显示在底部
- ✅ 只有一个窗口
- ✅ 播放控制正常工作

### 失败的情况（会自动回退）：
- ⚠️ MPV 视频在独立窗口
- ⚠️ 控制面板在 Electron 窗口
- ⚠️ 两个窗口分离（但功能正常）

---

## 下一步

如果嵌入失败，我们可以：
1. 实现完整的 NSView 获取逻辑
2. 或者采用透明窗口同步方案（方案 C）
3. 或者优化现有的独立窗口体验

告诉我你遇到了什么问题，我可以帮你排查！
