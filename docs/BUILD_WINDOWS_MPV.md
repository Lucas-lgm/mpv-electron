# Windows MPV 构建指南

本指南说明如何在 Windows 上构建 mpv 的 libmpv 库，用于 Electron 项目。

## 快速开始

### 使用 MSYS2（推荐，最简单）

MSYS2 提供了预编译的依赖包，构建过程最简单。

#### 1. 安装 MSYS2

1. 下载并安装 [MSYS2](https://www.msys2.org/)
2. 打开 **MSYS2 CLANG64** 终端（不是默认的 MSYS2 shell）
   - 在开始菜单搜索 "MSYS2 CLANG64"
   - 或在 MSYS2 安装目录运行 `clang64.exe`

#### 2. 更新 MSYS2

```bash
pacman -Syu
# 如果提示关闭终端，关闭后重新打开
```

#### 3. 安装构建工具和依赖

```bash
# 安装基础工具
pacman -S pactoys git

# 安装编译工具
pacboy -S python pkgconf cc meson

# 安装 mpv 依赖
pacboy -S ffmpeg libjpeg-turbo libplacebo luajit vulkan-headers
```

#### 4. 构建 libmpv

```bash
# 进入项目目录
cd /d/projects/mpv-electron

# 进入 mpv 子模块
cd mpv

# 配置构建（只构建 libmpv，不构建播放器）
meson setup build -Dlibmpv=true -Dcplayer=false --prefix=/clang64

# 编译
meson compile -C build

# 构建完成后，库文件在 build/ 目录
```

#### 5. 复制到 vendor 目录

```bash
# 返回项目根目录
cd /d/projects/mpv-electron

# 创建目录
mkdir -p vendor/mpv/win32-x64/lib
mkdir -p vendor/mpv/win32-x64/bin
mkdir -p vendor/mpv/win32-x64/include

# 复制静态库（Windows 使用 .lib 扩展名）
cp mpv/build/libmpv.a vendor/mpv/win32-x64/lib/libmpv.lib

# 如果需要动态库，先配置为共享库
cd mpv
meson configure build -Ddefault_library=shared -Dlibmpv=true
meson compile -C build
cd ..

# 复制动态库
cp mpv/build/libmpv-2.dll vendor/mpv/win32-x64/bin/

# 复制头文件
cp -r mpv/include vendor/mpv/win32-x64/include/mpv
```

### 使用 Visual Studio + Clang

#### 1. 安装依赖

1. **Visual Studio Build Tools** 或 **Visual Studio**
   - 下载：https://visualstudio.microsoft.com/downloads/
   - 安装时选择：
     - Clang compiler for Windows
     - C++ CMake tools for Windows
     - Windows SDK

2. **Python** 和构建工具
   ```powershell
   pip install meson ninja
   ```

3. **Git for Windows**（提供 sed 工具）

#### 2. 激活开发环境

在 **Visual Studio Developer Command Prompt** 中运行，或手动激活：

```powershell
& "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1" -Arch amd64 -HostArch amd64
```

#### 3. 运行构建脚本

```powershell
cd d:\projects\mpv-electron
.\build_mpv_windows.ps1
```

脚本会自动：
- 更新 Meson wraps
- 配置构建
- 编译 libmpv
- 复制文件到 vendor 目录

## 构建选项说明

### 基本构建（最小配置）

```bash
meson setup build -Dlibmpv=true -Dcplayer=false
```

### 完整功能构建

```bash
meson setup build \
    -Dlibmpv=true \
    -Dcplayer=false \
    -Dd3d11=enabled \
    -Dvulkan=enabled \
    -Djavascript=enabled \
    -Dlua=luajit \
    -Dgpl=true
```

### 静态库 vs 动态库

**静态库**（默认）：
```bash
meson setup build -Ddefault_library=static -Dlibmpv=true
ninja -C build libmpv.a
```

**动态库**：
```bash
meson setup build -Ddefault_library=shared -Dlibmpv=true
ninja -C build libmpv-2.dll
```

## 常见问题

### 问题：找不到 meson 命令

**解决方案**：
```powershell
pip install meson
# 或
python -m pip install meson
```

确保 Python Scripts 目录在 PATH 中。

### 问题：构建失败，提示缺少依赖

**解决方案**：
- 使用 MSYS2 时，确保安装了所有依赖包
- 使用 Visual Studio 时，确保使用提供的构建脚本（会自动处理依赖）

### 问题：链接错误

**解决方案**：
- 确保使用静态链接：`-Ddefault_library=static`
- 检查 Visual Studio 环境是否正确激活

### 问题：构建时间太长

**解决方案**：
- 使用 `-Dtests=false` 禁用测试
- 使用 `-Dcplayer=false` 只构建 libmpv（不构建播放器）
- 使用 ccache 加速（如果可用）

## 验证构建

构建完成后，验证文件：

```powershell
# 检查静态库
ls vendor\mpv\win32-x64\lib\libmpv.lib

# 检查动态库（如果构建了）
ls vendor\mpv\win32-x64\bin\libmpv-2.dll

# 检查头文件
ls vendor\mpv\win32-x64\include\mpv\*.h
```

## 下一步

构建完成后，继续运行项目：

```powershell
# 构建原生模块
npm run build:native

# 运行开发模式
npm run dev
```

## 参考资源

- [MPV Windows 编译文档](mpv/DOCS/compile-windows.md)
- [Meson 构建系统](https://mesonbuild.com/)
- [MSYS2 文档](https://www.msys2.org/docs/)
