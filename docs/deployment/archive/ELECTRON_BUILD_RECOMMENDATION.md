# Electron 应用构建方案推荐

## 概述

对于 Electron 应用，libmpv 的构建方式需要平衡以下因素：
- **部署便利性**：减少用户环境依赖
- **文件大小**：应用包体积
- **构建复杂度**：开发和维护成本
- **跨平台支持**：macOS / Windows / Linux

## 推荐方案：动态库（当前方案）✅

### 优点

1. **部署简单**
   - 动态库可以放在应用包内，通过 `@rpath` 或相对路径引用
   - Electron 打包工具（electron-builder）可以自动处理
   - 不需要修改 Electron 的打包流程

2. **文件大小合理**
   - 动态库本身约 10-20MB（取决于依赖）
   - 可以共享系统库（如 macOS 的 libSystem）
   - 应用包总体积较小

3. **兼容性好**
   - 与当前代码兼容（`binding.gyp` 已配置）
   - 支持运行时加载，错误处理更灵活
   - 符合 Electron 应用的标准做法

4. **开发友好**
   - 修改 libmpv 后只需替换 `.dylib` 文件
   - 不需要重新编译 native addon
   - 调试方便

### 当前实现

```bash
# macOS
vendor/mpv/darwin-arm64/lib/libmpv.2.dylib

# Windows (如果支持)
vendor/mpv/win32-x64/lib/libmpv.dll

# Linux (如果支持)
vendor/mpv/linux-x64/lib/libmpv.so
```

### 打包配置示例（electron-builder）

```json
{
  "build": {
    "extraResources": [
      {
        "from": "vendor/mpv/${os}-${arch}/lib",
        "to": "mpv/lib",
        "filter": ["**/*"]
      }
    ],
    "mac": {
      "extraResources": [
        {
          "from": "vendor/mpv/darwin-arm64/lib/libmpv.2.dylib",
          "to": "mpv/lib/libmpv.2.dylib"
        }
      ]
    }
  }
}
```

## 备选方案：静态库（不推荐用于 Electron）

### 缺点

1. **文件大小大**
   - 静态库可能达到 50-100MB+
   - 所有依赖都打包进去
   - 应用包体积显著增加

2. **构建复杂**
   - 需要静态构建所有依赖（ffmpeg、libplacebo、libass 等）
   - macOS 上某些系统库无法静态链接（如 iconv）
   - 跨平台构建配置复杂

3. **Electron 集成问题**
   - 需要修改 `binding.gyp` 链接静态库
   - 可能遇到符号冲突问题
   - 调试困难

4. **更新不便**
   - 更新 libmpv 需要重新编译整个应用
   - 无法单独更新视频解码库

### 适用场景

静态库**仅适合**以下情况：
- 需要完全独立的二进制文件（非 Electron）
- 目标系统没有动态库支持
- 特殊的安全/合规要求

## 推荐配置

### macOS 构建脚本（动态库）

```bash
#!/bin/bash
# build_mpv.sh - 推荐配置

cd mpv

meson setup build \
  --buildtype=release \
  -Dlibmpv=true \
  -Dcplayer=false \
  -Dswift-build=enabled \
  -Dmanpage-build=disabled \
  -Dhtml-build=disabled \
  -Dtests=false \
  -Dgpl=true \
  -Dgl=enabled \
  -Diconv=auto \
  -Dlcms2=enabled \
  -Djpeg=enabled \
  -Dzlib=enabled \
  -Dcocoa=enabled \
  -Dcoreaudio=enabled \
  -Dgl-cocoa=enabled \
  -Dvideotoolbox-gl=enabled \
  -Dvideotoolbox-pl=enabled \
  -Dmacos-cocoa-cb=enabled \
  -Dmacos-media-player=enabled \
  -Dplain-gl=enabled

meson compile -C build

# 复制到 vendor 目录
cp build/libmpv.2.dylib vendor/mpv/darwin-arm64/lib/
install_name_tool -id "@rpath/libmpv.2.dylib" vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

### binding.gyp 配置（已正确）

当前配置已经正确使用动态库：

```json
{
  "link_settings": {
    "libraries": [
      "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib/libmpv.2.dylib"
    ],
    "library_dirs": [
      "<(module_root_dir)/../vendor/mpv/darwin-arm64/lib"
    ]
  },
  "xcode_settings": {
    "LD_RUNPATH_SEARCH_PATHS": [
      "@loader_path/../../../vendor/mpv/darwin-arm64/lib"
    ]
  }
}
```

## 部署建议

### 1. 应用内打包（推荐）

将 libmpv 放在应用包内：

```
YourApp.app/
  Contents/
    Resources/
      mpv/
        lib/
          libmpv.2.dylib
    MacOS/
      YourApp
      mpv_binding.node  (native addon)
```

### 2. 使用 @rpath

确保 native addon 能找到动态库：

```bash
# 设置正确的 rpath
install_name_tool -add_rpath "@loader_path/../Resources/mpv/lib" mpv_binding.node
```

### 3. Electron Builder 配置

```json
{
  "build": {
    "appId": "com.yourcompany.mpv-player",
    "mac": {
      "target": ["dmg", "zip"],
      "extraResources": [
        {
          "from": "vendor/mpv/darwin-arm64/lib/libmpv.2.dylib",
          "to": "mpv/lib/libmpv.2.dylib"
        }
      ]
    },
    "files": [
      "out/**/*",
      "vendor/mpv/**/include/**/*"
    ]
  }
}
```

## 总结

**推荐使用动态库方案**，原因：

1. ✅ **符合 Electron 最佳实践**
2. ✅ **部署和维护简单**
3. ✅ **文件大小合理**
4. ✅ **与当前代码兼容**
5. ✅ **跨平台支持友好**

**静态库方案**仅在不使用 Electron 或特殊需求时考虑。

## 下一步

1. 保持当前的动态库构建方式
2. 配置 electron-builder 正确打包动态库
3. 测试应用打包后的 libmpv 加载
4. 如需支持 Windows/Linux，按相同方式构建对应平台的动态库
