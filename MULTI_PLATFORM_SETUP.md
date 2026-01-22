# 多平台库路径配置说明

## 设计原则

所有平台的库文件统一放在 `Resources/lib/` 目录，通过 rpath 配置自动查找。

## 目录结构

```
vendor/
└── mpv/
    ├── darwin-arm64/      # macOS Apple Silicon
    │   ├── include/
    │   └── lib/
    ├── darwin-x64/        # macOS Intel
    │   ├── include/
    │   └── lib/
    ├── win32-x64/         # Windows 64-bit
    │   ├── include/
    │   └── bin/           # Windows 使用 .dll
    └── linux-x64/         # Linux 64-bit
        ├── include/
        └── lib/
```

## 打包后的位置

所有平台的库文件都打包到：
```
App.app/Contents/Resources/lib/
```

## RPath 配置

### macOS

所有架构统一使用：
```
@loader_path/../../../../lib
```

从 `app.asar.unpacked/native/build/Release/mpv_binding.node` 计算：
- `@loader_path` = `app.asar.unpacked/native/build/Release/`
- `../../../../lib` = `Resources/lib/` ✓

## 优势

1. **统一路径**：所有平台使用 `Resources/lib/`
2. **简化配置**：rpath 配置一致
3. **易于维护**：清晰的目录结构
4. **跨平台**：相同的打包逻辑
