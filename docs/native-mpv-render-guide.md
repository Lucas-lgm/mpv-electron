# LibMPV macOS 原生渲染实现总结

本文档总结了在该 Electron + Vue 项目中集成 libmpv 并实现 macOS 原生 OpenGL 渲染的关键技术点及踩坑解决方案。

## 1. 核心架构

- **渲染方式**: `MPV_RENDER_API_TYPE_OPENGL`
- **窗口结合**: 通过 `mpv_handle` 绑定到 Electron 窗口的 `NSView` (C++ Native Addon)。
- **线程模型**:
  - **主线程 (Main Thread)**: 处理窗口 Resize、NSView 生命周期、OpenGL Context 创建与更新 (`[ctx update]`)。
  - **渲染线程 (Render Thread)**: 独立的 `std::thread` 循环，执行 `mpv_render_context_update` 和 `mpv_render_frame`，避免阻塞 UI。

## 2. 关键问题与解决方案

### 2.1 视频缩在左下角 / 无法铺满窗口

**现象**: 窗口调整大小时，视频画面虽然等比例缩放，但只占据窗口左下角一小块区域，或者有错误的黑边。

**原因**:
1. **OpenGL Context 不同步**: macOS 的 `NSOpenGLContext` 不会自动监听 `NSView` 的尺寸变化。当窗口变大时，底层的 Backing Store (Drawable) 仍然保持旧尺寸。
2. **Retina 屏幕适配**: 默认情况下，OpenGL 可能使用逻辑像素 (Points) 而非物理像素 (Pixels)，导致分辨率不匹配。

**解决方案**:
在 Native 代码 (`mpv_render_gl.mm`) 中：

1. **启用 Retina 支持**:
   ```objective-c
   [view setWantsBestResolutionOpenGLSurface:YES];
   ```

2. **强制更新 Context (关键修复)**:
   每当 Electron 触发 `setWindowSize` 时，必须在**主线程**调用 `update`：
   ```objective-c
   runOnMainAsync(^{
       if (rc->glContext) {
           [rc->glContext update]; // 通知 OpenGL View 尺寸已改变
       }
       // ... 获取新的 backing size ...
   });
   ```

### 2.2 渲染目标 (FBO) 绑定

**现象**: 在某些情况下（如嵌入模式），如果硬编码 `fbo.fbo = 0`，mpv 可能无法正确渲染到屏幕。

**解决方案**:
动态获取当前绑定的 Framebuffer ID：
```cpp
GLint drawFbo = 0;
glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &drawFbo);

mpv_opengl_fbo fbo;
fbo.fbo = drawFbo != 0 ? (int)drawFbo : 0;
fbo.w = width;
fbo.h = height;
```

### 2.3 宽高比控制 (Aspect Ratio)

**策略**:
- 移除 Native 层的硬编码逻辑，完全依赖 mpv 内部的 `keepaspect` 处理。
- 在 TypeScript 层 (`libmpv.ts`) 设置属性：
  ```typescript
  await this.setProperty('keepaspect', true)
  await this.setProperty('keepaspect-window', true)
  await this.setProperty('video-unscaled', 'no')
  ```
- **窗口尺寸锁定**: 在 Electron 端监听 resize 事件，强制窗口宽高比匹配视频，防止出现黑边（如果需要完全无黑边体验）。

## 3. 完整渲染流程

1. **初始化**:
   - Electron 获取窗口句柄 (`getNSViewPointer`)。
   - Native 创建 `NSOpenGLContext`，绑定 View，开启 Retina，启动渲染线程。

2. **Resize 事件**:
   - Electron: `window.on('resize')` -> `libmpv.setWindowSize(w, h)`
   - Native: 
     - 主线程: `[ctx update]` -> 获取 `convertSizeToBacking` 后的真实像素尺寸。
     - 更新内部状态 `rc->width`, `rc->height`。
     - 标记 `rc->needRedraw = true`。

3. **渲染循环**:
   - 渲染线程检测到 `needRedraw` 或 mpv 新帧。
   - 构建 `mpv_opengl_fbo` (使用最新尺寸)。
   - 调用 `mpv_render_context_render`。
   - `glSwapAPPLE` / `CGLFlushDrawable` 上屏。

## 4. 相关文件

- **Native 实现**: [`native/mpv_render_gl.mm`](../native/mpv_render_gl.mm)
- **TypeScript 控制器**: [`src/main/libmpv.ts`](../src/main/libmpv.ts)
- **Node-gyp 配置**: [`native/binding.gyp`](../native/binding.gyp)
