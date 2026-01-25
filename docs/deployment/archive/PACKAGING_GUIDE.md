# Electron 打包指南 - 确保新用户可直接使用

## 关键要求

✅ **所有依赖库必须打包到应用内**，不能依赖系统 Homebrew 安装

## 当前配置状态

### ✅ 已完成的配置

1. **依赖库路径**：
   - ✅ 所有 Homebrew 依赖使用 `@loader_path/bundled/...` 相对路径
   - ✅ 所有依赖库拷贝到 `vendor/mpv/darwin-arm64/lib/bundled/`
   - ✅ `libmpv.2.dylib` 使用 `@rpath/libmpv.2.dylib`（native addon 通过 rpath 找到）

2. **Native addon rpath**：
   - ✅ `@loader_path/../../../vendor/mpv/darwin-arm64/lib` - 找到 libmpv.2.dylib
   - ✅ `@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled` - 找到所有依赖库

3. **路径解析**：
   - ✅ 使用相对路径（`@loader_path`），不依赖绝对路径
   - ✅ 路径解析基于 native addon 的位置，不依赖系统安装

## Electron 打包配置

### electron-vite 打包

`electron-vite` 默认会：
- ✅ 自动包含 `vendor/` 目录（如果存在）
- ✅ 自动处理 native addon（不会被压缩到 asar）
- ✅ Native addon 会自动放在 unpacked 目录

### 验证打包结果

打包后检查：

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

**应该看到：**
- ✅ `mpv_binding.node` 在 unpacked 目录中
- ✅ `vendor/mpv/darwin-arm64/lib/libmpv.2.dylib` 存在
- ✅ `vendor/mpv/darwin-arm64/lib/bundled/*.dylib` 所有库都存在

## 路径解析验证

### 开发环境路径

```
native/build/Release/mpv_binding.node
  @loader_path = native/build/Release/
  @loader_path/../../../vendor/mpv/darwin-arm64/lib = vendor/mpv/darwin-arm64/lib ✅
  @loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled = vendor/mpv/darwin-arm64/lib/bundled ✅
```

### 生产环境路径（打包后）

```
YourApp.app/Contents/Resources/app.asar.unpacked/native/build/Release/mpv_binding.node
  @loader_path = app.asar.unpacked/native/build/Release/
  @loader_path/../../../vendor/mpv/darwin-arm64/lib = app.asar.unpacked/vendor/mpv/darwin-arm64/lib ✅
  @loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled = app.asar.unpacked/vendor/mpv/darwin-arm64/lib/bundled ✅
```

## 最终验证清单

在打包前运行：

```bash
./scripts/verify_distribution.sh
```

**必须全部通过：**
- ✅ libmpv.2.dylib 存在
- ✅ 所有依赖使用 `@loader_path` 相对路径
- ✅ bundled 目录存在且包含所有库
- ✅ Native addon rpath 配置正确
- ✅ binding.gyp 包含 bundled 目录

## 在新用户机器上测试

1. **在没有 Homebrew 的机器上**：
   - 解压安装包
   - 运行应用
   - 检查是否能正常启动
   - 检查是否能加载 native addon

2. **如果失败，检查**：
   - 控制台日志中的路径错误
   - 使用 `otool -L` 检查依赖
   - 使用 `DYLD_PRINT_LIBRARIES=1` 查看库加载过程

## 注意事项

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

## 总结

✅ **当前配置应该可以在新用户机器上直接使用**，因为：
1. 所有依赖使用相对路径（`@loader_path`）
2. 所有依赖库都打包到应用内
3. Native addon rpath 配置正确
4. 不依赖系统 Homebrew 安装

**建议：**
- 运行 `./build_mpv.sh` 确保所有依赖都被拷贝
- 运行 `./scripts/verify_distribution.sh` 验证配置
- 在实际打包后测试在没有 Homebrew 的机器上运行
