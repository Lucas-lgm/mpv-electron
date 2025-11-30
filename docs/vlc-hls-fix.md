# VLC HLS 播放问题修复指南

## 问题
VLC 无法播放 HLS 流，但 mpv 和浏览器可以正常播放。

## 已修复的问题

### 1. MIME 类型
- **之前**: `application/vnd.apple.mpegurl` (Apple 官方类型)
- **现在**: `application/x-mpegURL` (VLC 更兼容)
- **片段文件**: `video/MP2T` (大写格式，某些播放器更兼容)

### 2. 路径转换
服务器自动将播放列表中的相对路径转换为绝对 URL。

### 3. 响应头优化
添加了 `Accept-Ranges: bytes` 头，某些播放器需要。

## 使用方法

### 重启服务器
```bash
# 停止当前服务器（Ctrl+C）
# 重新启动
npm run serve

# 或启用调试模式查看请求日志
DEBUG=1 npm run serve
```

### 测试 VLC 播放
1. 打开 VLC
2. 媒体 → 打开网络串流
3. 输入: `http://localhost:8080/hls_output/playlist.m3u8`

## 如果仍然有问题

### 检查清单
1. ✅ 服务器是否已重启（应用新的 MIME 类型）
2. ✅ 播放列表路径转换是否正常
3. ✅ 片段文件是否可以单独访问
4. ✅ VLC 版本是否过旧（建议使用最新版本）

### 调试步骤
```bash
# 1. 检查播放列表 MIME 类型
curl -I http://localhost:8080/hls_output/playlist.m3u8 | grep Content-Type
# 应该显示: Content-Type: application/x-mpegURL

# 2. 检查片段文件 MIME 类型
curl -I http://localhost:8080/hls_output/segment_000.ts | grep Content-Type
# 应该显示: Content-Type: video/MP2T

# 3. 查看播放列表内容（应该包含绝对 URL）
curl -s http://localhost:8080/hls_output/playlist.m3u8 | head -10

# 4. 启用调试模式查看 VLC 的请求
DEBUG=1 npm run serve
```

### 常见问题

**Q: VLC 仍然报 404 错误**
- 确保服务器已重启
- 检查 VLC 控制台日志，看它实际请求的 URL 是什么
- 尝试使用 `http://127.0.0.1:8080` 而不是 `http://localhost:8080`

**Q: VLC 可以加载播放列表但无法播放**
- 检查片段文件是否都存在
- 检查网络连接（VLC 可能需要完整的网络访问权限）

**Q: 其他播放器可以但 VLC 不行**
- 尝试更新 VLC 到最新版本
- 检查 VLC 的网络设置（工具 → 首选项 → 输入/编解码器 → 网络）

## 技术细节

### MIME 类型说明
- `application/x-mpegURL`: 更通用的 MIME 类型，VLC、Android 等更兼容
- `application/vnd.apple.mpegurl`: Apple 官方注册的类型，主要 Apple 设备使用
- `video/MP2T`: MPEG-2 Transport Stream 的标准 MIME 类型（大写格式）

### 路径转换逻辑
服务器检测到 `.m3u8` 文件时：
1. 读取播放列表内容
2. 查找所有 `segment_xxx.ts` 相对路径
3. 转换为 `http://host:port/dir/segment_xxx.ts` 格式
4. 返回修改后的内容

这样播放列表文件本身保持原始格式，但客户端收到的是转换后的版本。
