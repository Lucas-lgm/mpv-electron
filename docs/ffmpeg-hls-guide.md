# FFmpeg 视频转 HLS 指南

## 基本命令

### 最简单的转换
```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls -hls_time 10 -hls_list_size 0 output.m3u8
```

参数说明：
- `-i input.mp4`: 输入视频文件
- `-c:v libx264`: 视频编码器（H.264）
- `-c:a aac`: 音频编码器（AAC）
- `-f hls`: 输出格式为 HLS
- `-hls_time 10`: 每个片段时长 10 秒
- `-hls_list_size 0`: 播放列表中保留所有片段（0 表示不限制）
- `output.m3u8`: 输出播放列表文件名

### 常用参数

#### 1. 自定义片段时长
```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls -hls_time 5 output.m3u8
```
- `-hls_time 5`: 每个片段 5 秒

#### 2. 指定输出目录
```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls -hls_time 10 -hls_segment_filename "output/segment_%03d.ts" output/output.m3u8
```
- `-hls_segment_filename`: 指定片段文件名模式
- 需要先创建 `output` 目录

#### 3. 设置视频质量
```bash
# 使用 CRF（推荐，质量更好）
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -c:a aac -b:a 128k -f hls -hls_time 10 output.m3u8

# 使用固定码率
ffmpeg -i input.mp4 -c:v libx264 -b:v 2M -c:a aac -b:a 128k -f hls -hls_time 10 output.m3u8
```
- `-crf 23`: 恒定速率因子（18-28，值越小质量越好）
- `-b:v 2M`: 视频码率 2Mbps
- `-b:a 128k`: 音频码率 128kbps

#### 4. 保留原始质量（不重新编码）
```bash
ffmpeg -i input.mp4 -c copy -f hls -hls_time 10 output.m3u8
```
- `-c copy`: 直接复制流，不重新编码（最快，但要求输入格式兼容）

#### 5. 自适应码率（多码率 HLS）
```bash
# 生成多个码率的版本
ffmpeg -i input.mp4 \
  -c:v libx264 -b:v 1M -c:a aac -b:a 128k -f hls -hls_time 10 -hls_playlist_type vod output_1M.m3u8 \
  -c:v libx264 -b:v 2M -c:a aac -b:a 128k -f hls -hls_time 10 -hls_playlist_type vod output_2M.m3u8 \
  -c:v libx264 -b:v 4M -c:a aac -b:a 128k -f hls -hls_time 10 -hls_playlist_type vod output_4M.m3u8
```

更好的方式是使用 `ffmpeg` 的 `-master_pl_name` 参数（需要较新版本）：
```bash
ffmpeg -i input.mp4 \
  -map 0:v:0 -map 0:a:0 -c:v libx264 -b:v 1M -c:a aac -b:a 128k -f hls -hls_time 10 -hls_playlist_type vod -hls_segment_filename "hls_1M/segment_%03d.ts" -master_pl_name master.m3u8 hls_1M/playlist.m3u8 \
  -map 0:v:0 -map 0:a:0 -c:v libx264 -b:v 2M -c:a aac -b:a 128k -f hls -hls_time 10 -hls_playlist_type vod -hls_segment_filename "hls_2M/segment_%03d.ts" hls_2M/playlist.m3u8 \
  -map 0:v:0 -map 0:a:0 -c:v libx264 -b:v 4M -c:a aac -b:a 128k -f hls -hls_time 10 -hls_playlist_type vod -hls_segment_filename "hls_4M/segment_%03d.ts" hls_4M/playlist.m3u8
```

#### 6. 设置分辨率
```bash
ffmpeg -i input.mp4 -c:v libx264 -vf scale=1280:720 -c:a aac -f hls -hls_time 10 output.m3u8
```
- `-vf scale=1280:720`: 缩放视频到 1280x720

#### 7. 删除已存在的输出文件
```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls -hls_time 10 -hls_flags delete_segments output.m3u8
```
- `-hls_flags delete_segments`: 删除旧的片段文件

#### 8. 实时流（直播模式）
```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls -hls_time 10 -hls_list_size 3 -hls_flags delete_segments output.m3u8
```
- `-hls_list_size 3`: 播放列表只保留最近 3 个片段
- `-hls_flags delete_segments`: 自动删除旧片段

## 完整示例（推荐配置）

### 高质量 HLS 转换
```bash
ffmpeg -i input.mp4 \
  -c:v libx264 \
  -preset medium \
  -crf 23 \
  -c:a aac \
  -b:a 128k \
  -f hls \
  -hls_time 10 \
  -hls_list_size 0 \
  -hls_playlist_type vod \
  -hls_segment_filename "output/segment_%03d.ts" \
  output/output.m3u8
```

参数说明：
- `-preset medium`: 编码速度预设（ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow）
- `-hls_playlist_type vod`: VOD（点播）模式，生成完整的播放列表

### 单码率转换（videoplayback.mp4）

```bash
# 创建输出目录
mkdir -p hls_output

# 转换为 HLS（单码率）
ffmpeg -i videoplayback.mp4 \
  -c:v libx264 \
  -preset medium \
  -crf 23 \
  -c:a aac \
  -b:a 128k \
  -f hls \
  -hls_time 10 \
  -hls_list_size 0 \
  -hls_playlist_type vod \
  -hls_segment_filename "hls_output/segment_%03d.ts" \
  hls_output/playlist.m3u8
```

### 多码率转换（自适应码率 HLS）

多码率 HLS 需要生成多个不同码率的版本，并创建主播放列表：

```bash
# 创建输出目录
mkdir -p hls_output/{360p,720p,1080p}

# 方法 1：分别生成三个码率版本（推荐，更灵活）
# 360p 低码率
ffmpeg -i videoplayback.mp4 \
  -c:v libx264 -preset medium -b:v 800k -maxrate 800k -bufsize 1600k \
  -vf scale=640:360 \
  -c:a aac -b:a 96k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "hls_output/360p/segment_%03d.ts" \
  hls_output/360p/playlist.m3u8

# 720p 中码率
ffmpeg -i videoplayback.mp4 \
  -c:v libx264 -preset medium -b:v 2500k -maxrate 2500k -bufsize 5000k \
  -vf scale=1280:720 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "hls_output/720p/segment_%03d.ts" \
  hls_output/720p/playlist.m3u8

# 1080p 高码率
ffmpeg -i videoplayback.mp4 \
  -c:v libx264 -preset medium -b:v 5000k -maxrate 5000k -bufsize 10000k \
  -vf scale=1920:1080 \
  -c:a aac -b:a 192k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "hls_output/1080p/segment_%03d.ts" \
  hls_output/1080p/playlist.m3u8

# 创建主播放列表（master playlist）
cat > hls_output/master.m3u8 << 'EOF'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360
360p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080
1080p/playlist.m3u8
EOF
```

**使用主播放列表播放：**
```bash
mpv hls_output/master.m3u8
```

**方法 2：使用单个命令生成多码率（需要较新版本的 ffmpeg）**

```bash
ffmpeg -i videoplayback.mp4 \
  -map 0:v:0 -map 0:a:0 \
  -c:v:0 libx264 -b:v:0 800k -maxrate:0 800k -bufsize:0 1600k -vf:0 scale=640:360 \
  -c:a:0 aac -b:a:0 96k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "hls_output/360p/segment_%03d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0" hls_output/360p/playlist.m3u8 \
  -map 0:v:0 -map 0:a:0 \
  -c:v:1 libx264 -b:v:1 2500k -maxrate:1 2500k -bufsize:1 5000k -vf:1 scale=1280:720 \
  -c:a:1 aac -b:a:1 128k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "hls_output/720p/segment_%03d.ts" \
  -var_stream_map "v:1,a:1" hls_output/720p/playlist.m3u8 \
  -map 0:v:0 -map 0:a:0 \
  -c:v:2 libx264 -b:v:2 5000k -maxrate:2 5000k -bufsize:2 10000k -vf:2 scale=1920:1080 \
  -c:a:2 aac -b:a:2 192k \
  -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "hls_output/1080p/segment_%03d.ts" \
  -var_stream_map "v:2,a:2" hls_output/1080p/playlist.m3u8
```

**注意：** 方法 2 的语法可能因 ffmpeg 版本而异，推荐使用方法 1（分别生成）。

## 验证输出

转换完成后，你会得到：
- `playlist.m3u8`: 主播放列表文件
- `segment_000.ts`, `segment_001.ts`, ...: 视频片段文件

可以用以下方式验证：
```bash
# 查看播放列表内容
cat hls_output/playlist.m3u8

# 使用 ffplay 播放
ffplay hls_output/playlist.m3u8

# 使用 mpv 播放
mpv hls_output/playlist.m3u8
```

## 常见问题

### 1. 编码速度慢
- 使用 `-preset fast` 或 `-preset veryfast` 加快编码速度
- 使用 `-c copy` 如果输入格式已兼容（最快）

### 2. 文件太大
- 降低 `-crf` 值（如 28）或降低码率
- 减小分辨率：`-vf scale=1280:720`

### 3. 需要兼容性更好
- 使用 `-profile:v baseline` 或 `-profile:v main`（而不是 high）
- 添加 `-level 3.1` 或 `-level 4.0`

### 4. 需要更小的片段
- 减小 `-hls_time` 值（如 5 秒或更小）

## 在 Node.js/Electron 中使用

如果需要程序化转换，可以使用 `child_process`：

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function convertToHLS(inputPath: string, outputDir: string) {
  const command = `ffmpeg -i "${inputPath}" \
    -c:v libx264 \
    -preset medium \
    -crf 23 \
    -c:a aac \
    -b:a 128k \
    -f hls \
    -hls_time 10 \
    -hls_list_size 0 \
    -hls_playlist_type vod \
    -hls_segment_filename "${outputDir}/segment_%03d.ts" \
    "${outputDir}/playlist.m3u8"`;
  
  try {
    const { stdout, stderr } = await execAsync(command);
    console.log('转换完成');
    return `${outputDir}/playlist.m3u8`;
  } catch (error) {
    console.error('转换失败:', error);
    throw error;
  }
}
```
