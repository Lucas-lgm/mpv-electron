# 快速构建指南

> **最后更新**: 2026-01-26  
> **用途**: 快速参考构建流程

## 🚀 完整构建流程

### 1. 构建 MPV 子模块

```bash
# 构建 libmpv.2.dylib 并复制到 vendor 目录
./build_mpv.sh
```

**说明**：
- 配置 mpv 使用 meson 构建
- 构建 libmpv.2.dylib
- 复制到 `vendor/mpv/darwin-arm64/lib/`
- 修复依赖路径为 `@loader_path` 相对路径

### 2. 构建 Native Binding

```bash
# 构建 Node.js 原生模块（libmpv 绑定）
npm run build:native
```

**说明**：
- 使用 node-gyp 构建 native addon
- 生成 `native/build/Release/mpv_binding.node`
- 配置 rpath 指向 libmpv 库

### 3. 构建前端应用

```bash
# 构建 Electron 应用（主进程 + 渲染进程）
npm run build
```

**说明**：
- 使用 electron-vite 构建
- 编译 TypeScript 代码
- 打包 Vue 3 前端
- 输出到 `out/` 目录

### 4. 打包应用

```bash
# 完整打包流程（构建 + 打包）
npm run package:mac
```

**说明**：
- 自动执行：`npm run build` + `npm run build:native` + `electron-builder`
- 生成 macOS 应用包
- 输出到 `dist/` 目录

## 📋 一键构建脚本

可以创建一个脚本 `build_all.sh`：

```bash
#!/bin/bash
set -e

echo "🔨 开始完整构建流程..."

echo "1️⃣ 构建 MPV..."
./build_mpv.sh

echo "2️⃣ 构建 Native Binding..."
npm run build:native

echo "3️⃣ 构建前端..."
npm run build

echo "4️⃣ 打包应用..."
npm run package:mac

echo "✅ 构建完成！"
```

## 🎯 开发环境构建

**仅用于开发**（不需要打包）：

```bash
# 1. 构建 MPV（首次或更新后）
./build_mpv.sh

# 2. 构建 Native Binding（首次或更新后）
npm run build:native

# 3. 启动开发服务器（自动构建前端）
npm run dev
```

## 📚 详细文档

- **开发环境设置**: [SETUP_GUIDE.md](development/SETUP_GUIDE.md)
- **生产部署指南**: [DEPLOYMENT.md](deployment/DEPLOYMENT.md)
- **故障排除**: [TROUBLESHOOTING.md](development/TROUBLESHOOTING.md)

## ⚡ 快速命令参考

| 任务 | 命令 |
|------|------|
| 构建 MPV | `./build_mpv.sh` |
| 构建 Binding | `npm run build:native` |
| 构建前端 | `npm run build` |
| 开发模式 | `npm run dev` |
| 打包应用 | `npm run package:mac` |
| 完整流程 | `npm run package:mac`（自动执行前两步） |
