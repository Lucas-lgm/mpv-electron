# 开发环境库文件位置说明

## 开发环境 vs 生产环境

### 开发环境

**库文件位置：**
```
项目根目录/
├── vendor/mpv/darwin-arm64/lib/    ← 源码库位置
│   ├── libmpv.2.dylib
│   └── ... (185个文件)
└── native/build/Release/
    └── mpv_binding.node             ← native addon
```

**RPath 配置：**
```
@loader_path/../../../vendor/mpv/darwin-arm64/lib
```

**路径计算：**
- `@loader_path` = `native/build/Release/`
- `../../../vendor/mpv/darwin-arm64/lib` = `vendor/mpv/darwin-arm64/lib/` ✓

### 生产环境（打包后）

**库文件位置：**
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

**RPath 配置：**
```
@loader_path/../../../../lib
```

**路径计算：**
- `@loader_path` = `app.asar.unpacked/native/build/Release/`
- `../../../../lib` = `Resources/lib/` ✓

## 配置说明

### native/binding.gyp

使用多个 rpath，按优先级查找：

```json
{
  "LD_RUNPATH_SEARCH_PATHS": [
    "@loader_path/../../../vendor/mpv/darwin-arm64/lib",  // 开发环境
    "@loader_path/../../../../lib"                         // 生产环境
  ]
}
```

**查找顺序：**
1. 先查找开发环境路径（`vendor/mpv/darwin-arm64/lib/`）
2. 如果找不到，再查找生产环境路径（`Resources/lib/`）

## 运行开发环境

### 1. 构建 native addon

```bash
npm run build:native
```

### 2. 启动开发服务器

```bash
npm run dev
```

### 3. 验证库加载

检查控制台输出，应该看到：
```
[libmpv] ✅ Native binding loaded from: .../native/build/Release/mpv_binding.node
```

## 故障排查

### 问题：开发环境找不到库

**检查步骤：**

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

**检查步骤：**

1. 确认打包后的库存在：
```bash
ls "dist/mac-arm64/MPV Player.app/Contents/Resources/lib/libmpv.2.dylib"
```

2. 检查 rpath：
```bash
otool -l "dist/mac-arm64/MPV Player.app/Contents/Resources/app.asar.unpacked/native/build/Release/mpv_binding.node" | grep -A2 LC_RPATH
```

## 路径优先级

dyld 会按顺序在 rpath 列表中查找库：

1. **开发环境**：`@loader_path/../../../vendor/mpv/darwin-arm64/lib`
   - 如果存在，使用这个路径
   
2. **生产环境**：`@loader_path/../../../../lib`
   - 如果开发环境路径不存在，使用这个路径

这样配置可以同时支持开发和生产环境。

---

最后更新：2026-01-21
