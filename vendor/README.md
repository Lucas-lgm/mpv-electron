# MPV Vendor 依赖说明

本目录包含了 mpv 播放器的所有依赖库，用于构建和打包独立的应用程序。

## 目录结构

```
vendor/
└── mpv/
    └── darwin-arm64/
        ├── include/          # MPV 头文件
        │   └── mpv/
        │       ├── client.h
        │       ├── render_gl.h
        │       ├── render.h
        │       └── stream_cb.h
        └── lib/              # MPV 库文件及所有依赖
            ├── libmpv.2.dylib
            ├── libmpv.dylib -> libmpv.2.dylib
            └── [90+ 依赖库]
```

## 构建脚本

### build_mpv.sh
主构建脚本，用于编译 mpv 并自动复制所有依赖：

```bash
./build_mpv.sh
```

此脚本会：
1. 配置 meson 构建环境
2. 编译 libmpv
3. 自动调用 `copy_dependencies.sh` 复制所有依赖

### copy_dependencies.sh
依赖复制脚本，将 mpv 的所有依赖库复制到 vendor 目录：

```bash
./copy_dependencies.sh
```

此脚本会：
1. 分析 libmpv 的依赖树
2. 递归复制所有非系统库依赖（约 101 个库文件）
3. 自动调用 `create_symlinks.sh` 创建版本号符号链接
4. 自动调用 `fix_rpath.sh` 修改所有库的路径为 @rpath

### create_symlinks.sh
创建库文件的版本号符号链接：

```bash
./create_symlinks.sh
```

此脚本会为带完整版本号的库文件创建简化版本号的符号链接，例如：
- `libavcodec.62.11.100.dylib` → `libavcodec.62.dylib`
- `libjxl.0.11.1.dylib` → `libjxl.0.11.dylib` 和 `libjxl.0.dylib`

### fix_rpath.sh
修复所有库文件的依赖路径为 @rpath：

```bash
./fix_rpath.sh
```

此脚本会：
1. 遍历所有 vendor 中的库文件
2. 将 install_name 修改为 @rpath 相对路径
3. 将所有 homebrew 绝对路径依赖改为 @rpath 相对路径
4. 验证 libmpv 的最终依赖路径

## 依赖库列表

本项目包含以下主要依赖：

### 核心依赖
- **libmpv** - MPV 播放器核心库
- **ffmpeg** - 音视频编解码（libavcodec, libavformat, libavfilter, libavutil, libswscale, libswresample, libavdevice）

### 视频编解码
- **libx264, libx265** - H.264/H.265 编码器
- **libvpx** - VP8/VP9 编解码器
- **libaom** - AV1 编码器
- **libdav1d** - AV1 解码器
- **librav1e** - Rust AV1 编码器
- **libSvtAv1Enc** - SVT-AV1 编码器
- **libtheora** - Theora 编解码器

### 音频编解码
- **libopus** - Opus 音频编解码器
- **libvorbis** - Vorbis 音频编解码器
- **libmp3lame** - MP3 编码器
- **libspeex** - Speex 语音编解码器
- **libopencore-amr** - AMR 音频编解码器

### 图像处理
- **libpng** - PNG 图像库
- **libjpeg** - JPEG 图像库
- **libwebp** - WebP 图像库
- **libjxl** - JPEG XL 图像库
- **libtiff** - TIFF 图像库
- **libgif** - GIF 图像库

### 字幕与文本
- **libass** - 字幕渲染库
- **libfribidi** - Unicode 双向文本支持
- **libharfbuzz** - 文本整形引擎
- **libfreetype** - 字体渲染库
- **libtesseract** - OCR 文本识别

### 渲染与图形
- **libplacebo** - GPU 加速视频处理
- **libshaderc** - Shader 编译器
- **libvulkan** - Vulkan 图形 API
- **little-cms2** - 色彩管理

### 音频处理
- **librubberband** - 音频时间拉伸与音高变换
- **libsoxr** - 音频重采样
- **libsamplerate** - 采样率转换

### 网络协议
- **gnutls** - TLS/SSL 库
- **libsrt** - SRT 流媒体协议
- **librist** - RIST 流媒体协议
- **libssh** - SSH 协议
- **libzmq** - ZeroMQ 消息队列

### AI 功能
- **libwhisper** - Whisper AI 语音识别
- **libggml** - 机器学习推理

### 其他依赖
- **libbluray** - Blu-ray 光盘支持
- **libarchive** - 归档文件支持
- **luajit** - Lua JIT 编译器（脚本支持）
- **mujs** - JavaScript 引擎
- **vapoursynth** - 视频处理框架

### 系统依赖（不复制）
以下系统库不会被复制，因为它们是 macOS 系统自带的：
- `/usr/lib/libSystem.B.dylib`
- `/usr/lib/libiconv.2.dylib`
- `/System/Library/Frameworks/IOKit.framework`
- `/System/Library/Frameworks/QuartzCore.framework`

## 路径配置

所有依赖库都已配置为使用 `@rpath` 相对路径，这意味着：

1. **开发环境**：需要在应用中设置正确的 rpath
2. **打包分发**：所有依赖都可以放在同一目录下
3. **跨平台**：便于在不同的 macOS 系统上运行

### 在 Electron 中使用

在 `native/binding.gyp` 中已配置：

```json
{
  "xcode_settings": {
    "OTHER_LDFLAGS": [
      "-Wl,-rpath,@loader_path/../../../vendor/mpv/darwin-arm64/lib"
    ]
  }
}
```

这确保了 Node.js addon 可以找到所有依赖库。

## 更新依赖

当 homebrew 更新某些依赖后，需要重新构建：

```bash
# 更新 homebrew
brew update
brew upgrade

# 重新构建 mpv 并复制依赖
./build_mpv.sh
```

## 磁盘空间

完整的 vendor 依赖大约占用 **60-80 MB** 的磁盘空间。

## 许可证

各依赖库的许可证请参考它们各自的项目：
- MPV: GPLv2+
- FFmpeg: LGPLv2.1+ / GPLv2+ (取决于编译选项)
- 其他依赖：各自的开源许可证

## 故障排查

### 如果出现 "Library not loaded" 错误

1. 检查 rpath 设置是否正确
2. 确认所有依赖都已复制到 vendor 目录
3. 使用 `otool -L` 检查库的依赖路径：

```bash
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

### 重新复制依赖

如果需要重新复制依赖（例如某些库损坏）：

```bash
./copy_dependencies.sh
```

## 技术细节

- **平台**: macOS (darwin-arm64)
- **架构**: ARM64 (Apple Silicon)
- **编译器**: Clang (Apple)
- **构建系统**: Meson + Ninja
- **依赖管理**: Homebrew

---

最后更新：2026-01-21
