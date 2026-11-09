#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="/home/jazo/.cache/jazu/programs"
SDK="/home/jazo/.cache/jazu/emsdk"
ARTIFACTS="$SCRIPT_DIR/src/desk/programs/artifacts"

source "$SDK/emsdk_env.sh" >/dev/null 2>&1
mkdir -p "$WORK" "$ARTIFACTS"

FLAGS="-Wl,--wrap=getpwuid,--wrap=getpwnam,--wrap=getpwent -Os -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createProgram -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,TTY,PIPEFS,stackSave,stackRestore -sEXPORTED_FUNCTIONS=_main,_emscripten_resize_heap -sSTACK_SIZE=1048576 -sINITIAL_MEMORY=16777216 -sERROR_ON_UNDEFINED_SYMBOLS=0"

TARGET="${1:-all}"

if [[ "$TARGET" == "group4" || "$TARGET" == "text_gen" || "$TARGET" == "4" ]]; then
    echo "=== Building Group 4 ==="
    for tool in casing_tools text_stats text_gen banner word_games; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group4/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group4/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group4" "$tool.c" LICENSE
    done
    echo "Group 4 done"
fi

if [[ "$TARGET" == "group5" || "$TARGET" == "5" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 5 ==="
    for tool in numbase random_bytes math_suite; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group5/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group5/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group5" "$tool.c" LICENSE
    done
    echo "Group 5 done"
fi

if [[ "$TARGET" == "group6" || "$TARGET" == "6" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 6 ==="
    for tool in uuid_token; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group6/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group6/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group6" "$tool.c" LICENSE
    done
    echo "Group 6 done"
fi

if [[ "$TARGET" == "group7" || "$TARGET" == "7" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 7 ==="
    for tool in color_tools; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group7/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group7/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group7" "$tool.c" LICENSE
    done
    echo "Group 7 done"
fi

if [[ "$TARGET" == "group8" || "$TARGET" == "8" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 8 ==="
    for tool in date_units; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group8/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group8/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group8" "$tool.c" LICENSE
    done
    echo "Group 8 done"
fi

if [[ "$TARGET" == "group9" || "$TARGET" == "9" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 9 ==="
    echo "Building qr..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group9/qr_main.c" "$SCRIPT_DIR/src/desk/programs/sources/group9/qrcodegen.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/qr.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group9/LICENSE" "$ARTIFACTS/qr-LICENSE"
    rm -f "$ARTIFACTS/qr-source.tar.gz"
    tar -czf "$ARTIFACTS/qr-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group9" qr_main.c qrcodegen.c qrcodegen.h LICENSE

    for tool in net_tools file_analysis; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group9/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group9/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group9" "$tool.c" LICENSE
    done
    echo "Group 9 done"
fi

if [[ "$TARGET" == "group10" || "$TARGET" == "10" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 10 ==="
    for tool in string_helpers markup_tools tools_catalog; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group10/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group10/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group10" "$tool.c" LICENSE
    done
    echo "Group 10 done"
fi

if [[ "$TARGET" == "group11" || "$TARGET" == "11" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 11 ==="
    for tool in encoding_suite; do
        echo "Building $tool..."
        emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group11/$tool.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/$tool.js"
        cp "$SCRIPT_DIR/src/desk/programs/sources/group11/LICENSE" "$ARTIFACTS/$tool-LICENSE"
        rm -f "$ARTIFACTS/$tool-source.tar.gz"
        tar -czf "$ARTIFACTS/$tool-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group11" "$tool.c" LICENSE
    done
    echo "Group 11 done"
fi
