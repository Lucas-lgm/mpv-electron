#!/bin/bash
set -e

# 修复 libmpv 及所有依赖库的路径，将 homebrew 绝对路径改为 @rpath

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VENDOR_LIB="$DIR/vendor/mpv/darwin-arm64/lib"

echo "================================"
echo "修复库文件的依赖路径为 @rpath"
echo "================================"

cd "$VENDOR_LIB"

# 遍历所有非符号链接的 .dylib 文件
for lib in *.dylib; do
    # 跳过符号链接
    [ -L "$lib" ] && continue
    
    # 跳过不存在的文件
    [ ! -f "$lib" ] && continue
    
    echo ""
    echo "处理: $lib"
    
    # 修改库的 install name 为 @rpath
    install_name_tool -id "@rpath/$lib" "$lib" 2>/dev/null || true
    
    # 获取所有依赖
    deps=$(otool -L "$lib" | tail -n +2 | awk '{print $1}')
    
    while IFS= read -r dep; do
        [ -z "$dep" ] && continue
        
        # 跳过系统库
        [[ "$dep" == /usr/lib/* ]] && continue
        [[ "$dep" == /System/* ]] && continue
        [[ "$dep" == @rpath/* ]] && continue
        [[ "$dep" == @loader_path/* ]] && continue
        
        # 获取依赖库的文件名
        dep_name=$(basename "$dep")
        
        # 检查文件是否存在于 vendor 目录
        if [ -f "$dep_name" ] || [ -L "$dep_name" ]; then
            # 修改依赖路径为 @rpath
            install_name_tool -change "$dep" "@rpath/$dep_name" "$lib" 2>/dev/null && \
                echo "  ✓ $dep -> @rpath/$dep_name" || \
                echo "  ✗ Failed to change $dep"
        else
            echo "  ⚠ Skipped: $dep_name not found in vendor"
        fi
    done <<< "$deps"
done

echo ""
echo "================================"
echo "路径修复完成！"
echo "================================"

# 验证 libmpv 的依赖
echo ""
echo "验证 libmpv.2.dylib 的依赖路径："
otool -L libmpv.2.dylib | head -25
