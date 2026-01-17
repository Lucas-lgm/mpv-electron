# mpv-player

基于 Electron + Vue + TypeScript 的桌面播放器，使用 libmpv（native addon）在 macOS 上进行视频渲染。

## 特性

- Electron + Vue3 UI
- libmpv render API（native addon）嵌入到窗口视图
- macOS HDR：基于 CAOpenGLLayer 的 EDR/PQ 语义配置
- 内置 HDR 状态调试入口（IPC 一键打印 mpv + native 状态）

## 环境要求

- Node.js（推荐 20.x）
- macOS（HDR/EDR 相关逻辑主要面向 macOS）
- Xcode Command Line Tools（构建 native addon 需要 clang / make）
- Python（node-gyp 需要）

## 快速开始

```bash
npm install
```

如果安装 Electron 较慢，可手动指定镜像：

```bash
# macOS/Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# Windows (PowerShell)
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

## 构建 native（libmpv binding）

```bash
npm run build:native
```

产物默认在：

- `native/build/Release/mpv_binding.node`

## 开发运行

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

## macOS HDR（实现要点）

在 macOS 上，“HDR 看起来正确”不仅取决于 mpv 的 `target-*` 配置，更取决于系统是否把你的渲染表面识别为 HDR/EDR。

本项目目前采用的关键做法：

- 使用 `CAOpenGLLayer` 作为渲染 layer
- HDR 激活时：
  - 对 layer 开启 EDR（`wantsExtendedDynamicRangeContent`，按系统可用性保护）
  - 给 layer 设置 PQ colorspace（例如 DisplayP3_PQ / ITUR_2100_PQ）
  - 同步 mpv 侧的 `target-trc=pq`、`target-prim` 等
- HDR 检测与切换逻辑集中在 native 侧

核心实现见：

- [native/mpv_render_gl.mm](native/mpv_render_gl.mm)

## HDR 状态调试（IPC 一键打印）

渲染进程可发送 IPC `debug-hdr-status`，主进程会打印：

- mpv 侧：`video-params/*`、`target-*`、`tone-mapping` 等
- native 侧：当前屏幕 EDR 能力、layer 的 EDR/PQ 配置等

入口代码：

- [src/main/ipcHandlers.ts](src/main/ipcHandlers.ts)
- [src/main/corePlayer.ts](src/main/corePlayer.ts)
- [src/main/libmpv.ts](src/main/libmpv.ts)
- [native/binding.cc](native/binding.cc)

## 项目结构

```
.
├── native/                 # node-gyp native addon（libmpv binding + 渲染）
├── src/
│   ├── main/               # Electron 主进程
│   ├── preload/            # preload
│   └── renderer/           # Vue 渲染进程
├── NATIVE_DEVELOPMENT.md   # native 开发记录
├── electron.vite.config.ts
├── tsconfig*.json
└── package.json
```

## 常见问题

### vue-tsc 崩溃

本项目将 `typescript` 固定在 `5.3.3`，避免与 `vue-tsc@1.x` 的已知兼容性问题。
