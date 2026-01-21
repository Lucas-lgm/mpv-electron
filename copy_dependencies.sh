#!/bin/bash
set -e

# 复制所有 mpv 依赖库的脚本
# 这个脚本会：
# 1. 复制 libmpv 的所有依赖到 vendor 目录
# 2. 递归复制依赖的依赖
# 3. 修改所有库的 install_name 和依赖路径为 @rpath

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR"
VENDOR_LIB="$PROJECT_ROOT/vendor/mpv/darwin-arm64/lib"

# 确保目标目录存在
mkdir -p "$VENDOR_LIB"

# 已处理的库列表（避免重复处理）- 使用空格分隔的字符串
PROCESSED_LIBS=""

# 需要排除的系统库前缀
SYSTEM_PREFIXES=(
    "/usr/lib/"
    "/System/"
)

# 检查是否是系统库
is_system_lib() {
    local lib_path="$1"
    for prefix in "${SYSTEM_PREFIXES[@]}"; do
        if [[ "$lib_path" == "$prefix"* ]]; then
            return 0
        fi
    done
    return 1
}

# 获取库的实际路径（处理符号链接）
get_real_path() {
    local lib_path="$1"
    
    # 如果路径不是绝对路径，尝试在 homebrew 中查找
    if [[ "$lib_path" != /* ]]; then
        echo "Warning: Non-absolute path: $lib_path" >&2
        return 1
    fi
    
    if [ -f "$lib_path" ]; then
        # 如果是符号链接，获取实际文件
        if [ -L "$lib_path" ]; then
            readlink -f "$lib_path" 2>/dev/null || echo "$lib_path"
        else
            echo "$lib_path"
        fi
    else
        echo "Warning: Library not found: $lib_path" >&2
        return 1
    fi
}

# 复制库及其依赖
copy_lib_and_deps() {
    local lib_path="$1"
    local depth="${2:-0}"
    
    # 限制递归深度
    if [ "$depth" -gt 10 ]; then
        echo "Warning: Max recursion depth reached for $lib_path"
        return
    fi
    
    # 如果是系统库，跳过
    if is_system_lib "$lib_path"; then
        return
    fi
    
    # 获取实际路径
    local real_path
    real_path=$(get_real_path "$lib_path") || return
    
    # 如果已处理过，跳过
    if [[ " $PROCESSED_LIBS " == *" $real_path "* ]]; then
        return
    fi
    
    # 标记为已处理
    PROCESSED_LIBS="$PROCESSED_LIBS $real_path"
    
    echo "处理: $real_path (深度: $depth)"
    
    # 获取库文件名
    local lib_name=$(basename "$real_path")
    local dest_path="$VENDOR_LIB/$lib_name"
    
    # 复制库文件
    if [ -f "$real_path" ]; then
        # 如果目标文件已存在，先删除
        [ -f "$dest_path" ] && rm -f "$dest_path"
        cp "$real_path" "$dest_path"
        echo "  已复制: $lib_name"
        
        # 修改库的 install name 为 @rpath 相对路径
        install_name_tool -id "@rpath/$lib_name" "$dest_path" 2>/dev/null || true
        
        # 获取该库的所有依赖
        local deps=$(otool -L "$real_path" | tail -n +2 | awk '{print $1}')
        
        # 处理每个依赖
        while IFS= read -r dep; do
            [ -z "$dep" ] && continue
            
            # 跳过自身引用
            if [[ "$dep" == *"$lib_name"* ]] || [[ "$dep" == "@rpath/"* ]] || [[ "$dep" == "@loader_path/"* ]]; then
                continue
            fi
            
            # 如果是系统库，跳过
            if is_system_lib "$dep"; then
                continue
            fi
            
            # 递归复制依赖
            copy_lib_and_deps "$dep" $((depth + 1))
            
            # 修改依赖路径为 @rpath
            local dep_name=$(basename "$dep")
            install_name_tool -change "$dep" "@rpath/$dep_name" "$dest_path" 2>/dev/null || true
        done <<< "$deps"
    else
        echo "  警告: 文件不存在: $real_path"
    fi
}

echo "================================"
echo "开始复制 mpv 依赖库"
echo "================================"

# 主 libmpv 库路径
LIBMPV_SOURCE="$PROJECT_ROOT/mpv/build/libmpv.2.dylib"
LIBMPV_DEST="$VENDOR_LIB/libmpv.2.dylib"

if [ ! -f "$LIBMPV_SOURCE" ]; then
    echo "错误: libmpv 源文件不存在: $LIBMPV_SOURCE"
    echo "请先运行 build_mpv.sh 构建 mpv"
    exit 1
fi

# 首先复制 libmpv
echo "复制主库: libmpv.2.dylib"
[ -f "$LIBMPV_DEST" ] && rm -f "$LIBMPV_DEST"
cp "$LIBMPV_SOURCE" "$LIBMPV_DEST"

# 处理 libmpv 的所有依赖
echo ""
echo "分析并复制 libmpv 的依赖..."
LIBMPV_DEPS=$(otool -L "$LIBMPV_SOURCE" | tail -n +2 | awk '{print $1}')

while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    
    # 跳过自身引用
    if [[ "$dep" == *"libmpv"* ]] || [[ "$dep" == "@rpath/"* ]] || [[ "$dep" == "@loader_path/"* ]]; then
        continue
    fi
    
    # 如果是系统库，跳过
    if is_system_lib "$dep"; then
        continue
    fi
    
    echo ""
    copy_lib_and_deps "$dep"
done <<< "$LIBMPV_DEPS"

# 修改 libmpv 的依赖路径
echo ""
echo "更新 libmpv 的依赖路径..."
install_name_tool -id "@rpath/libmpv.2.dylib" "$LIBMPV_DEST"

while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    
    if [[ "$dep" == *"libmpv"* ]] || [[ "$dep" == "@rpath/"* ]] || [[ "$dep" == "@loader_path/"* ]]; then
        continue
    fi
    
    if is_system_lib "$dep"; then
        continue
    fi
    
    dep_name=$(basename "$dep")
    install_name_tool -change "$dep" "@rpath/$dep_name" "$LIBMPV_DEST" 2>/dev/null || true
done <<< "$LIBMPV_DEPS"

echo ""
echo "================================"
echo "依赖复制完成！"
echo "================================"
echo ""
echo "已复制的库列表："
ls -lh "$VENDOR_LIB"/*.dylib | awk '{print "  " $9, "(" $5 ")"}'

echo ""
echo "验证 libmpv 的依赖："
otool -L "$LIBMPV_DEST" | head -20

echo ""
echo "提示: 所有依赖已复制到 $VENDOR_LIB"
echo "提示: 所有依赖路径已修改为 @rpath，方便打包分发"

# 创建符号链接
echo ""
echo "================================"
echo "创建符号链接..."
echo "================================"
if [ -f "$PROJECT_ROOT/create_symlinks.sh" ]; then
    "$PROJECT_ROOT/create_symlinks.sh"
else
    echo "Warning: create_symlinks.sh not found"
fi

# 修复 rpath
echo ""
echo "================================"
echo "修复依赖路径为 @rpath..."
echo "================================"
if [ -f "$PROJECT_ROOT/fix_rpath.sh" ]; then
    "$PROJECT_ROOT/fix_rpath.sh" | tail -30
else
    echo "Warning: fix_rpath.sh not found"
fi
