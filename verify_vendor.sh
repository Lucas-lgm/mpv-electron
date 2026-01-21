#!/bin/bash
set -e

# 验证 vendor 依赖配置是否正确

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VENDOR_LIB="$DIR/vendor/mpv/darwin-arm64/lib"

echo "================================"
echo "验证 MPV Vendor 依赖配置"
echo "================================"
echo ""

# 检查目录
if [ ! -d "$VENDOR_LIB" ]; then
    echo "❌ 错误: vendor 目录不存在: $VENDOR_LIB"
    exit 1
fi

echo "✓ vendor 目录存在"

# 检查主库
if [ ! -f "$VENDOR_LIB/libmpv.2.dylib" ]; then
    echo "❌ 错误: libmpv.2.dylib 不存在"
    exit 1
fi

echo "✓ libmpv.2.dylib 存在"

# 统计文件
cd "$VENDOR_LIB"
TOTAL_FILES=$(ls -1 *.dylib 2>/dev/null | wc -l)
REAL_FILES=$(ls -1 *.dylib 2>/dev/null | while read f; do [ ! -L "$f" ] && echo "$f"; done | wc -l)
SYMLINKS=$(ls -1 *.dylib 2>/dev/null | while read f; do [ -L "$f" ] && echo "$f"; done | wc -l)

echo ""
echo "📊 文件统计:"
echo "  - 总计: $TOTAL_FILES 个 .dylib 文件"
echo "  - 实际文件: $REAL_FILES 个"
echo "  - 符号链接: $SYMLINKS 个"

# 检查磁盘空间
TOTAL_SIZE=$(du -sh "$VENDOR_LIB" | awk '{print $1}')
echo "  - 总大小: $TOTAL_SIZE"

# 验证 libmpv 依赖路径
echo ""
echo "🔍 验证 libmpv 依赖路径:"

RPATH_COUNT=0
HOMEBREW_COUNT=0
SYSTEM_COUNT=0

while IFS= read -r dep; do
    if [[ "$dep" == @rpath/* ]]; then
        ((RPATH_COUNT++))
    elif [[ "$dep" == /opt/homebrew/* ]] || [[ "$dep" == /usr/local/* ]]; then
        ((HOMEBREW_COUNT++))
        echo "  ⚠️  发现 homebrew 路径: $dep"
    elif [[ "$dep" == /usr/lib/* ]] || [[ "$dep" == /System/* ]]; then
        ((SYSTEM_COUNT++))
    fi
done < <(otool -L "$VENDOR_LIB/libmpv.2.dylib" | tail -n +2 | awk '{print $1}')

echo "  - @rpath 依赖: $RPATH_COUNT"
echo "  - 系统库依赖: $SYSTEM_COUNT"
echo "  - homebrew 绝对路径: $HOMEBREW_COUNT"

if [ "$HOMEBREW_COUNT" -gt 0 ]; then
    echo ""
    echo "⚠️  警告: 发现 $HOMEBREW_COUNT 个 homebrew 绝对路径依赖"
    echo "   建议运行: ./fix_rpath.sh"
    echo ""
fi

# 检查缺失的依赖
echo ""
echo "🔗 检查依赖完整性:"

MISSING_COUNT=0
CHECKED_COUNT=0

while IFS= read -r dep; do
    # 只检查 @rpath 依赖
    if [[ "$dep" != @rpath/* ]]; then
        continue
    fi
    
    ((CHECKED_COUNT++))
    dep_file=$(basename "$dep" | sed 's/@rpath\///')
    
    if [ ! -f "$VENDOR_LIB/$dep_file" ] && [ ! -L "$VENDOR_LIB/$dep_file" ]; then
        echo "  ❌ 缺失: $dep_file"
        ((MISSING_COUNT++))
    fi
done < <(otool -L "$VENDOR_LIB/libmpv.2.dylib" | tail -n +2 | awk '{print $1}')

if [ "$MISSING_COUNT" -eq 0 ]; then
    echo "  ✓ 所有 $CHECKED_COUNT 个依赖都存在"
else
    echo "  ❌ 缺失 $MISSING_COUNT 个依赖"
fi

# 验证关键依赖
echo ""
echo "🎯 验证关键依赖:"

CRITICAL_LIBS=(
    "libavcodec.62.dylib"
    "libavformat.62.dylib"
    "libavfilter.11.dylib"
    "libswscale.9.dylib"
    "libswresample.6.dylib"
    "libass.9.dylib"
    "libplacebo.351.dylib"
)

ALL_CRITICAL_OK=true

for lib in "${CRITICAL_LIBS[@]}"; do
    if [ -f "$VENDOR_LIB/$lib" ] || [ -L "$VENDOR_LIB/$lib" ]; then
        echo "  ✓ $lib"
    else
        echo "  ❌ $lib (缺失)"
        ALL_CRITICAL_OK=false
    fi
done

# 最终结果
echo ""
echo "================================"
if [ "$HOMEBREW_COUNT" -eq 0 ] && [ "$MISSING_COUNT" -eq 0 ] && [ "$ALL_CRITICAL_OK" = true ]; then
    echo "✅ 验证通过！所有依赖配置正确。"
    echo ""
    echo "📦 可以开始打包分发了！"
    exit 0
else
    echo "⚠️  验证发现问题，请检查上述警告。"
    echo ""
    echo "建议运行:"
    if [ "$HOMEBREW_COUNT" -gt 0 ]; then
        echo "  ./fix_rpath.sh        # 修复路径"
    fi
    if [ "$MISSING_COUNT" -gt 0 ]; then
        echo "  ./copy_dependencies.sh  # 重新复制依赖"
    fi
    exit 1
fi
