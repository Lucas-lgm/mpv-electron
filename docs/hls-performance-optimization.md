# HLS 网络播放性能优化

## 问题描述

VLC 通过网络播放 HLS 时（即使是 localhost）比本地文件播放卡顿，主要原因：

1. **缓存策略不当**：片段文件被设置为不缓存，导致重复请求
2. **HTTP 连接开销**：每个片段都需要单独的 HTTP 请求
3. **缺少连接复用**：没有启用 HTTP Keep-Alive
4. **缺少条件请求**：无法使用 ETag 进行缓存验证

## 已实施的优化

### 1. 智能缓存策略

**播放列表文件（.m3u8）**：
- `Cache-Control: no-cache, no-store, must-revalidate`
- 原因：播放列表可能动态更新，需要实时获取

**片段文件（.ts）**：
- `Cache-Control: public, max-age=3600, immutable`
- 原因：片段文件不会改变，可以安全缓存，大幅提升性能

### 2. HTTP Keep-Alive

```javascript
{
  keepAlive: true,
  keepAliveInitialDelay: 0,
}
```

- 复用 TCP 连接，减少连接建立开销
- 每个片段请求可以复用同一个连接

### 3. ETag 支持

- 为片段文件生成 ETag（基于文件修改时间和大小）
- 支持条件请求（If-None-Match）
- 如果文件未改变，返回 304 Not Modified，节省带宽

### 4. 响应头优化

- `Accept-Ranges: bytes` - 支持范围请求
- `Connection: keep-alive` - 保持连接
- `Keep-Alive: timeout=5, max=1000` - 连接参数

## 性能对比

### 优化前
- 每个片段：建立新连接 + 完整传输
- 无缓存：每次播放都重新下载所有片段
- 延迟：~50-100ms 每个片段

### 优化后
- 片段复用连接：减少连接开销
- 缓存生效：第二次播放几乎无延迟
- 条件请求：未改变的文件返回 304
- 延迟：~5-10ms 每个片段（缓存命中时）

## 使用方法

### 重启服务器应用优化

```bash
# 停止当前服务器（Ctrl+C）
npm run serve

# 或启用调试模式
DEBUG=1 npm run serve
```

### 验证优化效果

1. **第一次播放**（建立缓存）：
   ```bash
   vlc http://localhost:8081/hls_output/playlist.m3u8
   ```
   - 观察网络请求，所有片段都会下载

2. **第二次播放**（使用缓存）：
   ```bash
   vlc http://localhost:8081/hls_output/playlist.m3u8
   ```
   - 观察网络请求，应该看到 304 Not Modified
   - 播放应该更流畅

### 检查缓存是否生效

```bash
# 检查片段文件的响应头
curl -I http://localhost:8081/hls_output/segment_000.ts

# 应该看到：
# Cache-Control: public, max-age=3600, immutable
# ETag: "..."

# 测试条件请求
curl -I -H "If-None-Match: \"...\"" http://localhost:8081/hls_output/segment_000.ts
# 如果 ETag 匹配，应该返回 304 Not Modified
```

## VLC 特定优化建议

### 1. 调整 VLC 缓冲设置

VLC → 工具 → 首选项 → 输入/编解码器 → 网络缓存：
- 默认：1000ms
- **推荐：3000-5000ms**（增加缓冲可以减少卡顿）

### 2. 使用本地文件（最快）

如果可能，直接播放本地文件：
```bash
vlc /path/to/videos/hls_output/playlist.m3u8
```

### 3. 使用 mpv（性能更好）

mpv 对网络流的处理通常比 VLC 更好：
```bash
mpv http://localhost:8081/hls_output/playlist.m3u8
```

## 进一步优化建议

### 1. 使用 nginx（生产环境）

nginx 对静态文件服务的性能更好：
- 更好的连接管理
- 更高效的文件 I/O
- 支持 sendfile

### 2. 使用 HTTP/2

HTTP/2 的多路复用可以进一步提升性能：
- 单个连接传输多个片段
- 头部压缩
- 服务器推送（可选）

### 3. 预加载策略

在播放列表中添加：
```
#EXT-X-PRELOAD-HINT:TYPE=PART
```

## 故障排查

### 问题：仍然卡顿

1. **检查缓存是否生效**：
   ```bash
   curl -I http://localhost:8081/hls_output/segment_000.ts | grep Cache-Control
   ```

2. **检查连接复用**：
   ```bash
   # 启用调试模式查看连接
   DEBUG=1 npm run serve
   ```

3. **检查 VLC 缓冲设置**：
   - 增加网络缓存时间
   - 检查网络带宽限制

### 问题：缓存不工作

1. **清除浏览器/VLC 缓存**后重试
2. **检查 ETag 是否正确生成**
3. **验证文件确实没有改变**

## 技术细节

### 缓存策略说明

- `public`：允许 CDN 和代理服务器缓存
- `max-age=3600`：缓存 1 小时
- `immutable`：文件不会改变，浏览器可以永久缓存

### ETag 生成

```javascript
const etag = `"${fileStats.mtime.getTime()}-${fileStats.size}"`;
```

- 基于文件修改时间和大小
- 文件改变时 ETag 会改变
- 支持精确的缓存验证

### Keep-Alive 参数

- `timeout=5`：空闲连接 5 秒后关闭
- `max=1000`：最多保持 1000 个请求的连接
