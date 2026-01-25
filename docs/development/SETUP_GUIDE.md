# 开发环境设置指南

> **最后更新**: 2026-01-25  
> **目标平台**: macOS (ARM64/Intel)  
> **开发状态**: 活跃开发

## 🚀 快速开始

### 系统要求
- **操作系统**: macOS 12+ (建议 macOS 14+ 以获得完整 HDR 支持)
- **架构**: Apple Silicon (ARM64) 或 Intel
- **内存**: 8GB+ (建议 16GB)
- **磁盘空间**: 10GB+ 用于依赖和构建

### 必需工具
1. **Node.js**: 20.x (建议通过 [nvm](https://github.com/nvm-sh/nvm) 安装)
2. **Xcode Command Line Tools**: `xcode-select --install`
3. **Python**: 3.9+ (用于 node-gyp)
4. **Meson & Ninja**: (用于构建 mpv 子模块)
5. **Git**: (用于版本控制和子模块)

---

## 📦 环境配置

### 1. 安装 Node.js 和 npm
```bash
# 使用 nvm (推荐)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重新加载 shell 或运行
source ~/.zshrc  # 或 ~/.bashrc

# 安装 Node.js 20.x
nvm install 20
nvm use 20
```

### 2. 安装构建工具
```bash
# Xcode Command Line Tools
xcode-select --install

# 如果已安装，确保是最新版
sudo xcode-select --switch /Library/Developer/CommandLineTools

# 检查安装
xcode-select -p
```

### 3. 安装 Python 和构建工具
```bash
# macOS 自带 Python 3，但建议确认版本
python3 --version  # 应该显示 3.9+

# 安装 Homebrew (如果还没有)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Meson 和 Ninja
brew install meson ninja pkg-config

# 验证安装
meson --version
ninja --version
```

### 4. 配置 npm (可选，加速下载)
```bash
# 设置 Electron 镜像（如果在中国）
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# 或永久设置
echo 'export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/' >> ~/.zshrc
source ~/.zshrc
```

---

## 🔧 项目设置

### 1. 克隆仓库
```bash
# 克隆主仓库
git clone <repository-url>
cd mpv-player

# 初始化子模块
git submodule update --init --recursive
```

### 2. 安装 Node.js 依赖
```bash
npm install

# 如果 Electron 下载慢，使用镜像
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

### 3. 构建 mpv 子模块
```bash
# 运行构建脚本
./build_mpv.sh

# 脚本会：
# 1. 配置 mpv 使用 meson
# 2. 构建 libmpv.2.dylib
# 3. 复制到 vendor/mpv/darwin-arm64/lib/
# 4. 修复依赖路径为 @loader_path 相对路径
```

**详细说明**: 查看 [VENDOR_MANAGEMENT.md](VENDOR_MANAGEMENT.md) 了解 vendor 依赖管理的详细信息。

### 4. 构建 Native Addon
```bash
# 构建 native addon (Node.js 原生模块)
npm run build:native

# 或直接使用 node-gyp
cd native
node-gyp rebuild
```

### 5. 验证构建
```bash
# 检查 libmpv 是否正确构建
ls -la vendor/mpv/darwin-arm64/lib/

# 检查 native addon
ls -la native/build/Release/

# 测试加载 native addon
node -e "require('./native/build/Release/mpv_binding.node'); console.log('✅ Native addon 加载成功')"
```

---

## 🛠️ 开发工作流

### 启动开发服务器
```bash
npm run dev

# 开发服务器会：
# 1. 启动 Electron 主进程和渲染进程
# 2. 启用热重载
# 3. 打开开发者工具
```

### 构建生产版本
```bash
# 构建应用
npm run build

# 构建结果在 dist/ 目录
ls -la dist/
```

### 代码检查
```bash
# TypeScript 类型检查 (如果配置了)
npm run type-check

# ESLint (如果配置了)
npm run lint

# 构建检查
npm run build:check
```

### 测试命令
```bash
# 单元测试 (如果配置了)
npm test

# 集成测试 (如果配置了)
npm run test:e2e
```

---

## 🔍 环境验证

### 验证所有工具
```bash
#!/bin/bash
# scripts/verify_environment.sh

echo "=== 开发环境验证 ==="

# Node.js
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"

# 构建工具
echo "Python: $(python3 --version)"
echo "Meson: $(meson --version 2>/dev/null || echo '未安装')"
echo "Ninja: $(ninja --version 2>/dev/null || echo '未安装')"

# Xcode
echo "Xcode CLI: $(xcode-select -p 2>/dev/null || echo '未安装')"

# Git 子模块
if [ -f "mpv/.git" ]; then
    echo "✅ mpv 子模块已初始化"
else
    echo "❌ mpv 子模块未初始化"
fi

# libmpv
if [ -f "vendor/mpv/darwin-arm64/lib/libmpv.2.dylib" ]; then
    echo "✅ libmpv 已构建"
else
    echo "❌ libmpv 未构建"
fi

# Native addon
if [ -f "native/build/Release/mpv_binding.node" ]; then
    echo "✅ Native addon 已构建"
else
    echo "❌ Native addon 未构建"
fi

echo "=== 验证完成 ==="
```

### 常见环境问题

#### 问题 1: node-gyp 构建失败
**错误**: `gyp: No Xcode or CLT version detected!`

**解决**:
```bash
# 重新安装 Xcode Command Line Tools
sudo rm -rf $(xcode-select -print-path)
xcode-select --install
```

#### 问题 2: Python 版本问题
**错误**: `Python executable "python" is v2.7, which is not supported by gyp`

**解决**:
```bash
# 确保使用 python3
npm config set python python3

# 或全局设置
export PYTHON=python3
```

#### 问题 3: Meson/Ninja 未找到
**错误**: `meson: command not found`

**解决**:
```bash
brew install meson ninja
```

#### 问题 4: Electron 下载慢
**解决**:
```bash
# 设置镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# 或使用 cnpm
npm install -g cnpm --registry=https://registry.npmmirror.com
cnpm install
```

---

## 🎯 项目结构理解

```
mpv-player/
├── src/                    # 源代码
│   ├── main/              # Electron 主进程
│   │   ├── corePlayer.ts     # 核心播放器控制器
│   │   ├── libmpv.ts         # MPV 原生绑定接口
│   │   ├── renderManager.ts  # 渲染循环管理
│   │   ├── playerState.ts    # 状态机实现
│   │   ├── videoPlayerApp.ts # 应用入口和窗口管理
│   │   ├── ipcHandlers.ts    # IPC 通信处理
│   │   └── nativeHelper.ts   # 平台窗口句柄获取
│   ├── renderer/          # Vue 渲染进程
│   │   ├── src/views/        # 页面组件
│   │   ├── src/composables/  # 组合式函数
│   │   └── src/router.ts     # 路由配置
│   └── preload/           # 预加载脚本
│       └── preload.ts        # electronAPI 暴露
├── native/                # 原生绑定层
│   ├── binding.cc         # C++ N-API 绑定
│   ├── mpv_render_gl.mm   # macOS OpenGL 渲染 + HDR 配置
│   └── binding.gyp        # 构建配置
├── vendor/                # 预构建的依赖库
│   └── mpv/darwin-arm64/lib/  # libmpv 动态库
├── mpv/                   # mpv 子模块（gpu-next 后端）
├── docs/                  # 文档
└── build_mpv.sh           # mpv 构建脚本
```

---

## 🔧 调试配置

### VSCode 调试配置
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": {
        "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd"
      },
      "args": ["."],
      "outputCapture": "std",
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Renderer Process",
      "type": "chrome",
      "request": "attach",
      "port": 9222,
      "webRoot": "${workspaceFolder}/src/renderer",
      "timeout": 30000
    }
  ]
}
```

### Chrome 开发者工具
- 主进程：`Cmd+Shift+I` 或通过代码 `mainWindow.webContents.openDevTools()`
- 渲染进程：默认在开发模式下自动打开

### Native Addon 调试
```bash
# 使用 lldb 调试 native addon
lldb -- node -e "require('./native/build/Release/mpv_binding.node')"

# 在代码中添加日志
console.log('[native] 调试信息');
```

---

## 📚 学习资源

### 核心技术栈
- **Electron**: https://www.electronjs.org/
- **Vue 3**: https://vuejs.org/
- **TypeScript**: https://www.typescriptlang.org/
- **libmpv**: https://mpv.io/
- **libplacebo (gpu-next)**: https://code.videolan.org/videolan/libplacebo

### 项目相关文档
- [架构设计](../ARCHITECTURE.md) - 完整架构说明
- [API参考](./API_REFERENCE.md) - 核心API快速参考
- [部署指南](../deployment/DEPLOYMENT.md) - 打包和分发指南
- [HDR指南](../features/HDR_GUIDE.md) - HDR和Dolby Vision配置

### 社区支持
- **GitHub Issues**: 项目问题跟踪
- **Electron Discord**: 实时讨论
- **Vue.js Forum**: Vue相关问题

---

## 🆘 故障排除

### 无法启动开发服务器
```bash
# 清理并重新安装
rm -rf node_modules
npm cache clean --force
npm install

# 检查端口占用
lsof -i :3000  # 默认开发端口
```

### 视频无法播放
1. 检查 mpv 是否构建成功
2. 检查 native addon 是否加载
3. 查看控制台错误信息
4. 运行 `npm run build:native` 重新构建

### HDR 内容显示异常
1. 检查 macOS 版本（需要 14.0+ 获得完整 EDR 支持）
2. 检查显示器是否支持 HDR
3. 运行 HDR 调试命令
4. 查看 [HDR指南](../features/HDR_GUIDE.md)

---

## 🔄 更新环境

### 更新依赖
```bash
# 更新 npm 包
npm update

# 更新子模块
git submodule update --remote
cd mpv
git pull origin release/0.41
cd ..
./build_mpv.sh
```

### 清理构建
```bash
# 清理所有构建文件
npm run clean

# 或手动清理
rm -rf node_modules
rm -rf vendor/mpv/darwin-arm64/lib/*
rm -rf native/build
rm -rf dist
```

---

## ✅ 完成检查

完成所有设置后，运行完整验证：
```bash
# 运行验证脚本
./scripts/verify_environment.sh

# 启动开发服务器
npm run dev

# 测试基本功能
# 1. 应用正常启动
# 2. 可以打开视频文件
# 3. 播放控制正常工作
# 4. HDR 内容正确显示（如果支持）
```

如果所有检查通过，开发环境已配置完成！

---

## 📝 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-01-25 | 创建开发环境设置指南 |
| 2026-01-21 | 初始环境要求记录在 README.md |

## 🤝 贡献

发现环境设置问题或需要补充的内容？
- 提交 Issue 报告问题
- 提交 Pull Request 改进文档
- 在讨论区分享你的经验