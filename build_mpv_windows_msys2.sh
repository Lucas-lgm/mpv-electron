#!/bin/bash
# Windows MPV 构建脚本（MSYS2 版本）
# 用于在 MSYS2 CLANG64 环境中构建 Windows 版本的 libmpv.a

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR"
MPV_DIR="$PROJECT_ROOT/mpv"
BUILD_DIR="$MPV_DIR/build"
VENDOR_DIR="$PROJECT_ROOT/vendor/mpv/win32-x64"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}Windows MPV 构建脚本（MSYS2）${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 检查是否在 MSYS2 环境中
if [[ -z "$MSYSTEM" ]]; then
    echo -e "${RED}错误: 请在 MSYS2 终端中运行此脚本${NC}"
    echo -e "${YELLOW}推荐使用: MSYS2 CLANG64 或 UCRT64${NC}"
    exit 1
fi

# 检查并提示安装依赖
if ! command -v meson &> /dev/null || ! command -v ninja &> /dev/null; then
    echo -e "${YELLOW}检测到缺少构建工具，请先安装依赖：${NC}"
    echo ""
    echo -e "${CYAN}安装命令：${NC}"
    echo -e "${GRAY}  pacman -S pactoys git${NC}"
    echo -e "${GRAY}  pacboy -S python pkgconf cc meson ninja${NC}"
    echo -e "${GRAY}  pacboy -S ffmpeg libjpeg-turbo libplacebo luajit vulkan-headers${NC}"
    echo ""
    read -p "是否现在安装？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}安装基础工具...${NC}"
        pacman -S --needed pactoys git
        
        echo -e "${YELLOW}安装构建工具...${NC}"
        pacboy -S --needed python pkgconf cc meson ninja
        
        echo -e "${YELLOW}安装 mpv 依赖...${NC}"
        pacboy -S --needed ffmpeg libjpeg-turbo libplacebo luajit vulkan-headers
        
        echo -e "${GREEN}依赖安装完成！${NC}"
        echo ""
    else
        echo -e "${YELLOW}请手动安装依赖后重新运行脚本${NC}"
        exit 1
    fi
fi

# 检查 mpv 目录
if [ ! -d "$MPV_DIR" ]; then
    echo -e "${RED}错误: mpv 目录不存在: $MPV_DIR${NC}"
    echo -e "${YELLOW}请先运行: git submodule update --init --recursive${NC}"
    exit 1
fi

# 检查是否安装了 Meson
if ! command -v meson &> /dev/null; then
    echo -e "${RED}错误: 未找到 meson 命令${NC}"
    echo -e "${YELLOW}请安装: pacboy -S meson${NC}"
    exit 1
fi

# 检查是否安装了 Ninja
if ! command -v ninja &> /dev/null; then
    echo -e "${RED}错误: 未找到 ninja 命令${NC}"
    echo -e "${YELLOW}请安装: pacboy -S ninja${NC}"
    exit 1
fi

echo -e "${YELLOW}当前环境: $MSYSTEM${NC}"
echo -e "${YELLOW}进入 mpv 目录...${NC}"
cd "$MPV_DIR"

# 创建 subprojects 目录（如果不存在）
if [ ! -d "subprojects" ]; then
    echo -e "${YELLOW}创建 subprojects 目录...${NC}"
    mkdir -p subprojects
fi

# 更新 Meson wrap 数据库
echo ""
echo -e "${YELLOW}更新 Meson wrap 数据库...${NC}"
if ! meson wrap update-db 2>&1; then
    echo -e "${YELLOW}警告: WrapDB 连接失败，尝试使用 --allow-insecure...${NC}"
    meson wrap update-db --allow-insecure || {
        echo -e "${YELLOW}提示: 如果持续失败，可以跳过此步骤${NC}"
    }
fi

# 安装必要的 wraps（可选，因为 MSYS2 已经提供了依赖）
echo ""
echo -e "${YELLOW}安装必要的 Meson wraps（如果需要）...${NC}"
wraps=("expat" "harfbuzz" "libpng" "zlib")
for wrap in "${wraps[@]}"; do
    echo -e "${GRAY}  安装 $wrap...${NC}"
    if ! meson wrap install "$wrap" 2>&1 | grep -v "^$"; then
        echo -e "${YELLOW}  尝试使用 --allow-insecure 安装 $wrap...${NC}"
        meson wrap install "$wrap" --allow-insecure 2>&1 | grep -v "^$" || {
            echo -e "${GRAY}  $wrap 可能已通过系统包管理器安装，跳过${NC}"
        }
    fi
done

# 检查是否使用动态库模式
LIBRARY_TYPE="static"
if [ "${1:-}" == "--shared" ] || [ "${1:-}" == "-s" ]; then
    LIBRARY_TYPE="shared"
    echo -e "${YELLOW}使用动态库模式构建${NC}"
else
    echo -e "${YELLOW}使用静态库模式构建（使用 --shared 参数可构建动态库）${NC}"
fi

# 配置构建
echo ""
if [ "$LIBRARY_TYPE" == "shared" ]; then
    echo -e "${YELLOW}配置 MPV 构建（动态库）...${NC}"
else
    echo -e "${YELLOW}配置 MPV 构建（静态库）...${NC}"
fi

# 构建参数
MESON_ARGS=(
    "setup"
    "build"
    "--wrap-mode=forcefallback"
    "-Ddefault_library=$LIBRARY_TYPE"
    "-Dlibmpv=true"
    "-Dcplayer=false"
    "-Dtests=false"
    "-Dgpl=true"
    "-Dd3d11=enabled"
    "-Dvulkan=enabled"
    "-Djavascript=disabled"
    "-Dwin32-smtc=disabled"
    "-Dlua=luajit"
    "-Ddrm=disabled"
    "-Dlibarchive=disabled"
    "-Drubberband=disabled"
    "-Dwayland=disabled"
    "-Dx11=disabled"
    "--prefix=$MSYSTEM_PREFIX"
)

# 如果构建目录存在，重新配置
if [ -d "$BUILD_DIR" ]; then
    echo -e "${GRAY}  重新配置现有构建目录...${NC}"
    MESON_ARGS+=("--reconfigure")
fi

meson "${MESON_ARGS[@]}"

if [ $? -ne 0 ]; then
    echo -e "${RED}错误: Meson 配置失败${NC}"
    exit 1
fi

# 构建
echo ""
if [ "$LIBRARY_TYPE" == "shared" ]; then
    echo -e "${YELLOW}编译 libmpv-2.dll...${NC}"
    # 使用 ninja 构建动态库
    ninja -C build libmpv-2.dll
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}错误: 编译失败${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}编译 libmpv.a...${NC}"
    # 使用 ninja 构建静态库（与官方脚本一致）
    ninja -C build libmpv.a
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}错误: 编译失败${NC}"
        exit 1
    fi
fi

# 创建 vendor 目录
echo ""
echo -e "${YELLOW}创建 vendor 目录...${NC}"
mkdir -p "$VENDOR_DIR/lib"
mkdir -p "$VENDOR_DIR/include"

# 复制库文件
echo ""
echo -e "${YELLOW}复制库文件到 vendor 目录...${NC}"

if [ "$LIBRARY_TYPE" == "shared" ]; then
    # 动态库模式：复制 DLL
    LIBMPV_DLL="$BUILD_DIR/libmpv-2.dll"
    
    if [ -f "$LIBMPV_DLL" ]; then
        cp "$LIBMPV_DLL" "$VENDOR_DIR/lib/libmpv-2.dll"
        echo -e "${GREEN}  ✓ 复制 libmpv-2.dll${NC}"
        
        # 显示文件信息
        FILE_SIZE=$(du -h "$LIBMPV_DLL" | cut -f1)
        echo -e "${GRAY}  ✓ 文件大小: $FILE_SIZE${NC}"
        
        # 使用 MinGW 工具生成导入库（适用于 MinGW/Clang 构建的 DLL）
        echo ""
        echo -e "${YELLOW}生成导入库 libmpv.lib（MSVC 用）...${NC}"
        
        # 删除旧的导入库
        [ -f "$VENDOR_DIR/lib/libmpv.lib" ] && rm -f "$VENDOR_DIR/lib/libmpv.lib"
        [ -f "$VENDOR_DIR/lib/libmpv.def" ] && rm -f "$VENDOR_DIR/lib/libmpv.def"
        
        # 检查 MinGW 工具是否可用
        if command -v gendef >/dev/null 2>&1 && command -v dlltool >/dev/null 2>&1; then
            echo -e "${GRAY}  使用 MinGW 工具生成导入库...${NC}"
            
            # 切换到 lib 目录
            cd "$VENDOR_DIR/lib" || exit 1
            
            # Step 1: 使用 gendef 生成 .def 文件
            gendef libmpv-2.dll >/dev/null 2>&1
            if [ -f "libmpv-2.def" ]; then
                mv libmpv-2.def libmpv.def
                echo -e "${GRAY}  ✓ 已生成 .def 文件${NC}"
            else
                echo -e "${YELLOW}  ⚠ gendef 生成 .def 文件失败${NC}"
            fi
            
            # Step 2: 使用 dlltool 生成导入库
            if [ -f "libmpv.def" ]; then
                dlltool -d libmpv.def -l libmpv.lib -D libmpv-2.dll >/dev/null 2>&1
                if [ $? -eq 0 ] && [ -f "libmpv.lib" ]; then
                    echo -e "${GREEN}  ✓ 已生成 libmpv.lib（使用 MinGW 工具）${NC}"
                else
                    echo -e "${YELLOW}  ⚠ dlltool 生成导入库失败${NC}"
                fi
            fi
            
            cd - >/dev/null || exit 1
        else
            echo -e "${YELLOW}  ⚠ MinGW 工具（gendef/dlltool）未找到${NC}"
            echo -e "${GRAY}  尝试使用 MSVC lib.exe...${NC}"
            
            # 回退到 MSVC lib.exe 方法
            LIB_EXE=""
            for base in "/c/Program Files/Microsoft Visual Studio/2022/Community" \
                        "/c/Program Files/Microsoft Visual Studio/2022/BuildTools" \
                        "/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools" \
                        "/c/Program Files/Microsoft Visual Studio/2019/Community" \
                        "/c/Program Files (x86)/Microsoft Visual Studio/2019/Community"; do
                [ ! -d "$base" ] && continue
                cand=$(find "$base" -name "lib.exe" -path "*/Hostx64/x64/*" 2>/dev/null | head -1)
                if [ -n "$cand" ] && [ -f "$cand" ]; then
                    LIB_EXE="$cand"
                    break
                fi
            done
            
            if [ -n "$LIB_EXE" ]; then
                DLL_PATH_WIN=$(cygpath -w "$VENDOR_DIR/lib/libmpv-2.dll" 2>/dev/null || echo "$VENDOR_DIR/lib/libmpv-2.dll" | sed 's|^/\([a-z]\)/|\1:\\|; s|/|\\|g')
                LIB_PATH_WIN=$(cygpath -w "$VENDOR_DIR/lib/libmpv.lib" 2>/dev/null || echo "$VENDOR_DIR/lib/libmpv.lib" | sed 's|^/\([a-z]\)/|\1:\\|; s|/|\\|g')
                
                set +e
                "$LIB_EXE" /DEF:"$DLL_PATH_WIN" /OUT:"$LIB_PATH_WIN" /MACHINE:X64 /NAME:libmpv-2.dll >/dev/null 2>&1
                if [ $? -eq 0 ] && [ -f "$VENDOR_DIR/lib/libmpv.lib" ]; then
                    echo -e "${GREEN}  ✓ 已生成 libmpv.lib（使用 MSVC lib.exe）${NC}"
                else
                    echo -e "${YELLOW}  ⚠ MSVC lib.exe 生成失败${NC}"
                    echo -e "${GRAY}  提示: 请在 MSYS2 中安装 MinGW 工具: pacman -S mingw-w64-clang-x86_64-tools${NC}"
                fi
                set -e
            else
                echo -e "${YELLOW}  ⚠ 未找到 lib.exe${NC}"
                echo -e "${GRAY}  提示: 请在 MSYS2 中运行: cd vendor/mpv/win32-x64/lib && gendef libmpv-2.dll && dlltool -d libmpv-2.def -l libmpv.lib -D libmpv-2.dll${NC}"
            fi
        fi
    else
        echo -e "${RED}  ✗ 错误: libmpv-2.dll 不存在${NC}"
        exit 1
    fi
else
    # 静态库模式：复制 .a 文件并重命名为 .lib
    LIBMPV_A="$BUILD_DIR/libmpv.a"
    
    if [ -f "$LIBMPV_A" ]; then
        # Windows 使用 .lib 扩展名
        cp "$LIBMPV_A" "$VENDOR_DIR/lib/libmpv.lib"
        echo -e "${GREEN}  ✓ 复制 libmpv.lib${NC}"
        
        # 显示文件信息
        FILE_SIZE=$(du -h "$LIBMPV_A" | cut -f1)
        echo -e "${GRAY}  ✓ 文件大小: $FILE_SIZE${NC}"
    else
        echo -e "${RED}  ✗ 错误: libmpv.a 不存在${NC}"
        exit 1
    fi
fi

# 复制头文件
echo ""
echo -e "${YELLOW}复制头文件...${NC}"
MPV_INCLUDE_SRC="$MPV_DIR/include/mpv"
MPV_INCLUDE_DST="$VENDOR_DIR/include/mpv"

if [ -d "$MPV_INCLUDE_SRC" ]; then
    if [ -d "$MPV_INCLUDE_DST" ]; then
        rm -rf "$MPV_INCLUDE_DST"
    fi
    mkdir -p "$VENDOR_DIR/include"
    cp -r "$MPV_INCLUDE_SRC" "$VENDOR_DIR/include/"
    echo -e "${GREEN}  ✓ 复制头文件${NC}"
else
    echo -e "${YELLOW}  ⚠ 警告: 头文件目录不存在${NC}"
fi

# 复制动态链接库（DLL）
echo ""
echo -e "${YELLOW}复制动态链接库（DLL）...${NC}"

# MSYS2 DLL 目录
MSYS2_BIN_DIR="$MSYSTEM_PREFIX/bin"
if [ ! -d "$MSYS2_BIN_DIR" ]; then
    # 尝试其他可能的路径
    if [ "$MSYSTEM" == "UCRT64" ]; then
        MSYS2_BIN_DIR="/ucrt64/bin"
    elif [ "$MSYSTEM" == "CLANG64" ]; then
        MSYS2_BIN_DIR="/clang64/bin"
    elif [ "$MSYSTEM" == "MINGW64" ]; then
        MSYS2_BIN_DIR="/mingw64/bin"
    else
        MSYS2_BIN_DIR="/usr/bin"
    fi
fi

if [ -d "$MSYS2_BIN_DIR" ]; then
    echo -e "${GRAY}  搜索目录: $MSYS2_BIN_DIR${NC}"
    
    # 需要复制的 DLL 文件列表（FFmpeg 和相关依赖）
    DLL_PATTERNS=(
        "avcodec-*.dll"
        "avformat-*.dll"
        "avutil-*.dll"
        "avfilter-*.dll"
        "swscale-*.dll"
        "swresample-*.dll"
        "libplacebo-*.dll"
        "libass-*.dll"
        "luajit-*.dll"
        "luajit.dll"
        "libjpeg-*.dll"
        "libjpeg-turbo-*.dll"
        "zlib*.dll"
        "libpng*.dll"
        "harfbuzz-*.dll"
        "freetype-*.dll"
        "fribidi-*.dll"
        "fontconfig-*.dll"
        "expat-*.dll"
        "bz2-*.dll"
        "lzma-*.dll"
        "zstd-*.dll"
        "vulkan-1.dll"
        "libvulkan-*.dll"
    )
    
    DLL_COUNT=0
    TOTAL_PATTERNS=${#DLL_PATTERNS[@]}
    PATTERN_INDEX=0
    
    # 临时禁用 set -e，避免循环中的错误导致脚本退出
    set +e
    
    for pattern in "${DLL_PATTERNS[@]}"; do
        ((PATTERN_INDEX++))
        echo -e "${GRAY}  [$PATTERN_INDEX/$TOTAL_PATTERNS] 搜索: $pattern${NC}"
        
        # 使用 find 命令来查找匹配的文件
        # 将结果存储到临时变量中，避免子 shell 问题
        found_dlls=$(find "$MSYS2_BIN_DIR" -maxdepth 1 -name "$pattern" -type f 2>/dev/null)
        
        if [ -n "$found_dlls" ]; then
            for dll in $found_dlls; do
                if [ -f "$dll" ]; then
                    DLL_NAME=$(basename "$dll")
                    if cp "$dll" "$VENDOR_DIR/lib/" 2>/dev/null; then
                        echo -e "${GREEN}      ✓ 复制 $DLL_NAME${NC}"
                        ((DLL_COUNT++))
                    else
                        echo -e "${YELLOW}      ⚠ 复制失败: $DLL_NAME${NC}"
                    fi
                fi
            done
        fi
    done
    
    # 恢复 set -e
    set -e
    
    if [ $DLL_COUNT -eq 0 ]; then
        echo -e "${YELLOW}  ⚠ 警告: 未找到 DLL 文件（可能依赖已静态链接）${NC}"
        echo -e "${GRAY}  提示: 如果 libmpv.a 是完全静态的，则不需要 DLL${NC}"
    else
        echo -e "${GREEN}  ✓ 已复制 $DLL_COUNT 个 DLL 文件到 $VENDOR_DIR/lib/${NC}"
        
        # 检查递归依赖
        echo ""
        echo -e "${YELLOW}检查递归依赖...${NC}"
        
        # 临时禁用 set -e
        set +e
        
        # 已处理的 DLL 列表（避免重复）
        processed_dlls=()
        new_dlls=($(ls "$VENDOR_DIR/lib"/*.dll 2>/dev/null | xargs -n1 basename))
        
        # 递归检查依赖（最多 5 层）
        max_depth=5
        depth=0
        
        # 常见依赖库（libass 等可能需要的）
        common_deps=(
            "freetype-*.dll"
            "fribidi-*.dll"
            "fontconfig-*.dll"
            "harfbuzz-*.dll"
            "expat-*.dll"
            "brotlicommon-*.dll"
            "brotlidec-*.dll"
            "brotlienc-*.dll"
            "graphite2-*.dll"
            "icu*.dll"
        )
        
        # 先尝试复制常见依赖
        for pattern in "${common_deps[@]}"; do
            found_deps=$(find "$MSYS2_BIN_DIR" -maxdepth 1 -name "$pattern" -type f 2>/dev/null)
            if [ -n "$found_deps" ]; then
                for dep in $found_deps; do
                    dep_name=$(basename "$dep")
                    if [ ! -f "$VENDOR_DIR/lib/$dep_name" ]; then
                        if cp "$dep" "$VENDOR_DIR/lib/" 2>/dev/null; then
                            echo -e "${GREEN}      ✓ 复制常见依赖: $dep_name${NC}"
                            ((DLL_COUNT++))
                        fi
                    fi
                done
            fi
        done
        
        # 使用工具检查 DLL 依赖
        while [ ${#new_dlls[@]} -gt 0 ] && [ $depth -lt $max_depth ]; do
            ((depth++))
            current_dlls=("${new_dlls[@]}")
            new_dlls=()
            
            for dll_name in "${current_dlls[@]}"; do
                dll_path="$VENDOR_DIR/lib/$dll_name"
                
                # 检查是否已处理
                if [[ " ${processed_dlls[@]} " =~ " ${dll_name} " ]]; then
                    continue
                fi
                processed_dlls+=("$dll_name")
                
                # 方法 1: 使用 objdump 检查 DLL 依赖
                if command -v objdump &> /dev/null; then
                    deps=$(objdump -p "$dll_path" 2>/dev/null | grep -i "DLL Name:" | awk '{print $3}' | grep -vE "KERNEL32|USER32|GDI32|MSVCRT|MSVCP|API-MS-WIN|api-ms-win|ADVAPI32|SHELL32|OLE32|OLEAUT32|WS2_32" || true)
                    
                    if [ -n "$deps" ]; then
                        # 将依赖按行分割并处理（避免使用 <<<）
                        for dep in $deps; do
                            [ -z "$dep" ] && continue
                            
                            # 检查依赖是否在 MSYS2 bin 目录中
                            dep_path="$MSYS2_BIN_DIR/$dep"
                            if [ -f "$dep_path" ]; then
                                # 检查是否已复制
                                if [ ! -f "$VENDOR_DIR/lib/$dep" ]; then
                                    if cp "$dep_path" "$VENDOR_DIR/lib/" 2>/dev/null; then
                                        echo -e "${GREEN}      ✓ 发现依赖并复制: $dep (来自 $dll_name)${NC}"
                                        ((DLL_COUNT++))
                                        new_dlls+=("$dep")
                                    fi
                                fi
                            fi
                        done
                    fi
                # 方法 2: 使用 ldd（如果可用，在 MSYS2 中可能不可用）
                elif command -v ldd &> /dev/null; then
                    deps=$(ldd "$dll_path" 2>/dev/null | grep "$MSYS2_BIN_DIR" | awk '{print $1}' | sed "s|$MSYS2_BIN_DIR/||" || true)
                    
                    if [ -n "$deps" ]; then
                        # 将依赖按行分割并处理（避免使用 <<<）
                        for dep in $deps; do
                            [ -z "$dep" ] && continue
                            
                            dep_path="$MSYS2_BIN_DIR/$dep"
                            if [ -f "$dep_path" ] && [ ! -f "$VENDOR_DIR/lib/$dep" ]; then
                                if cp "$dep_path" "$VENDOR_DIR/lib/" 2>/dev/null; then
                                    echo -e "${GREEN}      ✓ 发现依赖并复制: $dep (来自 $dll_name)${NC}"
                                    ((DLL_COUNT++))
                                    new_dlls+=("$dep")
                                fi
                            fi
                        done
                    fi
                fi
            done
        done
        
        # 恢复 set -e
        set -e
        
        if [ $DLL_COUNT -gt 0 ]; then
            echo -e "${GREEN}  ✓ 总共复制 $DLL_COUNT 个 DLL 文件（包括递归依赖）${NC}"
        fi
        
        # 验证依赖完整性（精简版：进度+预建列表，避免嵌套循环卡顿）
        echo ""
        echo -e "${YELLOW}验证依赖完整性...${NC}"
        if [ -n "${SKIP_DLL_VERIFY:-}" ]; then
            echo -e "${GRAY}  跳过（SKIP_DLL_VERIFY=1）${NC}"
        elif ! command -v objdump &> /dev/null; then
            echo -e "${GRAY}  跳过（无 objdump）${NC}"
        else
            set +e
            existing_lower=""
            for f in "$VENDOR_DIR/lib"/*.dll; do
                [ -f "$f" ] || continue
                existing_lower="$existing_lower $(basename "$f" | tr '[:upper:]' '[:lower:]')"
            done
            system_pat="KERNEL32|KERNELBASE|ntdll|USER32|GDI32|GDIplus|MSVCRT|MSVCP|VCRUNTIME|API-MS-WIN|api-ms-win|ADVAPI32|SHELL32|OLE32|OLEAUT32|WS2_32|WSOCK32|WINMM|RPCRT4|bcrypt|CRYPT32|ncrypt|DWrite|USP10|DNSAPI|IPHLPAPI|SHLWAPI|VERSION|CFGMGR32|MSIMG32"
            missing_deps=()
            dll_list=("$VENDOR_DIR/lib"/*.dll)
            total_dlls=${#dll_list[@]}
            idx=0
            for dll_file in "${dll_list[@]}"; do
                [ -f "$dll_file" ] || continue
                ((idx++))
                dll_name=$(basename "$dll_file")
                printf "\r  ${GRAY}[%d/%d] %s${NC}   " "$idx" "$total_dlls" "$dll_name"
                deps=$(objdump -p "$dll_file" 2>/dev/null | grep -i "DLL Name:" | awk '{print $3}' || true)
                [ -n "$deps" ] || continue
                for dep in $deps; do
                    [ -n "$dep" ] || continue
                    dep_upper=$(echo "$dep" | tr '[:lower:]' '[:upper:]')
                    [[ "$dep_upper" =~ $system_pat ]] && continue
                    [ -f "$VENDOR_DIR/lib/$dep" ] && continue
                    if [ -f "$MSYS2_BIN_DIR/$dep" ]; then
                        if cp "$MSYS2_BIN_DIR/$dep" "$VENDOR_DIR/lib/" 2>/dev/null; then
                            echo ""
                            echo -e "${GREEN}      ✓ 补充缺失依赖: $dep (需要 $dll_name)${NC}"
                            ((DLL_COUNT++))
                            existing_lower="$existing_lower $(echo "$dep" | tr '[:upper:]' '[:lower:]')"
                        else
                            missing_deps+=("$dep (需要 $dll_name)")
                        fi
                    else
                        dep_lower=$(echo "$dep" | tr '[:upper:]' '[:lower:]')
                        [[ " $existing_lower " == *" $dep_lower "* ]] && continue
                        missing_deps+=("$dep (需要 $dll_name)")
                    fi
                done
            done
            echo ""
            printf "\r  ${GRAY}%*s${NC}\r" 60 " "
            if [ ${#missing_deps[@]} -gt 0 ]; then
                echo -e "${YELLOW}  ⚠ 可能缺失的依赖：${NC}"
                for dep in "${missing_deps[@]}"; do echo -e "${GRAY}      - $dep${NC}"; done
                echo -e "${GRAY}  （多为系统库已过滤，一般可忽略）${NC}"
            else
                echo -e "${GREEN}  ✓ 依赖检查完成${NC}"
            fi
        fi
        set -e
        final_count=$(ls "$VENDOR_DIR/lib"/*.dll 2>/dev/null | wc -l)
        echo ""
        echo -e "${CYAN}最终 DLL 统计:${NC}"
        echo -e "${GRAY}  已复制 DLL 文件: $final_count 个${NC}"
        echo -e "${GRAY}  位置: $VENDOR_DIR/lib/${NC}"
    fi
else
    echo -e "${YELLOW}  ⚠ 警告: 未找到 MSYS2 bin 目录: $MSYS2_BIN_DIR${NC}"
    echo -e "${GRAY}  提示: 请手动复制所需的 DLL 文件到 $VENDOR_DIR/lib/${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}构建完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}库文件位置:${NC}"
if [ "$LIBRARY_TYPE" == "shared" ]; then
    echo -e "${GRAY}  动态库: $VENDOR_DIR/lib/libmpv-2.dll${NC}"
    echo -e "${GRAY}  导入库: $VENDOR_DIR/lib/libmpv.lib（若已生成）${NC}"
    echo -e "${GRAY}  头文件: $VENDOR_DIR/include/mpv/${NC}"
    echo ""
    echo -e "${CYAN}下一步:${NC}"
    echo -e "${GRAY}  1. 构建原生模块: npm run build:native${NC}"
    echo -e "${GRAY}  2. 运行开发模式: npm run dev${NC}"
    echo -e "${GRAY}  （若未找到 lib.exe，请先运行 native/generate_mpv_import_lib.ps1 生成导入库）${NC}"
else
    echo -e "${GRAY}  静态库: $VENDOR_DIR/lib/libmpv.lib${NC}"
    echo -e "${GRAY}  头文件: $VENDOR_DIR/include/mpv/${NC}"
    echo ""
    echo -e "${CYAN}下一步:${NC}"
    echo -e "${GRAY}  1. 构建原生模块: npm run build:native${NC}"
    echo -e "${GRAY}  2. 运行开发模式: npm run dev${NC}"
fi
echo ""
