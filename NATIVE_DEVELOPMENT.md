# Native 模块开发记录（macOS / libmpv）

这份文档记录 `mpv-player` 的 macOS 原生渲染接入要点，重点覆盖：

- 为什么之前 HDR 会“发灰 / 偏暗 / 不像 IINA”
- 最终让 HDR 输出正确的关键改动（IINA 风格 CAOpenGLLayer 管线）
- 目前的线程模型、渲染驱动方式、mpv 关键参数、ICC/色彩空间处理

相关核心实现文件：

- `native/mpv_render_gl.mm`：OpenGL + libmpv render API + HDR/EDR 管线
- `native/binding.cc`：Node-API 导出、IPC/调用入口

## 关键结论（HDR 正确输出的要点）

### 1) HDR 的“语义”必须交给系统识别

在 macOS 上，想要“像 IINA 一样”的 HDR（尤其是 PQ）效果，不能只靠 mpv 的 `target-*` 配置。

系统是否把你的渲染表面当作 HDR，取决于：

- 渲染 layer 是否开启 EDR（`wantsExtendedDynamicRangeContent`）
- 渲染 layer 是否设置了正确的 PQ colorspace（例如 DisplayP3_PQ / ITUR_2100_PQ）

缺失这些语义时，常见现象就是画面发灰、对比不对、整体偏暗（看起来像被错误当作 SDR/线性处理）。

### 2) 采用 IINA 风格：用 CAOpenGLLayer 承载 libmpv render API

最终稳定正确的路径是：

- 用 `CAOpenGLLayer` 来创建/承载 OpenGL surface
- 在 `drawInCGLContext` 回调里调用 `mpv_render_context_render`
- 用 `CVDisplayLink` 在 vsync 上报 `mpv_render_context_report_swap`
- 用 mpv 的 render update callback 去触发 layer 重绘

这套方式能让系统层正确参与 HDR/EDR 的语义判断，也更贴近 IINA 的工作方式。

### 3) HDR 时的 mpv 配置（对齐 IINA 的策略）

当检测到 HDR（gamma 为 `hlg/pq` 且 primaries 非 `bt.709`）并且显示器支持 EDR 时：

- `layer.wantsExtendedDynamicRangeContent = true`
- `layer.colorspace = <PQ colorspace>`（按 primaries 选择）
- `icc-profile-auto = false`
- `target-prim = <video primaries>`
- `target-trc = pq`（PQ 直通；HLG 转 PQ）
- `screenshot-tag-colorspace = true`
- 默认不启用 `tone-mapping`（保持“直通语义”）

### 4) SDR 时必须给 mpv 提供 ICC profile 数据

使用 libmpv render API 时，mpv 的 `icc-profile-auto` **要求应用层通过 render context 参数提供 ICC profile**。

因此在 SDR/关闭 HDR 时：

- 先通过 `MPV_RENDER_PARAM_ICC_PROFILE` 把当前屏幕的 ICC 数据交给 mpv
- 再设置 `icc-profile-auto = true`，让 mpv 自动匹配显示器色彩

否则 `icc-profile-auto` 可能表现为“看似开了，但其实没生效”。

## 当前架构（2026-01）

### Node-API 边界

`native/binding.cc` 提供 Node-API 接口：

- attach view（传入 NSView 指针）并创建渲染上下文
- resize / force black / HDR enable 开关
- HDR 调试打印（native 侧）

### 渲染驱动方式

不再使用“自建 render thread 循环 + flushBuffer”。

当前渲染由系统驱动：

- mpv 通知“需要渲染”：`mpv_render_context_set_update_callback` → `on_mpv_redraw`
- 我们只置位 `needRedraw` 并触发 `CAOpenGLLayer` 重绘
- 系统在合适的线程/时机调用 `CAOpenGLLayer.drawInCGLContext`
- draw 回调内调用 `mpv_render_context_render`

vsync 时序由 `CVDisplayLink` 回调调用 `mpv_render_context_report_swap` 提供给 mpv。

## 核心实现要点（native/mpv_render_gl.mm）

### 1) GLRenderContext 生命周期与并发安全

- 用 `std::shared_ptr<GLRenderContext>` 存在 `g_renderContexts`，避免异步任务/回调 use-after-free
- `isDestroying` 在销毁阶段快速短路各种回调
- OpenGL context 用 `CGLLockContext` 保护（`ScopedCGLock`）

### 2) CAOpenGLLayer：渲染入口

`MPVOpenGLLayer` 负责：

- `copyCGLPixelFormatForDisplayMask` / `copyCGLContextForPixelFormat` 返回我们创建的 CGL 对象
- `canDrawInCGLContext` 基于 `needRedraw` 决定是否绘制
- `drawInCGLContext`：
  - `CGLSetCurrentContext`
  - 计算 FBO/viewport（作为 mpv 的 `MPV_RENDER_PARAM_OPENGL_FBO` 输入）
  - 调用 `mpv_render_context_render`
  - `glFlush`

### 3) HDR/EDR 切换：update_hdr_mode

检测条件：

- 用户开关 `hdrUserEnabled` 为 true
- `video-params/gamma` ∈ {`hlg`, `pq`}
- `video-params/primaries` 不是 `bt.709`
- `NSScreen.maximumPotentialExtendedDynamicRangeColorComponentValue > 1.0`

开启 HDR 时：

- `layer.wantsExtendedDynamicRangeContent = YES`
- `layer.colorspace = create_hdr_pq_colorspace_for_primaries(primaries)`
- mpv：
  - `icc-profile-auto = 0`
  - `target-prim = primaries`
  - `target-trc = pq`
  - `screenshot-tag-colorspace = 1`
  - `tone-mapping = ""`

关闭 HDR/回到 SDR 时：

- `layer.wantsExtendedDynamicRangeContent = NO`
- `layer.colorspace` 还原为屏幕 colorspace（或 sRGB）
- `set_render_icc_profile` 设置 `MPV_RENDER_PARAM_ICC_PROFILE`
- mpv：
  - `icc-profile-auto = 1`
  - `target-*` 还原为 `auto`
  - `screenshot-tag-colorspace = 0`

### 4) ICC Profile 注入：set_render_icc_profile

做法：

- 从当前 window 的 screen 取 `NSColorSpace`（fallback `mainScreen` / sRGB）
- 拿 `ICCProfileData` 拷贝进 `std::vector<uint8_t>`（保证内存生命周期）
- 用 `MPV_RENDER_PARAM_ICC_PROFILE` 调 `mpv_render_context_set_parameter`

## 构建与验证

- 原生模块编译：`npm run build:native`
- 工程构建：`npm run build`
- TS 类型检查：`npx tsc -p tsconfig.json --noEmit`

备注：当前依赖组合下 `vue-tsc` 与 `typescript@5.9.x` 存在不兼容导致崩溃，和 HDR 改动无关。

## 调试与排障

### HDR 状态一键打印

为了快速确认“mpv 认为自己在输出什么”和“系统层是否进入 EDR/HDR 语义”，实现了原生侧的 HDR 调试打印：

- 原生导出：`mpv_debug_hdr_status(instanceId)`
- 主要打印内容：
  - `video-params/primaries` / `video-params/gamma` / `video-params/sig-peak`
  - `target-prim` / `target-trc` / `target-peak` / `tone-mapping`
  - `NSScreen.maximumPotentialExtendedDynamicRangeColorComponentValue`（EDR 能力）
  - HDR 用户开关与内部判定状态（enabled/active）

### 常见现象 → 常见原因

- “HDR 很灰 / 很像 SDR / 对比不对”
  - 常见原因：渲染表面没有被系统识别为 PQ/EDR（未设置 layer colorspace + wantsEDR）
- “调了一堆 tone-mapping 才能看，但总是不对”
  - 常见原因：底层语义不对，靠 tone mapping 只是补救亮度曲线，无法补齐系统 HDR 管线
- “SDR 色彩跟系统不一致”
  - 常见原因：render API 模式下没有提供 `MPV_RENDER_PARAM_ICC_PROFILE`，导致 `icc-profile-auto` 实际不生效

## 历史稳定性问题（已解决）

### 窗口关闭/缩放偶发崩溃（Use-After-Free）

表现：

- 关闭窗口或销毁实例时偶发崩溃（异步任务或回调访问已释放的 context）

关键处理：

- `GLRenderContext` 全程用 `std::shared_ptr` 托管，存入全局 `g_renderContexts`
- 销毁时设置 `isDestroying`，所有回调快速短路
- GL 调用统一用 `CGLLockContext` 保护，避免并发访问 context

## 备注（构建环境）

`npm run build:native` 可能出现链接警告（比如 mpv dylib 的最低系统版本高于当前 target）。现阶段不影响功能，但如果后续要做发行，需要统一 `MACOSX_DEPLOYMENT_TARGET` 与 mpv dylib 的构建 target。
