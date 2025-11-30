# MPV Player

基于 Electron + Vue + TypeScript 构建的桌面应用。

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **electron-vite** - 快速构建工具
- **Vue 3** - 渐进式 JavaScript 框架
- **TypeScript** - JavaScript 的超集

## 开发

### 安装依赖

项目已配置国内镜像源（`.npmrc` 文件），在中国大陆可以直接安装：

```bash
# 安装依赖（已配置淘宝镜像，自动加速）
npm install
```

如果安装 Electron 仍然很慢，可以手动设置环境变量：

```bash
# macOS/Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# Windows (PowerShell)
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

### 开发命令

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 项目结构

```
├── src/
│   ├── main/          # 主进程代码
│   ├── preload/       # 预加载脚本
│   └── renderer/      # 渲染进程代码（Vue 应用）
├── electron.vite.config.ts  # electron-vite 配置
├── tsconfig.json      # TypeScript 配置
└── package.json
```

