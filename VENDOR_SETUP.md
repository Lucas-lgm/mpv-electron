# MPV Vendor 依赖管理指南

本文档说明如何管理 mpv 播放器的所有依赖库，实现独立打包和分发。

## 快速开始

### 一键构建（推荐）

直接运行构建脚本，它会自动完成所有步骤：

```bash
./build_mpv.sh
```

这个命令会：
1. ✅ 配置并编译 mpv
2. ✅ 复制所有依赖到 vendor 目录（101个库文件）
3. ✅ 创建符号链接（84个链接）
4. ✅ 修复所有路径为 @rpath
5. ✅ 验证最终配置

执行完成后，所有依赖都在 `vendor/mpv/darwin-arm64/lib/` 目录中。

### 单独更新依赖

如果只需要重新复制依赖（不重新编译 mpv）：

```bash
./copy_dependencies.sh
```

## 目录结构

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

## 脚本说明

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

**依赖树示例**:
```
libmpv.2.dylib
├── libass.9.dylib
│   ├── libfreetype.6.dylib
│   │   └── libpng16.16.dylib
│   ├── libfribidi.0.dylib
│   └── libharfbuzz.0.dylib
│       └── libglib-2.0.0.dylib
├── libavcodec.62.dylib
│   ├── libx264.165.dylib
│   ├── libx265.215.dylib
│   ├── libaom.3.dylib
│   └── libdav1d.7.dylib
└── ...
```

### 3. 符号链接和路径修复

`copy_dependencies.sh` 会自动完成：
- 创建版本号符号链接（为带完整版本号的库创建简化版本号链接）
- 修复所有路径为 @rpath（确保所有依赖都使用 @rpath 相对路径）

**符号链接示例**:
```bash
# 原始文件: libavcodec.62.11.100.dylib
# 自动创建链接:
libavcodec.62.11.dylib -> libavcodec.62.11.100.dylib
libavcodec.62.dylib -> libavcodec.62.11.100.dylib
```

**路径修复**:
- 所有库的 install_name 修改为 `@rpath/xxx.dylib`
- 所有依赖路径从 `/opt/homebrew/...` 改为 `@rpath/xxx.dylib`

**验证命令**:
```bash
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

应该看到所有第三方库都是 `@rpath/xxx.dylib` 格式。

## 依赖库统计

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

## 在应用中使用

### Electron + Node.js Addon

在 `native/binding.gyp` 中配置 rpath：

```json
{
  "xcode_settings": {
    "OTHER_LDFLAGS": [
      "-Wl,-rpath,@loader_path/../../../vendor/mpv/darwin-arm64/lib"
    ]
  }
}
```

### 纯 Electron

在主进程中设置环境变量：

```typescript
import { app } from 'electron';
import path from 'path';

const vendorLib = path.join(app.getAppPath(), 'vendor/mpv/darwin-arm64/lib');
process.env.DYLD_LIBRARY_PATH = vendorLib;
```

### 验证加载

```bash
# 检查库文件依赖
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib

# 验证所有符号链接
ls -lh vendor/mpv/darwin-arm64/lib/*.dylib | grep '^l'

# 测试加载（如果有 node addon）
node -e "require('./build/Release/mpv.node')"
```

## 更新依赖

### 更新 Homebrew 包

```bash
# 更新 homebrew
brew update
brew upgrade ffmpeg-full
brew upgrade libass
brew upgrade libplacebo
# ... 其他依赖

# 重新构建
./build_mpv.sh
```

### 更新 MPV 源码

```bash
cd mpv
git pull origin master

cd ..
./build_mpv.sh
```

### 手动复制特定库

如果只需要更新某个库：

```bash
cp /opt/homebrew/opt/ffmpeg-full/lib/libavcodec.*.dylib \
   vendor/mpv/darwin-arm64/lib/

./copy_dependencies.sh
```

## 故障排查

### 问题 1: "Library not loaded" 错误

**症状**: 运行时提示找不到某个库

**解决方案**:
```bash
# 1. 检查库是否存在
ls vendor/mpv/darwin-arm64/lib/libxxx.dylib

# 2. 检查依赖路径
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib

# 3. 重新修复路径
./copy_dependencies.sh
```

### 问题 2: 符号链接丢失

**症状**: 提示找不到 `libavcodec.62.dylib`，但存在 `libavcodec.62.11.100.dylib`

**解决方案**:
```bash
./copy_dependencies.sh
```

### 问题 3: 权限问题

**症状**: 复制脚本报 "Permission denied"

**解决方案**:
```bash
# 清理旧文件
rm -f vendor/mpv/darwin-arm64/lib/*.dylib

# 重新复制
./copy_dependencies.sh
```

### 问题 4: 依赖树不完整

**症状**: 某些二级或三级依赖未被复制

**解决方案**:
```bash
# 手动运行依赖复制脚本（它会递归处理）
./copy_dependencies.sh

# 验证特定库的依赖
otool -L vendor/mpv/darwin-arm64/lib/libavcodec.*.dylib
```

## 打包分发

### macOS App Bundle

将 vendor 目录打包进 app：

```
MyApp.app/
├── Contents/
│   ├── MacOS/
│   │   └── MyApp
│   ├── Resources/
│   │   └── vendor/
│   │       └── mpv/
│   │           └── darwin-arm64/
│   │               └── lib/
│   │                   └── *.dylib
│   └── Info.plist
```

在代码中设置 rpath：
```cpp
@executable_path/../Resources/vendor/mpv/darwin-arm64/lib
```

### DMG 分发

```bash
# 创建 DMG
hdiutil create -volname "MyApp" -srcfolder MyApp.app -ov -format UDZO MyApp.dmg
```

## 许可证注意事项

vendor 目录中的库文件遵循各自的开源许可证：

- **MPV**: GPLv2+
- **FFmpeg**: LGPLv2.1+ / GPLv2+（取决于编译选项）
- **x264**: GPL
- **libass**: ISC License

⚠️ **重要**: 如果你的应用需要闭源分发，请确保：
1. 使用 LGPL 版本的 FFmpeg
2. 移除 GPL 组件（如 x264）
3. 咨询法律顾问

## 性能优化

### 减小分发包大小

```bash
# 1. 移除调试符号
cd vendor/mpv/darwin-arm64/lib
strip -x *.dylib

# 2. 使用 UPX 压缩（可选）
upx --best libmpv.2.dylib
```

### 按需加载

只打包实际使用的编解码器依赖，例如：
- 只需要 H.264: 保留 libx264, libavcodec
- 不需要蓝光: 移除 libbluray
- 不需要 AI 功能: 移除 libwhisper, libggml

## 参考资料

- [MPV 文档](https://mpv.io/manual/master/)
- [FFmpeg 文档](https://ffmpeg.org/documentation.html)
- [macOS dyld 文档](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/DynamicLibraries/)
- [install_name_tool man page](https://www.manpagez.com/man/1/install_name_tool/)

---

最后更新：2026-01-21
