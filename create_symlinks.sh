#!/bin/bash
set -e

# 为依赖库创建符号链接
# 因为某些库的文件名带有完整版本号，但引用时使用简化版本号

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VENDOR_LIB="$DIR/vendor/mpv/darwin-arm64/lib"

cd "$VENDOR_LIB"

echo "创建符号链接..."

# FFmpeg 库
[ -f libavcodec.62.11.100.dylib ] && ln -sf libavcodec.62.11.100.dylib libavcodec.62.dylib
[ -f libavfilter.11.4.100.dylib ] && ln -sf libavfilter.11.4.100.dylib libavfilter.11.dylib
[ -f libavformat.62.3.100.dylib ] && ln -sf libavformat.62.3.100.dylib libavformat.62.dylib
[ -f libavutil.60.8.100.dylib ] && ln -sf libavutil.60.8.100.dylib libavutil.60.dylib
[ -f libswresample.6.1.100.dylib ] && ln -sf libswresample.6.1.100.dylib libswresample.6.dylib
[ -f libswscale.9.1.100.dylib ] && ln -sf libswscale.9.1.100.dylib libswscale.9.dylib
[ -f libavdevice.62.1.100.dylib ] && ln -sf libavdevice.62.1.100.dylib libavdevice.62.dylib

# Luajit
[ -f libluajit-5.1.2.1.1767980792.dylib ] && ln -sf libluajit-5.1.2.1.1767980792.dylib libluajit-5.1.2.dylib

# Vulkan
[ -f libvulkan.1.4.335.dylib ] && ln -sf libvulkan.1.4.335.dylib libvulkan.1.dylib

# 其他库的符号链接
for lib in *.dylib; do
    # 跳过已经是符号链接的
    [ -L "$lib" ] && continue
    
    # 获取库名和版本（例如：libfoo.1.2.3.dylib -> libfoo.1.dylib）
    if [[ "$lib" =~ ^(.+)\.([0-9]+)\.([0-9]+)\.([0-9]+)\.dylib$ ]]; then
        base="${BASH_REMATCH[1]}"
        major="${BASH_REMATCH[2]}"
        minor="${BASH_REMATCH[3]}"
        patch="${BASH_REMATCH[4]}"
        
        # 创建 major.minor 版本的链接
        link_name="${base}.${major}.${minor}.dylib"
        if [ ! -e "$link_name" ]; then
            ln -sf "$lib" "$link_name"
            echo "  $link_name -> $lib"
        fi
        
        # 创建 major 版本的链接
        link_name="${base}.${major}.dylib"
        if [ ! -e "$link_name" ]; then
            ln -sf "$lib" "$link_name"
            echo "  $link_name -> $lib"
        fi
    fi
done

echo "符号链接创建完成！"
