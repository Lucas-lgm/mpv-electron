# 分发检查清单 - 确保新用户可直接使用

## 关键要求

✅ **所有依赖库必须打包到应用内**，不能依赖系统 Homebrew 安装

## 当前配置检查

### 1. 依赖库路径配置

**libmpv.2.dylib 的依赖路径：**
- ✅ 使用 `@loader_path/bundled/...` 引用所有 Homebrew 依赖
- ✅ 所有依赖库拷贝到 `vendor/mpv/darwin-arm64/lib/bundled/`

**Native addon 的 rpath 配置：**
- ✅ `@loader_path/../../../vendor/mpv/darwin-arm64/lib` - 找到 libmpv.2.dylib
- ✅ `@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled` - 找到所有依赖库

### 2. 路径解析逻辑

**开发环境：**
- Native addon 位置：`out/Release/mpv_binding.node` 或 `native/build/Release/mpv_binding.node`
- `@loader_path` = native addon 的位置
- `@loader_path/../../../vendor/mpv/darwin-arm64/lib` = `vendor/mpv/darwin-arm64/lib` ✅
- `@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled` = `vendor/mpv/darwin-arm64/lib/bundled` ✅

**生产环境（Electron 打包后）：**
- Native addon 位置：`app.asar.unpacked/native/build/Release/mpv_binding.node` 或 `Resources/app.asar.unpacked/native/build/Release/mpv_binding.node`
- `@loader_path` = native addon 的位置
- `@loader_path/../../../vendor/mpv/darwin-arm64/lib` = `vendor/mpv/darwin-arm64/lib` ✅
- `@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled` = `vendor/mpv/darwin-arm64/lib/bundled` ✅

### 3. Electron 打包配置

**需要确保：**
1. ✅ `vendor/mpv/darwin-arm64/lib/libmpv.2.dylib` 被打包
2. ✅ `vendor/mpv/darwin-arm64/lib/bundled/*.dylib` 所有文件被打包
3. ✅ `native/build/Release/mpv_binding.node` 被打包
4. ✅ Native addon 不被压缩到 asar 中（需要 unpacked）

## 验证步骤

### 步骤 1：运行构建脚本

```bash
./build_mpv.sh
```

检查输出：
- ✅ 所有 Homebrew 依赖库都被拷贝
- ✅ 依赖路径都修复为 `@loader_path/bundled/...`
- ✅ 没有遗漏的依赖

### 步骤 2：验证依赖路径

```bash
# 检查 libmpv 的依赖
otool -L vendor/mpv/darwin-arm64/lib/libmpv.2.dylib | grep -E "@loader_path|@rpath"

# 检查所有 bundled 库的依赖
for lib in vendor/mpv/darwin-arm64/lib/bundled/*.dylib; do
    echo "=== $(basename $lib) ==="
    otool -L "$lib" | grep -E "/opt/homebrew|@loader_path"
done
```

**应该看到：**
- ✅ 所有依赖都使用 `@loader_path/bundled/...`
- ✅ 没有 `/opt/homebrew/...` 路径（除了已拷贝的库）

### 步骤 3：检查 native addon 的 rpath

```bash
otool -l native/build/Release/mpv_binding.node | grep -A 2 "LC_RPATH"
```

**应该看到：**
- ✅ `@loader_path/../../../vendor/mpv/darwin-arm64/lib`
- ✅ `@loader_path/../../../vendor/mpv/darwin-arm64/lib/bundled`

### 步骤 4：测试加载（本地）

```bash
node -e "require('./native/build/Release/mpv_binding.node'); console.log('✅ Success')"
```

### 步骤 5：Electron 打包配置

**需要配置 electron-vite 或 electron-builder：**

如果使用 `electron-vite build`：
- 确保 `vendor/` 目录被包含
- 确保 native addon 不被压缩到 asar

如果使用 `electron-builder`：
- 在 `package.json` 中添加 `files` 配置
- 配置 `asarUnpack` 包含 native addon

## 潜在问题

### 问题 1：Native addon 被压缩到 asar

**解决方案：**
- 配置 `asarUnpack` 或 `asar: false` 对于 native addon
- Native addon 必须在 unpacked 目录中

### 问题 2：路径解析失败

**检查：**
- `@loader_path` 是否正确解析
- 相对路径是否正确（`../../../` 是否正确）

### 问题 3：遗漏依赖

**检查：**
- 运行 `otool -L` 检查所有库
- 确保所有 `/opt/homebrew/...` 路径都被替换

## 最终验证

在新用户机器上（没有 Homebrew）：
1. 解压安装包
2. 运行应用
3. 检查是否能找到 native addon
4. 检查是否能加载 libmpv

如果失败，检查：
- 控制台日志中的路径
- 使用 `otool -L` 检查依赖
- 使用 `DYLD_PRINT_LIBRARIES=1` 查看库加载过程
