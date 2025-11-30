# 视频静态资源服务器指南

## 方法 1：使用 Node.js 脚本（推荐，已创建）

项目根目录已创建 `serve-video.js`，直接运行：

```bash
# 启动服务器（默认端口 8080，服务 videos 目录）
node serve-video.js

# 指定端口
node serve-video.js --port 3000

# 指定目录
node serve-video.js --dir videos --port 8080
```

访问：`http://localhost:8080/playlist.m3u8`

## 方法 2：使用 http-server（npm 包）

### 安装
```bash
npm install -g http-server
# 或本地安装
npm install --save-dev http-server
```

### 使用
```bash
# 在项目根目录启动，服务 videos 目录
http-server videos -p 8080 -c-1

# 参数说明：
# -p 8080: 端口号
# -c-1: 禁用缓存（对 HLS 很重要）
# --cors: 启用 CORS（如果需要跨域）
```

### 添加到 package.json
```json
{
  "scripts": {
    "serve:hls": "http-server videos -p 8080 -c-1 --cors"
  }
}
```

然后运行：`npm run serve:hls`

## 方法 3：使用 serve（更现代的 npm 包）

### 安装
```bash
npm install -g serve
# 或
npx serve
```

### 使用
```bash
# 服务 videos 目录
serve videos -p 8080

# 禁用缓存
serve videos -p 8080 --no-cache
```

## 方法 4：使用 Python（系统自带）

### Python 3
```bash
# 进入 videos 目录
cd videos

# 启动服务器
python3 -m http.server 8080

# 或指定目录
python3 -m http.server 8080 --directory /path/to/videos
```

### Python 2
```bash
python -m SimpleHTTPServer 8080
```

## 方法 5：使用 nginx（生产环境推荐）

### 安装 nginx
```bash
# macOS
brew install nginx

# Ubuntu/Debian
sudo apt-get install nginx
```

### 配置 nginx
创建配置文件 `/usr/local/etc/nginx/servers/hls.conf`：

```nginx
server {
    listen 8080;
    server_name localhost;
    
    root /Users/gmliang/projects/wycx/mpv-player;
    
    location /videos/ {
        add_header Cache-Control no-cache;
        add_header Access-Control-Allow-Origin *;
        
        # HLS 相关 MIME 类型
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
    }
}
```

### 启动 nginx
```bash
# 测试配置
sudo nginx -t

# 启动
sudo nginx

# 重新加载配置
sudo nginx -s reload
```

## 方法 6：使用 Vite 开发服务器（项目已有）

由于项目使用 Vite，可以在 `electron.vite.config.ts` 中配置静态资源：

```typescript
export default {
  // ... 现有配置
  server: {
    // 可以配置代理或静态资源
  }
}
```

## 重要提示

### 1. CORS 问题
如果遇到跨域问题，需要设置 CORS 头：
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`

### 2. MIME 类型
确保服务器正确设置 MIME 类型：
- `.m3u8` → `application/vnd.apple.mpegurl` 或 `application/x-mpegURL`
- `.ts` → `video/mp2t` 或 `video/MP2T`

### 3. 缓存问题
HLS 播放列表和片段不应该被缓存，使用 `-c-1` 或 `--no-cache`

### 4. 测试播放
```bash
# 使用 mpv 测试
mpv http://localhost:8080/videos/playlist.m3u8

# 使用 ffplay 测试
ffplay http://localhost:8080/videos/playlist.m3u8

# 在浏览器中测试（需要支持 HLS 的播放器）
# 访问：http://localhost:8080/videos/playlist.m3u8
```

## 快速启动脚本

已创建 `serve-video.js`，可以直接使用：

```bash
# 服务 videos 目录（默认）
node serve-video.js

# 服务整个项目目录
node serve-video.js --dir .
```

访问地址示例：
- 播放列表：`http://localhost:8080/videos/playlist.m3u8`（如果有 HLS 文件）
- 视频文件：`http://localhost:8080/videos/videoplayback.mp4`
