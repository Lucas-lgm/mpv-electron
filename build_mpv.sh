#!/bin/bash
set -e

# Directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR"

# Check if mpv directory exists
if [ ! -d "$PROJECT_ROOT/mpv" ]; then
    echo "Error: mpv directory not found in $PROJECT_ROOT"
    exit 1
fi

# Add ffmpeg pkg-config paths
export PKG_CONFIG_PATH="/opt/homebrew/opt/ffmpeg-full/lib/pkgconfig:/opt/homebrew/opt/ffmpeg/lib/pkgconfig:$PKG_CONFIG_PATH"

cd "$PROJECT_ROOT/mpv"

echo "Configuring mpv build..."
# Ensure build directory exists
if [ ! -d "build" ]; then
    meson setup build --buildtype=release -Dlibmpv=true -Dcplayer=false -Dswift-build=enabled -Dmanpage-build=disabled -Dhtml-build=disabled -Dtests=false
else
    echo "Build directory exists, reconfiguring..."
    meson setup build --reconfigure --buildtype=release -Dlibmpv=true -Dcplayer=false -Dswift-build=enabled -Dmanpage-build=disabled -Dhtml-build=disabled -Dtests=false
fi

echo "Compiling mpv..."
meson compile -C build

echo "Copying libmpv and all dependencies to vendor..."

# 运行依赖复制脚本
if [ -f "$PROJECT_ROOT/copy_dependencies.sh" ]; then
    "$PROJECT_ROOT/copy_dependencies.sh"
    echo ""
    echo "所有依赖已复制到 vendor 目录"
else
    echo "Warning: copy_dependencies.sh not found, only copying libmpv..."
    LIB_SRC="build/libmpv.2.dylib"
    LIB_DEST="$PROJECT_ROOT/vendor/mpv/darwin-arm64/lib/libmpv.2.dylib"
    
    if [ -f "$LIB_SRC" ]; then
        cp "$LIB_SRC" "$LIB_DEST"
        echo "Copied $LIB_SRC to $LIB_DEST"
        
        # Update install name to be @rpath relative
        install_name_tool -id "@rpath/libmpv.2.dylib" "$LIB_DEST"
        echo "Updated install name to @rpath/libmpv.2.dylib"
    else
        echo "Error: $LIB_SRC not found!"
        exit 1
    fi
fi

echo ""
echo "================================"
echo "mpv build complete."
echo "================================"
