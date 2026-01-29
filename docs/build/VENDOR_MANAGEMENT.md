# Vendor 依赖管理指南

> **最后更新**: 2026-01-26  
> **用途**: MPV vendor 依赖库的构建、管理和使用

## 🚀 快速开始

### 一键构建（推荐）

```bash
# 完整构建流程：编译 mpv + 复制所有依赖
./build_mpv.sh
```

这个命令会：
1. ✅ 配置并编译 mpv
2. ✅ 复制所有依赖到 vendor 目录（101个库文件）
3. ✅ 创建符号链接（84个链接）
4. ✅ 修复所有路径为 @rpath
5. ✅ 验证最终配置

### 单独更新依赖

如果只需要重新复制依赖（不重新编译 mpv）：

```bash
./copy_dependencies.sh
```

## 📁 目录结构

```
vendor/
└── mpv/
    └── darwin-arm64/
        ├── include/              # MPV 头文件
        │   └── mpv/
        │       ├── client.h
        │       ├── render_gl.h
        │       ├── render.h
        │       └── stream_cb.h
        └── lib/                  # 185个库文件（101个实际文件 + 84个符号链接）
            ├── libmpv.2.dylib    # 主库（4.5 MB）
            ├── libmpv.dylib -> libmpv.2.dylib
            ├── libavcodec.62.11.100.dylib  # FFmpeg 编解码器（23 MB）
            ├── libavcodec.62.dylib -> libavcodec.62.11.100.dylib
            └── ... (90+ 其他依赖库)
```

**总大小**: 约 95 MB

## 🔧 脚本说明

### 1. build_mpv.sh - 主构建脚本

**用途**: 完整构建流程，从源码编译到打包

**执行步骤**:
```bash
./build_mpv.sh
```

**内部流程**:
1. 检查 mpv 源码目录
2. 配置 PKG_CONFIG_PATH（指向 homebrew ffmpeg）
3. 运行 meson 配置构建
4. 编译 libmpv.2.dylib
5. 调用 copy_dependencies.sh 复制所有依赖

**输出**: `vendor/mpv/darwin-arm64/lib/libmpv.2.dylib` 及所有依赖

### 2. copy_dependencies.sh - 依赖复制脚本

**用途**: 递归复制所有第三方依赖

**执行步骤**:
```bash
./copy_dependencies.sh
```

**工作原理**:
1. 使用 `otool -L` 分析 libmpv 的依赖
2. 递归分析每个依赖的依赖（最多10层）
3. 排除系统库（/usr/lib, /System）
4. 复制所有第三方库到 vendor 目录
5. 创建版本号符号链接
6. 修复所有路径为 @rpath

## 📊 依赖统计

### 库文件数量
- **实际库文件**: 101 个 .dylib 文件
- **符号链接**: 84 个链接
- **总计**: 185 个 .dylib 文件

### 主要依赖类别

| 类别 | 库数量 | 总大小 | 主要库 |
|------|--------|--------|--------|
| FFmpeg | 7 | ~45 MB | avcodec, avformat, avfilter |
| 视频编解码 | 10 | ~15 MB | x264, x265, aom, dav1d, vpx |
| 音频编解码 | 8 | ~3 MB | opus, vorbis, mp3lame, speex |
| 图像处理 | 12 | ~8 MB | png, jpeg, webp, jxl, tiff |
| 字幕渲染 | 5 | ~4 MB | ass, freetype, harfbuzz |
| GPU 渲染 | 4 | ~9 MB | placebo, vulkan, shaderc |
| 网络协议 | 8 | ~10 MB | gnutls, ssl, ssh, srt |
| 其他 | 47 | ~1 MB | 各种支持库 |

### 最大的库文件
```
libavcodec.62.dylib     23 MB   # FFmpeg 编解码器
libshaderc_shared.1     6.8 MB  # Shader 编译器
libcrypto.3             4.6 MB  # OpenSSL 加密库
libx265.215             4.7 MB  # H.265 编码器
libmpv.2                4.5 MB  # MPV 主库
```

## 🔗 路径配置

### 开发环境 vs 生产环境

#### 开发环境

**库文件位置**：
```
项目根目录/
├── vendor/mpv/darwin-arm64/lib/    ← 源码库位置
│   ├── libmpv.2.dylib
│   └── ... (185个文件)
└── native/build/Release/
    └── mpv_binding.node             ← native addon
```

**RPath 配置**：
```
@loader_path/../../../vendor/mpv/darwin-arm64/lib
```

**路径计算**：
- `@loader_path` = `native/build/Release/`
- `../../../vendor/mpv/darwin-arm64/lib` = `vendor/mpv/darwin-arm64/lib/` ✓

#### 生产环境（打包后）

**库文件位置**：
```
MPV Player.app/Contents/
├── Resources/
│   └── lib/                         ← 打包后的库位置
│       ├── libmpv.2.dylib
│       └── ... (185个文件)
└── Resources/app.asar.unpacked/
    └── native/build/Release/
        └── mpv_binding.node         ← native addon
```

**RPath 配置**：
```
@loader_path/../../../../lib
```

**路径计算**：
- `@loader_path` = `app.asar.unpacked/native/build/Release/`
- `../../../../lib` = `Resources/lib/` ✓

### native/binding.gyp 配置

使用多个 rpath，按优先级查找：

```json
{
  "LD_RUNPATH_SEARCH_PATHS": [
    "@loader_path/../../../vendor/mpv/darwin-arm64/lib",  // 开发环境
    "@loader_path/../../../../lib"                         // 生产环境
  ]
}
```

**查找顺序**：
1. 先查找开发环境路径（`vendor/mpv/darwin-arm64/lib/`）
2. 如果找不到，再查找生产环境路径（`Resources/lib/`）

## ✅ 验证配置

### 检查依赖路径

```bash
# 检查 libmpv 的依赖
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep -E "@rpath|@loader_path"

# 检查所有 bundled 库的依赖
for lib in vendor/mpv/darwin-arm64/lib/bundled/*.dylib; do
    echo "=== $(basename $lib) ==="
    otool -L "$lib" | grep -E "/opt/homebrew|@loader_path"
done
```

**应该看到**：
- ✅ 所有依赖都使用 `@rpath/...` 或 `@loader_path/...`
- ✅ 没有 `/opt/homebrew/...` 路径

### 检查 rpath 配置

```bash
# 检查 native addon 的 rpath
otool -l native/build/Release/mpv_binding.node | grep -A2 LC_RPATH
```

### 测试加载

```bash
# 测试本地加载
node -e "require('./native/build/Release/mpv_binding.node'); console.log('✅ Native addon 加载成功')"
```

## 🎯 关键依赖

这些是 mpv 的核心功能依赖，必须存在：

### 必需依赖

```bash
✓ libavcodec.62.dylib      # 视频解码
✓ libavformat.62.dylib     # 封装格式
✓ libavfilter.11.dylib     # 视频滤镜
✓ libswscale.9.dylib       # 图像缩放
✓ libswresample.6.dylib    # 音频重采样
✓ libass.9.dylib           # 字幕渲染
✓ libplacebo.351.dylib     # GPU 加速
```

### 可选依赖（按需保留）

```bash
- libx264.165.dylib        # H.264 编码（播放不需要）
- libx265.215.dylib        # H.265 编码（播放不需要）
- libwhisper.1.dylib       # AI 语音识别（可选）
- libbluray.3.dylib        # 蓝光支持（可选）
- libarchive.13.dylib      # 归档文件（可选）
```

## 📦 打包建议

### 完整打包（推荐）

```bash
# 包含所有依赖，支持所有功能
cp -r vendor/mpv/darwin-arm64/lib/ MyApp.app/Contents/Resources/lib/
```

**优点**：
- ✅ 支持所有视频格式
- ✅ 支持所有字幕格式
- ✅ 支持网络流
- ✅ 支持 GPU 加速

**缺点**：
- ❌ 体积较大（95 MB）

### 精简打包

只包含播放必需的依赖（约 40-50 MB），但可能不支持某些格式。

## 🔍 故障排查

### 问题：开发环境找不到库

**检查步骤**：

1. 确认库文件存在：
```bash
ls vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

2. 检查 rpath 配置：
```bash
otool -l native/build/Release/mpv_binding.node | grep -A2 LC_RPATH
```

3. 检查库依赖：
```bash
otool -L native/build/Release/mpv_binding.node | head -5
```

4. 手动测试加载：
```bash
DYLD_PRINT_LIBRARIES=1 node -e "require('./native/build/Release/mpv_binding.node')"
```

### 问题：生产环境找不到库

**检查步骤**：

1. 确认打包后的库存在：
```bash
ls "dist/mac-arm64/MPV Player.app/Contents/Resources/lib/libmpv.2.dylib"
```

2. 检查 rpath：
```bash
otool -l "dist/mac-arm64/MPV Player.app/Contents/Resources/app.asar.unpacked/native/build/Release/mpv_binding.node" | grep -A2 LC_RPATH
```

## 📚 相关文档

- [开发环境设置](SETUP_GUIDE.md) - 完整的开发环境配置
- [部署指南](../deployment/DEPLOYMENT.md) - 生产环境打包和分发
- [快速构建指南](../BUILD.md) - 构建流程快速参考
