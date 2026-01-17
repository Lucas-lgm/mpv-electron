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
   - 为了在 HDR 屏上获得更接近 IINA 的效果，Native 还会：
     - 确保 `NSView` 开启 `wantsLayer`，并在其主 layer 上挂载一个 `CAOpenGLLayer` 子层，作为视频渲染的宿主；
     - 在 HDR 模式下，根据 `video-params/primaries` 和 `video-params/gamma` 决定是否启用 HDR：
       - 仅当 `gamma` 为 `hlg`/`pq` 且 `primaries` 不是 `bt.709` 时才认为是 HDR；
       - 检查当前屏幕的 `maximumPotentialExtendedDynamicRangeColorComponentValue` 大于 1 才开启；
     - 启用 HDR 时：
       - 将 `icc-profile-auto` 设为 `no`，使用 mpv 自己的目标色彩空间；
       - 根据 `primaries` 设置 `target-prim`（例如 `bt.2020`）、`target-trc=pq`；
       - 设置 `screenshot-tag-colorspace=yes`；
       - 在 layer 上开启 `wantsExtendedDynamicRangeContent` 并将 colorspace 设置为 HDR 对应的 `CGColorSpace`（如 `ITUR_2100_PQ`）；
     - 关闭 HDR 时：
       - 恢复 `icc-profile-auto=yes`、`target-prim=auto`、`target-trc=auto`、`screenshot-tag-colorspace=no`；
       - 关闭 `wantsExtendedDynamicRangeContent`，将 layer colorspace 设回 sRGB。

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

### 3.1 HDR 效果偏灰的已知差异

- **现象**: 在部分 HDR 片源上，即便 mpv 端配置与 IINA 基本一致（`icc-profile-auto=0`、`target-prim=bt.2020`、`target-trc=pq`、`tone-mapping=auto`，屏幕 EDR 值约为 16），画面仍然比 IINA 明显偏灰、对比度不足。
- **已确认一致的部分**:
  - mpv 目标色彩空间、tone-mapping 选项与 IINA HDR 分支对齐；
  - 屏幕的 EDR 能力开启，且对应 layer 的 `wantsExtendedDynamicRangeContent=YES`；
  - HDR 判定逻辑（基于 `video-params/primaries` / `gamma`）与 IINA 一致。
- **潜在差异点**:
  - IINA 使用的是专门的 `CAOpenGLLayer` 子类 (`ViewLayer`) 作为渲染宿主，并与其内部的 CGL 上下文紧密耦合；
  - 当前实现仍然基于 Electron 提供的 `NSView + NSOpenGLContext` 模式，`CAOpenGLLayer` 仅作为附加子层使用，底层渲染路径与 IINA 仍存在结构性差异。
- **结论**:
  - mpv 层和 HDR 配置已经尽可能对齐 IINA，目前观察到的“偏灰”主要来自渲染管线（view/layer 架构）差异；
  - 要实现与 IINA 基本一致的 HDR 效果，需要进一步向 IINA 的 `VideoView + ViewLayer` 架构靠拢，而不仅仅是调整 mpv 的单个配置项。

## 4. 相关文件

- **Native 实现**: [`native/mpv_render_gl.mm`](../native/mpv_render_gl.mm)
- **TypeScript 控制器**: [`src/main/libmpv.ts`](../src/main/libmpv.ts)
- **Node-gyp 配置**: [`native/binding.gyp`](../native/binding.gyp)
