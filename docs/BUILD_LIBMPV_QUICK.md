# 快速构建 libmpv.a

## 方法 1：使用 MSYS2 构建脚本（推荐，最简单）

### 快速开始

1. **打开 MSYS2 CLANG64 终端**
   - 在开始菜单搜索 "MSYS2 CLANG64"
   - 或在 MSYS2 安装目录运行 `clang64.exe`

2. **确保已安装依赖**
   ```bash
   pacman -S pactoys git
   pacboy -S python pkgconf cc meson ninja
   pacboy -S ffmpeg libjpeg-turbo libplacebo luajit vulkan-headers
   ```

3. **运行构建脚本**
   ```bash
   cd /d/projects/mpv-electron
   chmod +x build_mpv_windows_msys2.sh
   ./build_mpv_windows_msys2.sh
   ```

脚本会自动完成：
- ✅ 更新 Meson wraps
- ✅ 配置构建
- ✅ 编译 libmpv.a
- ✅ 复制到 vendor 目录

### 手动构建（如果不想使用脚本）

1. **进入项目目录**
   ```bash
   cd /d/projects/mpv-electron/mpv
   ```

2. **配置构建（只构建 libmpv，静态库）**
   ```bash
   meson setup build \
       -Dlibmpv=true \
       -Dcplayer=false \
       -Ddefault_library=static \
       --prefix=$MSYSTEM_PREFIX
   ```

3. **编译**
   ```bash
   meson compile -C build libmpv.a
   ```

4. **复制到 vendor 目录**
   ```bash
   cd /d/projects/mpv-electron
   mkdir -p vendor/mpv/win32-x64/lib
   mkdir -p vendor/mpv/win32-x64/include
   
   # 复制静态库（Windows 使用 .lib 扩展名）
   cp mpv/build/libmpv.a vendor/mpv/win32-x64/lib/libmpv.lib
   
   # 复制头文件
   cp -r mpv/include vendor/mpv/win32-x64/include/mpv
   ```

## 方法 2：使用 PowerShell 脚本

如果你已经安装了 Visual Studio 和 Meson：

```powershell
cd d:\projects\mpv-electron
.\build_mpv_windows.ps1
```

## 方法 3：手动构建（最小配置）

如果你在 MSYS2 环境中：

```bash
cd /d/projects/mpv-electron/mpv

# 更新 Meson wrap 数据库
meson wrap update-db

# 配置构建
meson setup build \
    -Dlibmpv=true \
    -Dcplayer=false \
    -Ddefault_library=static \
    -Dtests=false \
    --prefix=/clang64

# 编译
meson compile -C build libmpv.a
```

## 验证构建

构建完成后，检查文件：

```bash
# 在 MSYS2 中
ls -lh mpv/build/libmpv.a

# 在 PowerShell 中
ls mpv\build\libmpv.a
```

文件大小应该在 10-50 MB 左右（取决于编译选项）。

## 常见问题

### 问题：找不到 meson 命令

**解决方案**：
```bash
# 在 MSYS2 中
pacboy -S meson

# 或使用 pip
pip install meson ninja
```

### 问题：构建失败，缺少依赖

**解决方案**：
```bash
# 在 MSYS2 中安装依赖
pacboy -S ffmpeg libjpeg-turbo libplacebo luajit vulkan-headers
```

### 问题：构建时间太长

**解决方案**：
- 使用 `-Dcplayer=false` 只构建库，不构建播放器
- 使用 `-Dtests=false` 禁用测试
- 使用 `-Ddefault_library=static` 构建静态库（更快）

## 下一步

构建完成后，继续运行项目：

```powershell
# 构建原生模块
npm run build:native

# 运行开发模式
npm run dev
```
