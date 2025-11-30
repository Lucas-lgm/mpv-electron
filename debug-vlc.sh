#!/bin/bash

# 调试 VLC HLS 播放问题的脚本

echo "🔍 调试 VLC HLS 播放问题"
echo ""

# 1. 检查服务器是否运行
echo "1. 检查服务器状态..."
if pgrep -f "serve-video.js" > /dev/null; then
    echo "   ✅ 服务器正在运行"
    PID=$(pgrep -f "serve-video.js" | head -1)
    echo "   PID: $PID"
else
    echo "   ❌ 服务器未运行"
    echo "   请运行: npm run serve"
    exit 1
fi

echo ""

# 2. 检查播放列表
echo "2. 检查播放列表..."
PLAYLIST_URL="http://localhost:8080/hls_output/playlist.m3u8"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PLAYLIST_URL")
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ 播放列表可访问 (HTTP $HTTP_CODE)"
    MIME_TYPE=$(curl -s -I "$PLAYLIST_URL" | grep -i "content-type" | cut -d' ' -f2 | tr -d '\r')
    echo "   MIME 类型: $MIME_TYPE"
    if [ "$MIME_TYPE" = "application/x-mpegURL" ]; then
        echo "   ✅ MIME 类型正确"
    else
        echo "   ⚠️  MIME 类型可能不正确（应该是 application/x-mpegURL）"
    fi
else
    echo "   ❌ 播放列表不可访问 (HTTP $HTTP_CODE)"
fi

echo ""

# 3. 检查播放列表内容
echo "3. 检查播放列表内容..."
SEGMENT_COUNT=$(curl -s "$PLAYLIST_URL" | grep -c "^http://")
echo "   片段数量: $SEGMENT_COUNT"
FIRST_SEGMENT=$(curl -s "$PLAYLIST_URL" | grep "^http://" | head -1)
echo "   第一个片段: $FIRST_SEGMENT"

echo ""

# 4. 测试第一个片段
echo "4. 测试第一个片段..."
if [ -n "$FIRST_SEGMENT" ]; then
    SEGMENT_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FIRST_SEGMENT")
    if [ "$SEGMENT_HTTP_CODE" = "200" ]; then
        echo "   ✅ 片段可访问 (HTTP $SEGMENT_HTTP_CODE)"
        SEGMENT_MIME=$(curl -s -I "$FIRST_SEGMENT" | grep -i "content-type" | cut -d' ' -f2 | tr -d '\r')
        echo "   MIME 类型: $SEGMENT_MIME"
    else
        echo "   ❌ 片段不可访问 (HTTP $SEGMENT_HTTP_CODE)"
        echo "   尝试访问: $FIRST_SEGMENT"
    fi
fi

echo ""

# 5. 建议
echo "5. 调试建议:"
echo "   如果服务器正在运行，请："
echo "   1. 停止当前服务器 (Ctrl+C)"
echo "   2. 启用调试模式: DEBUG=1 npm run serve"
echo "   3. 在 VLC 中尝试播放: $PLAYLIST_URL"
echo "   4. 查看服务器日志中的请求信息"
echo ""
echo "   或者尝试使用 127.0.0.1 而不是 localhost:"
echo "   http://127.0.0.1:8080/hls_output/playlist.m3u8"
