# 部署指南 - Electron应用打包与分发

> **最后更新**: 2026-01-25  
> **状态**: 生产就绪  
> **目标平台**: macOS (ARM64)

## 📦 概述

本指南涵盖 mpv-player 应用的完整打包和分发流程，确保新用户无需安装 Homebrew 等依赖即可直接使用。

### 核心原则
✅ **所有依赖库必须打包到应用内**，不能依赖系统 Homebrew 安装  
✅ **使用相对路径** (`@loader_path`) 而非绝对路径 (`/opt/homebrew`)  
✅ **Native addon 必须在 unpacked 目录中**，不能被压缩到 asar

---

## 🛠️ 构建配置

### 1. 动态库方案（推荐 ✅）

**为什么选择动态库**：
- ✅ **部署简单**：动态库可以放在应用包内，通过 `@rpath` 引用
- ✅ **文件大小合理**：约 10-20MB（vs 静态库 50-100MB+）
- ✅ **兼容性好**：与当前代码兼容，支持运行时加载
- ✅ **开发友好**：修改后只需替换 `.dylib` 文件

**当前实现**：
```bash
vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

### 2. 路径配置验证

**依赖库路径配置**：
```bash
# libmpv.2.dylib 的依赖使用相对路径
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep "@loader_path"

# 应该看到：
@loader_path/bundled/libavcodec.60.dylib
@loader_path/bundled/libplacebo.73.dylib
# ... 其他依赖
```

**Native addon 的 rpath 配置**：
```bash
otool -l native/build/Release/mpv_binding.node | grep -A 2 "LC_RPATH"

# 应该看到：
@loader_path/../../../vendor/mpv/darwin-arm64/lib
@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled
```

### 3. 路径解析逻辑

**开发环境**：
```
native/build/Release/mpv_binding.node
  @loader_path = native/build/Release/
  @loader_path/../../../vendor/mpv/darwin-arm64/lib = vendor/mpv/darwin-arm64/lib ✅
  @loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled = vendor/mpv/darwin-arm64/lib/bundled ✅
```

**生产环境（打包后）**：
```
YourApp.app/Contents/Resources/app.asar.unpacked/native/build/Release/mpv_binding.node
  @loader_path = app.asar.unpacked/native/build/Release/
  @loader_path/../../../vendor/mpv/darwin-arm64/lib = app.asar.unpacked/vendor/mpv/darwin-arm64/lib ✅
  @loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled = app.asar.unpacked/vendor/mpv/darwin-arm64/lib/bundled ✅
```

---

## 📋 部署检查清单

### 构建前检查
- [ ] 运行 `./build_mpv.sh` 确保所有依赖被拷贝
- [ ] 验证依赖使用 `@loader_path` 相对路径
- [ ] 确认 bundled 目录包含所有库
- [ ] 检查 native addon rpath 配置正确

### 构建脚本
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

### binding.gyp 配置
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

---

## 🚀 Electron 打包配置

### electron-vite 打包
`electron-vite` 默认会：
- ✅ 自动包含 `vendor/` 目录（如果存在）
- ✅ 自动处理 native addon（不会被压缩到 asar）
- ✅ Native addon 会自动放在 unpacked 目录

### 验证打包结果
```bash
# 1. 检查应用包结构
ls -R "dist/mac-arm64/YourApp.app/Contents/"

# 2. 检查 native addon 位置
find "dist/mac-arm64/YourApp.app" -name "mpv_binding.node"

# 3. 检查 vendor 目录
find "dist/mac-arm64/YourApp.app" -path "*/vendor/mpv/darwin-arm64/lib/*"

# 4. 检查 bundled 目录
find "dist/mac-arm64/YourApp.app" -path "*/bundled/*.dylib"
```

**应该看到**：
- ✅ `mpv_binding.node` 在 unpacked 目录中
- ✅ `vendor/mpv/darwin-arm64/lib/libmpv.2.dylib` 存在
- ✅ `vendor/mpv/darwin-arm64/lib/bundled/*.dylib` 所有库都存在

### 应用内打包结构
```
YourApp.app/
  Contents/
    Resources/
      app.asar.unpacked/
        vendor/mpv/darwin-arm64/lib/
          libmpv.2.dylib
          bundled/*.dylib
        native/build/Release/
          mpv_binding.node
    MacOS/
      YourApp
```

---

## 🔍 验证步骤

### 步骤 1：验证依赖路径
```bash
# 检查 libmpv 的依赖
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep -E "@loader_path|@rpath"

# 检查所有 bundled 库的依赖
for lib in vendor/mpv/darwin-arm64/lib/bundled/*.dylib; do
    echo "=== $(basename $lib) ==="
    otool -L "$lib" | grep -E "/opt/homebrew|@loader_path"
done
```

**应该看到**：
- ✅ 所有依赖都使用 `@loader_path/bundled/...`
- ✅ 没有 `/opt/homebrew/...` 路径

### 步骤 2：测试加载
```bash
# 测试本地加载
node -e "require('./native/build/Release/mpv_binding.node'); console.log('✅ Native addon 加载成功')"

# 测试 Electron 环境（如果已安装）
npx electron -e "require('./native/build/Release/mpv_binding.node'); console.log('✅ Electron 环境加载成功')"
```

### 步骤 3：验证脚本
创建 `scripts/verify_distribution.sh`：
```bash
#!/bin/bash
echo "=== 分发验证脚本 ==="

# 检查 libmpv 存在
if [ ! -f "vendor/mpv/darwin-arm64/lib/libmpv.2.dylib" ]; then
    echo "❌ libmpv.2.dylib 不存在"
    exit 1
fi

# 检查依赖路径
echo "检查依赖路径..."
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep -q "/opt/homebrew"
if [ $? -eq 0 ]; then
    echo "❌ libmpv 包含绝对路径依赖"
    exit 1
fi

# 检查 bundled 目录
if [ ! -d "vendor/mpv/darwin-arm64/lib/bundled" ]; then
    echo "❌ bundled 目录不存在"
    exit 1
fi

echo "✅ 所有检查通过"
```

---

## ⚠️ 常见问题与解决方案

### 问题 1：Native addon 被压缩到 asar
**症状**：应用启动时找不到 native addon

**解决方案**：
- 配置 `asarUnpack` 包含 native addon
- Native addon 必须在 unpacked 目录中

### 问题 2：路径解析失败
**症状**：加载 libmpv 失败

**检查**：
- `@loader_path` 是否正确解析
- 相对路径是否正确（`../../../` 是否正确）
- 使用 `DYLD_PRINT_LIBRARIES=1` 查看库加载过程

### 问题 3：遗漏依赖
**症状**：运行时缺少依赖库

**检查**：
```bash
# 检查所有依赖
for lib in vendor/mpv/darwin-arm64/lib/bundled/*.dylib; do
    otool -L "$lib" | grep "/opt/homebrew"
done
```

**解决**：确保 `build_mpv.sh` 拷贝了所有依赖

---

## 🧪 在新用户机器上测试

### 测试步骤
1. **在没有 Homebrew 的机器上**：
   - 解压安装包
   - 运行应用
   - 检查是否能正常启动
   - 检查是否能加载 native addon

2. **如果失败，检查**：
   - 控制台日志中的路径错误
   - 使用 `otool -L` 检查依赖
   - 使用 `DYLD_PRINT_LIBRARIES=1` 查看库加载过程

### 快速验证命令
```bash
# 检查应用包完整性
codesign -dv --verbose=4 YourApp.app

# 检查动态库依赖
otool -L YourApp.app/Contents/Resources/app.asar.unpacked/vendor/mpv/darwin-arm64/lib/libmpv.2.dylib
```

---

## 📝 注意事项

1. **Native addon 不能被压缩到 asar**：
   - electron-vite 会自动处理，但需要确认
   - Native addon 必须在 unpacked 目录中

2. **vendor 目录必须被打包**：
   - electron-vite 默认会包含，但需要确认
   - 如果使用 electron-builder，需要在 `files` 中明确指定

3. **路径必须使用相对路径**：
   - ✅ `@loader_path` - 基于加载库的位置
   - ✅ `@rpath` - 通过 rpath 解析
   - ❌ `/opt/homebrew/...` - 绝对路径，新用户没有

---

## ✅ 总结

当前配置应该可以在新用户机器上直接使用，因为：
1. 所有依赖使用相对路径（`@loader_path`）
2. 所有依赖库都打包到应用内
3. Native addon rpath 配置正确
4. 不依赖系统 Homebrew 安装

**建议流程**：
1. 运行 `./build_mpv.sh` 确保所有依赖都被拷贝
2. 运行 `./scripts/verify_distribution.sh` 验证配置
3. 构建应用：`npm run build`
4. 在实际打包后测试在没有 Homebrew 的机器上运行

---

## 🔄 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-01-25 | 创建合并后的部署指南，整合 DISTRIBUTION_CHECKLIST.md、PACKAGING_GUIDE.md、ELECTRON_BUILD_RECOMMENDATION.md |
| 2026-01-21 | 初始打包指南创建 |

## 📚 相关文档

- [架构文档](../ARCHITECTURE.md) - 了解应用整体架构
- [GPU-NEXT集成](../features/GPU_NEXT_INTEGRATION.md) - HDR渲染配置
- [开发指南](../development/SETUP_GUIDE.md) - 开发环境设置