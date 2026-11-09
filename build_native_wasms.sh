#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="/home/jazo/.cache/jazu/programs"
SDK="/home/jazo/.cache/jazu/emsdk"
ARTIFACTS="$SCRIPT_DIR/src/desk/programs/artifacts"

source "$SDK/emsdk_env.sh" >/dev/null 2>&1
mkdir -p "$WORK" "$ARTIFACTS"

FLAGS="-Wl,--wrap=getpwuid,--wrap=getpwnam,--wrap=getpwent -Os -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createProgram -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,TTY,PIPEFS,stackSave,stackRestore -sEXPORTED_FUNCTIONS=_main,_emscripten_resize_heap -sSTACK_SIZE=1048576 -sINITIAL_MEMORY=16777216 -sERROR_ON_UNDEFINED_SYMBOLS=0"

echo "=== Building host.o and compat.o ==="
emcc -Os -c "$SCRIPT_DIR/src/desk/busybox/host.c" -o "$WORK/host.o"
emcc -Os -c "$SCRIPT_DIR/src/desk/programs/compat.c" -o "$WORK/compat.o"

echo "=== 1. Building bchunk ==="
cd "$WORK"
if [[ ! -f bchunk.c ]]; then
    curl -fsSL https://raw.githubusercontent.com/hessu/bchunk/master/bchunk.c -o bchunk.c
    curl -fsSL https://raw.githubusercontent.com/hessu/bchunk/master/COPYING -o bchunk-COPYING
    tar czf bchunk.tar.gz bchunk.c bchunk-COPYING
fi
emcc -Os bchunk.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/bchunk.js"
cp bchunk-COPYING "$ARTIFACTS/bchunk-LICENSE"
cp bchunk.tar.gz "$ARTIFACTS/bchunk-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/bchunk.d.ts"
echo "bchunk done"

echo "=== 2. Building caesar ==="
cd "$WORK"
if [[ ! -f caesar.c ]]; then
    curl -fsSL https://raw.githubusercontent.com/freebsd/freebsd-src/main/usr.bin/caesar/caesar.c -o caesar.c
    sed -n '2,31p' caesar.c > caesar-LICENSE
    tar czf caesar.tar.gz caesar.c caesar-LICENSE
fi
emcc -Os -lm caesar.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/caesar.js"
cp caesar-LICENSE "$ARTIFACTS/caesar-LICENSE"
cp caesar.tar.gz "$ARTIFACTS/caesar-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/caesar.d.ts"
echo "caesar done"

echo "=== 3. Building morse ==="
cd "$WORK"
if [[ ! -f morse.c ]]; then
    curl -fsSL https://raw.githubusercontent.com/freebsd/freebsd-src/main/usr.bin/morse/morse.c -o morse.c
    sed -n '2,32p' morse.c > morse-LICENSE
    tar czf morse.tar.gz morse.c morse-LICENSE
fi
emcc -Os morse.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/morse.js"
cp morse-LICENSE "$ARTIFACTS/morse-LICENSE"
cp morse.tar.gz "$ARTIFACTS/morse-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/morse.d.ts"
echo "morse done"

echo "=== 4. Building optipng ==="
cd "$WORK"
if [[ ! -d optipng-0.7.8 ]]; then
    if [[ -f /tmp/optipng-0.7.8.tar.gz ]]; then
        cp /tmp/optipng-0.7.8.tar.gz optipng.tar.gz
    else
        curl -fsSL "https://downloads.sourceforge.net/project/optipng/OptiPNG/optipng-0.7.8/optipng-0.7.8.tar.gz" -o optipng.tar.gz
    fi
    tar xzf optipng.tar.gz
fi
cd optipng-0.7.8
if [[ ! -f Makefile ]]; then
    emconfigure ./configure
fi
emmake make -j4
cd src/optipng
emcc -Os optipng.o ioutil.o optim.o ratio.o wildargs.o bitset.o \
    ../../src/opngreduc/libopngreduc.a \
    ../../src/pngxtern/libpngxtern.a \
    ../../third_party/libpng/libpng.a \
    ../../third_party/zlib/libz.a \
    ../../src/gifread/libgifread.a \
    ../../src/pnmio/libpnmio.a \
    ../../src/minitiff/libminitiff.a \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/optipng.js"
cp ../../LICENSE.txt "$ARTIFACTS/optipng-LICENSE"
cp "$WORK/optipng.tar.gz" "$ARTIFACTS/optipng-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/optipng.d.ts"
echo "optipng done"

echo "=== 5. Building cwebp & dwebp ==="
cd "$WORK"
if [[ ! -d libwebp-1.4.0 ]]; then
    if [[ -f /tmp/libwebp-1.4.0.tar.gz ]]; then
        cp /tmp/libwebp-1.4.0.tar.gz libwebp.tar.gz
    else
        curl -fsSL "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.4.0.tar.gz" -o libwebp.tar.gz
    fi
    tar xzf libwebp.tar.gz
fi
cd libwebp-1.4.0
mkdir -p build-wasm && cd build-wasm
if [[ ! -f Makefile ]]; then
    emcmake cmake .. -DCMAKE_BUILD_TYPE=MinSizeRel \
        -DWEBP_BUILD_ANIM_UTILS=OFF \
        -DWEBP_BUILD_CWEBP=ON \
        -DWEBP_BUILD_DWEBP=ON \
        -DWEBP_BUILD_GIF2WEBP=OFF \
        -DWEBP_BUILD_IMG2WEBP=OFF \
        -DWEBP_BUILD_VWEBP=OFF \
        -DWEBP_BUILD_WEBPINFO=OFF \
        -DWEBP_BUILD_WEBPMUX=OFF \
        -DWEBP_BUILD_EXTRAS=OFF \
        -DCMAKE_C_FLAGS="-Os"
fi
emmake make -j4 cwebp dwebp
emcc -Os CMakeFiles/cwebp.dir/examples/cwebp.c.o \
    libexampleutil.a libimagedec.a libwebp.a libimageioutil.a libwebpdemux.a libsharpyuv.a \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/cwebp.js"

emcc -Os CMakeFiles/dwebp.dir/examples/dwebp.c.o \
    libexampleutil.a libimagedec.a libimageenc.a libwebpdemux.a libimageioutil.a libwebp.a libsharpyuv.a \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/dwebp.js"

cp ../COPYING "$ARTIFACTS/cwebp-LICENSE"
cp ../COPYING "$ARTIFACTS/dwebp-LICENSE"
cp "$WORK/libwebp.tar.gz" "$ARTIFACTS/cwebp-source.tar.gz"
cp "$WORK/libwebp.tar.gz" "$ARTIFACTS/dwebp-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/cwebp.d.ts"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/dwebp.d.ts"
echo "cwebp and dwebp done"

echo "=== 6. Building potrace & mkbitmap ==="
cd "$WORK"
if [[ ! -d potrace-1.16 ]]; then
    if [[ -f /tmp/potrace-1.16.tar.gz ]]; then
        cp /tmp/potrace-1.16.tar.gz potrace.tar.gz
    else
        curl -fsSL "https://potrace.sourceforge.net/download/1.16/potrace-1.16.tar.gz" -o potrace.tar.gz
    fi
    tar xzf potrace.tar.gz
fi
cd potrace-1.16
if [[ ! -f Makefile ]]; then
    emconfigure ./configure --disable-shared --enable-static --disable-zlib CFLAGS="-Os"
fi
emmake make -j4
cd src
emcc -Os main.o bitmap_io.o backend_eps.o flate.o greymap.o render.o backend_pgm.o backend_svg.o backend_xfig.o backend_dxf.o backend_pdf.o backend_geojson.o lzw.o progress_bar.o bbox.o trans.o .libs/libpotrace.a "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/potrace.js"
cp ../COPYING "$ARTIFACTS/potrace-LICENSE"
cp "$WORK/potrace.tar.gz" "$ARTIFACTS/potrace-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/potrace.d.ts"

emcc -Os mkbitmap.o bitmap_io.o greymap.o "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/mkbitmap.js"
cp ../COPYING "$ARTIFACTS/mkbitmap-LICENSE"
cp "$WORK/potrace.tar.gz" "$ARTIFACTS/mkbitmap-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/mkbitmap.d.ts"
echo "potrace and mkbitmap done"

echo "=== 7. Building flac & metaflac ==="
cd "$WORK"
if [[ ! -d flac-1.4.3 ]]; then
    if [[ -f /tmp/flac-1.4.3.tar.xz ]]; then
        cp /tmp/flac-1.4.3.tar.xz flac.tar.xz
    else
        curl -fsSL "https://ftp.osuosl.org/pub/xiph/releases/flac/flac-1.4.3.tar.xz" -o flac.tar.xz
    fi
    tar xJf flac.tar.xz
fi
cd flac-1.4.3
if [[ ! -f Makefile ]]; then
    emconfigure ./configure --disable-shared --enable-static --disable-ogg --disable-examples --disable-doxygen-docs CFLAGS="-Os"
fi
emmake make -j4
cd src/flac
emcc -Os analyze.o decode.o encode.o foreign_metadata.o main.o local_string_utils.o utils.o vorbiscomment.o \
    ../share/utf8/.libs/libutf8.a \
    ../share/grabbag/.libs/libgrabbag.a \
    ../share/getopt/.libs/libgetopt.a \
    ../share/replaygain_analysis/.libs/libreplaygain_analysis.a \
    ../share/replaygain_synthesis/.libs/libreplaygain_synthesis.a \
    ../libFLAC/.libs/libFLAC.a \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/flac.js"
cp ../../COPYING.GPL "$ARTIFACTS/flac-LICENSE"
cp "$WORK/flac.tar.xz" "$ARTIFACTS/flac-source.tar.xz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/flac.d.ts"

cd ../metaflac
emcc -Os main.o operations.o operations_shorthand_cuesheet.o operations_shorthand_picture.o \
    operations_shorthand_seektable.o operations_shorthand_streaminfo.o operations_shorthand_vorbiscomment.o \
    options.o usage.o utils.o \
    ../share/grabbag/.libs/libgrabbag.a \
    ../share/replaygain_analysis/.libs/libreplaygain_analysis.a \
    ../share/getopt/.libs/libgetopt.a \
    ../share/utf8/.libs/libutf8.a \
    ../libFLAC/.libs/libFLAC.a \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -lm -o "$ARTIFACTS/metaflac.js"
cp ../../COPYING.GPL "$ARTIFACTS/metaflac-LICENSE"
cp "$WORK/flac.tar.xz" "$ARTIFACTS/metaflac-source.tar.xz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/metaflac.d.ts"
echo "flac and metaflac done"

echo "=== 8. Building bin2iso ==="
cd "$WORK"
if [[ ! -f bin2iso.c ]]; then
    curl -fsSL https://gist.githubusercontent.com/ceritium/139577/raw/bin2iso.c -o bin2iso.c
fi
sed -n '21,39p' bin2iso.c > bin2iso-LICENSE
tar czf bin2iso.tar.gz bin2iso.c bin2iso-LICENSE
emcc -Os bin2iso.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/bin2iso.js"
cp bin2iso-LICENSE "$ARTIFACTS/bin2iso-LICENSE"
cp bin2iso.tar.gz "$ARTIFACTS/bin2iso-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/bin2iso.d.ts"
echo "bin2iso done"

echo "=== 9. Building tree ==="
cd "$WORK"
if [[ ! -d unix-tree-2.1.3 ]]; then
    if [[ ! -f tree.tar.gz ]]; then
        curl -fsSL https://gitlab.com/OldManProgrammer/unix-tree/-/archive/2.1.3/unix-tree-2.1.3.tar.gz -o tree.tar.gz
    fi
    tar xzf tree.tar.gz
fi
cd unix-tree-2.1.3
emmake make CC=emcc CFLAGS="-Os -std=c11"
emcc -Os tree.o list.o hash.o color.o file.o filter.o info.o unix.o xml.o json.o html.o strverscmp.o \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/tree.js"
cp LICENSE "$ARTIFACTS/tree-LICENSE"
cp "$WORK/tree.tar.gz" "$ARTIFACTS/tree-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/tree.d.ts"
echo "tree done"

echo "=== 10. Building pwgen ==="
cd "$WORK"
if [[ ! -d pwgen-2.08 ]]; then
    if [[ ! -f pwgen.tar.gz ]]; then
        curl -fsSL -L "https://downloads.sourceforge.net/project/pwgen/pwgen/2.08/pwgen-2.08.tar.gz" -o pwgen.tar.gz
    fi
    tar xzf pwgen.tar.gz
fi
cd pwgen-2.08
if [[ ! -f Makefile ]]; then
    emconfigure ./configure CFLAGS="-Os"
fi
emmake make
emcc -Os pwgen.o pw_rand.o pw_phonemes.o randnum.o sha1.o sha1num.o \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/pwgen.js"
cp debian/copyright "$ARTIFACTS/pwgen-LICENSE"
cp "$WORK/pwgen.tar.gz" "$ARTIFACTS/pwgen-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/pwgen.d.ts"
echo "pwgen done"

echo "=== 11. Building lame ==="
cd "$WORK"
if [[ ! -d lame-3.100 ]]; then
    if [[ ! -f lame.tar.gz ]]; then
        curl -fsSL -L "https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz" -o lame.tar.gz
    fi
    tar xzf lame.tar.gz
fi
cd lame-3.100
if [[ ! -f Makefile ]]; then
    emconfigure ./configure --disable-shared --enable-static --disable-decoder CFLAGS="-Os"
fi
emmake make -j4
cd frontend
emcc -Os lame_main.o main.o brhist.o console.o get_audio.o lametime.o parse.o timestatus.o \
    ../libmp3lame/.libs/libmp3lame.a \
    "$WORK/host.o" "$WORK/compat.o" $FLAGS -sSTACK_SIZE=4194304 -sINITIAL_MEMORY=67108864 -lm -o "$ARTIFACTS/lame.js"
cp ../COPYING "$ARTIFACTS/lame-LICENSE"
cp "$WORK/lame.tar.gz" "$ARTIFACTS/lame-source.tar.gz"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/lame.d.ts"
echo "lame done"

echo "=== 12. Building Group 1 Encoding & Decoding (urlencode, htmlencode, rot13, atob, btoa) ==="
G1="$SCRIPT_DIR/src/desk/programs/sources/group1"
cd "$G1"
tar czf "$ARTIFACTS/urlencode-source.tar.gz" urlencode.c LICENSE
cp LICENSE "$ARTIFACTS/urlencode-LICENSE"
emcc -Os urlencode.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/urlencode.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/urlencode.d.ts"

tar czf "$ARTIFACTS/htmlencode-source.tar.gz" htmlencode.c LICENSE
cp LICENSE "$ARTIFACTS/htmlencode-LICENSE"
emcc -Os htmlencode.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/htmlencode.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/htmlencode.d.ts"

tar czf "$ARTIFACTS/rot13-source.tar.gz" rot13.c LICENSE
cp LICENSE "$ARTIFACTS/rot13-LICENSE"
emcc -Os rot13.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/rot13.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/rot13.d.ts"

tar czf "$ARTIFACTS/atob-source.tar.gz" base64_helper.c LICENSE
cp LICENSE "$ARTIFACTS/atob-LICENSE"
emcc -Os base64_helper.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/atob.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/atob.d.ts"

tar czf "$ARTIFACTS/btoa-source.tar.gz" base64_helper.c LICENSE
cp LICENSE "$ARTIFACTS/btoa-LICENSE"
emcc -Os base64_helper.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/btoa.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/btoa.d.ts"
echo "Group 1 tools done"

echo "=== 13. Building Group 2 Hashing (sha384sum) ==="
G2="$SCRIPT_DIR/src/desk/programs/sources/group2"
cd "$G2"
tar czf "$ARTIFACTS/sha384sum-source.tar.gz" sha384sum.c sha384-512.c sha.h sha-private.h LICENSE
cp LICENSE "$ARTIFACTS/sha384sum-LICENSE"
emcc -Os sha384sum.c sha384-512.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/sha384sum.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/sha384sum.d.ts"
echo "Group 2 tools done"

echo "=== 14. Building Group 3 Data & File Format Conversion (json-flatten, csv_json, json2yaml, ini_env_json) ==="
G3="$SCRIPT_DIR/src/desk/programs/sources/group3"
cd "$G3"
tar czf "$ARTIFACTS/json_flatten-source.tar.gz" json_flatten.c cJSON.c cJSON.h LICENSE
cp LICENSE "$ARTIFACTS/json_flatten-LICENSE"
emcc -Os json_flatten.c cJSON.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/json_flatten.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/json_flatten.d.ts"

tar czf "$ARTIFACTS/csv_json-source.tar.gz" csv_json.c cJSON.c cJSON.h LICENSE
cp LICENSE "$ARTIFACTS/csv_json-LICENSE"
emcc -Os csv_json.c cJSON.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/csv_json.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/csv_json.d.ts"

tar czf "$ARTIFACTS/json2yaml-source.tar.gz" json2yaml.c cJSON.c cJSON.h LICENSE
cp LICENSE "$ARTIFACTS/json2yaml-LICENSE"
emcc -Os json2yaml.c cJSON.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/json2yaml.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/json2yaml.d.ts"

tar czf "$ARTIFACTS/ini_env_json-source.tar.gz" ini_env_json.c cJSON.c cJSON.h LICENSE
cp LICENSE "$ARTIFACTS/ini_env_json-LICENSE"
emcc -Os ini_env_json.c cJSON.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/ini_env_json.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/ini_env_json.d.ts"
echo "Group 3 tools done"

echo "=== 15. Building Group 4 Text Manipulation (casing_tools, text_stats, text_gen, banner, word_games) ==="
G4="$SCRIPT_DIR/src/desk/programs/sources/group4"
cd "$G4"
tar czf "$ARTIFACTS/casing_tools-source.tar.gz" casing_tools.c LICENSE
cp LICENSE "$ARTIFACTS/casing_tools-LICENSE"
emcc -Os casing_tools.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/casing_tools.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/casing_tools.d.ts"

tar czf "$ARTIFACTS/text_stats-source.tar.gz" text_stats.c LICENSE
cp LICENSE "$ARTIFACTS/text_stats-LICENSE"
emcc -Os text_stats.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/text_stats.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/text_stats.d.ts"

tar czf "$ARTIFACTS/text_gen-source.tar.gz" text_gen.c LICENSE
cp LICENSE "$ARTIFACTS/text_gen-LICENSE"
emcc -Os text_gen.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/text_gen.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/text_gen.d.ts"

tar czf "$ARTIFACTS/banner-source.tar.gz" banner.c LICENSE
cp LICENSE "$ARTIFACTS/banner-LICENSE"
emcc -Os banner.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/banner.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/banner.d.ts"

tar czf "$ARTIFACTS/word_games-source.tar.gz" word_games.c LICENSE
cp LICENSE "$ARTIFACTS/word_games-LICENSE"
emcc -Os word_games.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/word_games.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/word_games.d.ts"
echo "Group 4 tools done"
echo "=== 16. Building Group 5 Numbers, Math & Advanced Computation (numbase, random_bytes, math_suite) ==="
cd "$SCRIPT_DIR/src/desk/programs/sources/group5"
tar czf "$ARTIFACTS/numbase-source.tar.gz" numbase.c LICENSE
cp LICENSE "$ARTIFACTS/numbase-LICENSE"
emcc -Os numbase.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/numbase.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/numbase.d.ts"

tar czf "$ARTIFACTS/random_bytes-source.tar.gz" random_bytes.c LICENSE
cp LICENSE "$ARTIFACTS/random_bytes-LICENSE"
emcc -Os random_bytes.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/random_bytes.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/random_bytes.d.ts"

tar czf "$ARTIFACTS/math_suite-source.tar.gz" math_suite.c LICENSE
cp LICENSE "$ARTIFACTS/math_suite-LICENSE"
emcc -Os math_suite.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/math_suite.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/math_suite.d.ts"
echo "Group 5 tools done"
echo "=== 17. Building Group 6 UUIDs & Tokens (uuid_token) ==="
cd "$SCRIPT_DIR/src/desk/programs/sources/group6"
tar czf "$ARTIFACTS/uuid_token-source.tar.gz" uuid_token.c LICENSE
cp LICENSE "$ARTIFACTS/uuid_token-LICENSE"
emcc -Os uuid_token.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/uuid_token.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/uuid_token.d.ts"
echo "Group 6 tools done"
echo "=== 18. Building Group 7 Color Conversion & Manipulation (color_tools) ==="
cd "$SCRIPT_DIR/src/desk/programs/sources/group7"
tar czf "$ARTIFACTS/color_tools-source.tar.gz" color_tools.c LICENSE
cp LICENSE "$ARTIFACTS/color_tools-LICENSE"
emcc -Os color_tools.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ARTIFACTS/color_tools.js"
echo 'export default function createProgram(options: any): Promise<any>' > "$ARTIFACTS/color_tools.d.ts"
echo "Group 7 tools done"

echo "=== ALL NATIVE WASMS BUILT SUCCESSFULLY ==="
