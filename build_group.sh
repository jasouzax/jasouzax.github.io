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

if [[ "$TARGET" == "group12" || "$TARGET" == "12" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 12 ==="
    echo "Building xml_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group12/xml_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/xml_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group12/LICENSE" "$ARTIFACTS/xml_suite-LICENSE"
    rm -f "$ARTIFACTS/xml_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/xml_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group12" xml_suite.c LICENSE

    echo "Building yq..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group12/yq.c" "$SCRIPT_DIR/src/desk/programs/sources/group12/cJSON.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/yq.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group12/LICENSE" "$ARTIFACTS/yq-LICENSE"
    rm -f "$ARTIFACTS/yq-source.tar.gz"
    tar -czf "$ARTIFACTS/yq-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group12" yq.c cJSON.c cJSON.h LICENSE

    echo "Building csv_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group12/csv_suite.c" "$SCRIPT_DIR/src/desk/programs/sources/group12/cJSON.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/csv_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group12/LICENSE" "$ARTIFACTS/csv_suite-LICENSE"
    rm -f "$ARTIFACTS/csv_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/csv_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group12" csv_suite.c cJSON.c cJSON.h LICENSE
    echo "Group 12 done"
fi

if [[ "$TARGET" == "group13" || "$TARGET" == "13" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 13 ==="
    echo "Building pdf_suite..."
    emcc -Os -sUSE_ZLIB=1 "$SCRIPT_DIR/src/desk/programs/sources/group13/pdf_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/pdf_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group13/LICENSE" "$ARTIFACTS/pdf_suite-LICENSE"
    rm -f "$ARTIFACTS/pdf_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/pdf_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group13" pdf_suite.c LICENSE

    echo "Building postscript_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group13/postscript_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/postscript_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group13/LICENSE" "$ARTIFACTS/postscript_suite-LICENSE"
    rm -f "$ARTIFACTS/postscript_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/postscript_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group13" postscript_suite.c LICENSE

    echo "Building doc_suite..."
    emcc -Os -sUSE_ZLIB=1 "$SCRIPT_DIR/src/desk/programs/sources/group13/doc_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/doc_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group13/LICENSE" "$ARTIFACTS/doc_suite-LICENSE"
    rm -f "$ARTIFACTS/doc_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/doc_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group13" doc_suite.c LICENSE
    echo "Group 13 done"
fi

if [[ "$TARGET" == "group14" || "$TARGET" == "14" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 14 ==="
    echo "Building image_suite..."
    emcc -Os -I"$SCRIPT_DIR/src/desk/programs/sources/group14" "$SCRIPT_DIR/src/desk/programs/sources/group14/image_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/image_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group14/LICENSE" "$ARTIFACTS/image_suite-LICENSE"
    rm -f "$ARTIFACTS/image_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/image_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group14" image_suite.c stb_image.h stb_image_write.h LICENSE
    echo "Group 14 done"
fi

if [[ "$TARGET" == "group15" || "$TARGET" == "15" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 15 ==="
    echo "Building audio_suite..."
    emcc -Os -I"$SCRIPT_DIR/src/desk/programs/sources/group15" "$SCRIPT_DIR/src/desk/programs/sources/group15/audio_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/audio_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group15/LICENSE" "$ARTIFACTS/audio_suite-LICENSE"
    rm -f "$ARTIFACTS/audio_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/audio_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group15" audio_suite.c stb_vorbis.h LICENSE
    echo "Group 15 done"
fi

if [[ "$TARGET" == "group16" || "$TARGET" == "16" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 16 ==="
    echo "Building disk_archive_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group16/disk_archive_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/disk_archive_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group16/LICENSE" "$ARTIFACTS/disk_archive_suite-LICENSE"
    rm -f "$ARTIFACTS/disk_archive_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/disk_archive_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group16" disk_archive_suite.c LICENSE
    echo "Group 16 done"
fi

if [[ "$TARGET" == "group17" || "$TARGET" == "17" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 17 ==="
    echo "Building linux_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group17/linux_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/linux_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group17/LICENSE" "$ARTIFACTS/linux_suite-LICENSE"
    rm -f "$ARTIFACTS/linux_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/linux_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group17" linux_suite.c LICENSE
    echo "Group 17 done"
fi

if [[ "$TARGET" == "group18" || "$TARGET" == "18" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 18 ==="
    echo "Building exec_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group18/exec_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/exec_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group18/LICENSE" "$ARTIFACTS/exec_suite-LICENSE"
    rm -f "$ARTIFACTS/exec_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/exec_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group18" exec_suite.c LICENSE
    echo "Group 18 done"
fi

if [[ "$TARGET" == "group19" || "$TARGET" == "19" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 19 ==="
    echo "Building make..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group19/make.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/make.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group19/LICENSE" "$ARTIFACTS/make-LICENSE"
    rm -f "$ARTIFACTS/make-source.tar.gz"
    tar -czf "$ARTIFACTS/make-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group19" make.c LICENSE
    echo "Group 19 done"
fi

if [[ "$TARGET" == "group20" || "$TARGET" == "20" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 20 ==="
    echo "Building python_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group20/python_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/python_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group20/LICENSE" "$ARTIFACTS/python_suite-LICENSE"
    rm -f "$ARTIFACTS/python_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/python_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group20" python_suite.c LICENSE
    echo "Group 20 done"
fi

if [[ "$TARGET" == "group21" || "$TARGET" == "21" || "$TARGET" == "all" ]]; then
    echo "=== Building Group 21 ==="
    echo "Building rust_suite..."
    emcc -Os "$SCRIPT_DIR/src/desk/programs/sources/group21/rust_suite.c" "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/rust_suite.js"
    cp "$SCRIPT_DIR/src/desk/programs/sources/group21/LICENSE" "$ARTIFACTS/rust_suite-LICENSE"
    rm -f "$ARTIFACTS/rust_suite-source.tar.gz"
    tar -czf "$ARTIFACTS/rust_suite-source.tar.gz" -C "$SCRIPT_DIR/src/desk/programs/sources/group21" rust_suite.c LICENSE
    echo "Group 21 done"
fi






