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
