#!/usr/bin/env node

/**
 * 简单的视频静态资源服务器
 * 用于本地测试 HLS 视频播放
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 默认配置
const DEFAULT_PORT = process.env.PORT || 8081; // 改为 8081 避免与 nginx 冲突
const DEFAULT_DIR = path.join(__dirname, 'videos');

// MIME 类型映射
const MIME_TYPES = {
  '.m3u8': 'application/x-mpegURL', // VLC 更兼容这个 MIME 类型
  '.ts': 'video/MP2T', // 使用大写，某些播放器更兼容
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    port: DEFAULT_PORT,
    dir: DEFAULT_DIR,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      config.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      config.dir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
用法: node serve-video.js [选项]

选项:
  --port <端口>    指定端口号 (默认: ${DEFAULT_PORT})
  --dir <目录>     指定服务目录 (默认: ${DEFAULT_DIR})
  --help, -h       显示帮助信息

示例:
  node serve-video.js
  node serve-video.js --port 3000
  node serve-video.js --dir videos --port 8080
      `);
      process.exit(0);
    }
  }

  return config;
}

// 获取 MIME 类型
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// 创建服务器
function createServer(rootDir, port) {
  // 启用 HTTP Keep-Alive（提高性能）
  const server = http.createServer({
    keepAlive: true,
    keepAliveInitialDelay: 0,
  }, (req, res) => {
    const parsedUrl = parse(req.url, true);
    let filePath = path.join(rootDir, parsedUrl.pathname);
    
    // 调试日志（可选，可以通过环境变量控制）
    if (process.env.DEBUG) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - User-Agent: ${req.headers['user-agent']?.substring(0, 50)}`);
    }

    // 安全检查：防止路径遍历攻击
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // 如果是目录，尝试查找 index.html
    fs.stat(filePath, (err, stats) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // 记录 404 错误（特别是调试模式下）
          if (process.env.DEBUG) {
            console.error(`[404] File not found: ${req.url} -> ${filePath}`);
            console.error(`     Requested path: ${parsedUrl.pathname}`);
            console.error(`     Resolved path: ${filePath}`);
            console.error(`     Root dir: ${rootDir}`);
          }
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
        } else {
          if (process.env.DEBUG) {
            console.error(`[500] Server error: ${err.message} for ${req.url}`);
          }
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Server error: ${err.message}`);
        }
        return;
      }

      if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        // 重新获取 stats（因为路径改变了）
        fs.stat(filePath, (err, dirStats) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
          }
          readFileAndServe(filePath, dirStats);
        });
        return;
      }

      readFileAndServe(filePath, stats);
    });
    
    // 读取文件并服务的辅助函数
    function readFileAndServe(filePath, fileStats) {
      const mimeType = getMimeType(filePath);
      const isPlaylist = mimeType === 'application/x-mpegURL' || mimeType === 'application/vnd.apple.mpegurl';
      const isSegment = mimeType === 'video/MP2T' || mimeType === 'video/mp2t';
      
      // 处理 HTTP Range 请求（对视频流很重要，mpv 会使用这个）
      const range = req.headers.range;
      let start = 0;
      let end = fileStats.size - 1;
      let statusCode = 200;
      
      if (range && !isPlaylist) {
        // 解析 Range 头
        const parts = range.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : fileStats.size - 1;
        
        // 验证范围
        if (start >= fileStats.size || end >= fileStats.size) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileStats.size}`,
            'Content-Type': 'text/plain'
          });
          res.end('Range Not Satisfiable');
          return;
        }
        
        statusCode = 206; // Partial Content
      }

        // 对于播放列表，需要读取并修改内容
        if (isPlaylist) {
          fs.readFile(filePath, (err, data) => {
            if (err) {
              if (err.code === 'ENOENT') {
                if (process.env.DEBUG) {
                  console.error(`[404] File read error: ${req.url} -> ${filePath}`);
                }
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
              } else {
                if (process.env.DEBUG) {
                  console.error(`[500] File read error: ${err.message} for ${req.url}`);
                }
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Server error: ${err.message}`);
              }
              return;
            }

            // 将相对路径转换为绝对 URL
            const host = req.headers.host || `localhost:${port}`;
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const baseUrl = `${protocol}://${host}`;
            
            const playlistDir = path.dirname(parsedUrl.pathname).replace(/\\/g, '/');
            const normalizedDir = playlistDir.startsWith('/') ? playlistDir : `/${playlistDir}`;
            const playlistBaseUrl = normalizedDir === '/' ? baseUrl : `${baseUrl}${normalizedDir}`;
            
            const contentStr = data.toString('utf-8');
            const fixedContent = contentStr.replace(
              /^(segment_\d+\.ts)$/gm,
              (match, segment) => `${playlistBaseUrl}/${segment}`
            );
            
            const content = Buffer.from(fixedContent, 'utf-8');
            serveContent(content, content.length, mimeType, fileStats, isPlaylist, isSegment, statusCode, start, end);
          });
          return;
        }
        
        // 对于片段文件和其他文件，使用流式传输（更高效）
        const stream = fs.createReadStream(filePath, { start, end: end + 1 });
        
        stream.on('error', (err) => {
          if (process.env.DEBUG) {
            console.error(`[500] Stream error: ${err.message} for ${req.url}`);
          }
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Server error: ${err.message}`);
          }
        });
        
        // 设置响应头并管道传输
        const headers = buildHeaders(mimeType, fileStats.size, fileStats, isPlaylist, isSegment, statusCode, start, end);
        
        res.writeHead(statusCode, headers);
        stream.pipe(res);
      }
      
      // 构建响应头的辅助函数
      function buildHeaders(mimeType, contentLength, fileStats, isPlaylist, isSegment, statusCode, start, end) {
        const headers = {
          'Content-Type': mimeType,
          'Content-Length': contentLength,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Accept-Ranges': 'bytes',
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=5, max=1000',
        };
        
        // 如果是范围请求，添加 Content-Range 头
        if (statusCode === 206) {
          headers['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`;
          headers['Content-Length'] = end - start + 1;
        } else {
          headers['Content-Length'] = contentLength;
        }
        
        if (isPlaylist) {
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
          headers['Pragma'] = 'no-cache';
          headers['Expires'] = '0';
        } else if (isSegment) {
          headers['Cache-Control'] = 'public, max-age=3600, immutable';
          const etag = `"${fileStats.mtime.getTime()}-${fileStats.size}"`;
          headers['ETag'] = etag;
          
          if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, headers);
            res.end();
            return null; // 表示已处理
          }
        } else {
          headers['Cache-Control'] = 'public, max-age=3600';
        }
        
        return headers;
      }
      
      // 服务内容的辅助函数（用于播放列表）
      function serveContent(content, contentLength, mimeType, fileStats, isPlaylist, isSegment, statusCode, start, end) {
        const headers = buildHeaders(mimeType, contentLength, fileStats, isPlaylist, isSegment, statusCode, start, end);
        
        if (headers === null) {
          return; // 304 已处理
        }
        
        // 处理 OPTIONS 请求（CORS 预检）
        if (req.method === 'OPTIONS') {
          res.writeHead(200, headers);
          res.end();
          return;
        }

        res.writeHead(statusCode, headers);
        res.end(content);
      }
  });

  return server;
}

// 主函数
function main() {
  const config = parseArgs();

  // 检查目录是否存在
  if (!fs.existsSync(config.dir)) {
    console.error(`错误: 目录不存在: ${config.dir}`);
    console.error(`提示: 请先创建目录或使用 --dir 指定正确的目录`);
    process.exit(1);
  }

  const server = createServer(config.dir, config.port);

  server.listen(config.port, () => {
    console.log(`\n🚀 视频静态资源服务器已启动`);
    console.log(`📁 服务目录: ${config.dir}`);
    console.log(`🌐 访问地址: http://localhost:${config.port}`);
    console.log(`\n📺 HLS 播放列表示例:`);
    console.log(`   http://localhost:${config.port}/playlist.m3u8`);
    console.log(`\n按 Ctrl+C 停止服务器\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`错误: 端口 ${config.port} 已被占用`);
      console.error(`提示: 使用 --port 指定其他端口`);
    } else {
      console.error(`服务器错误: ${err.message}`);
    }
    process.exit(1);
  });
}

main();
