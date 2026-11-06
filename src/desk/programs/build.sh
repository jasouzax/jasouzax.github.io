#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="${JAZU_PROGRAM_BUILD:-$HOME/.cache/jazu/programs}"
SDK="${JAZU_EMSDK:-$HOME/.cache/jazu/emsdk}"
if [[ ! -f "$SDK/emsdk_env.sh" ]]; then
  mkdir -p "$(dirname "$SDK")"
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$SDK"
  "$SDK/emsdk" install 4.0.20
  "$SDK/emsdk" activate 4.0.20
fi
source "$SDK/emsdk_env.sh"
[[ "$(emcc --version)" == *" 4.0.20 "* ]] || { echo 'Emscripten 4.0.20 is required' >&2; exit 1; }
mkdir -p "$WORK" "$ROOT/artifacts"
cd "$WORK"
fetch() { test -f "$2" || curl -fLsS "$1" -o "$2"; echo "$3  $2" | sha256sum -c -; }
fetch https://codeload.github.com/fastfetch-cli/fastfetch/tar.gz/refs/tags/2.40.4 fastfetch.tar.gz cf24ffaf4729c6878b1d3a758a208905952d8b25c056bac27eb76af00ebbdb43
fetch https://codeload.github.com/htop-dev/htop/tar.gz/refs/tags/3.4.1 htop.tar.gz af9ec878f831b7c27d33e775c668ec79d569aa781861c995a0fbadc1bdb666cf
fetch https://download.savannah.gnu.org/releases/tinycc/tcc-0.9.27.tar.bz2 tcc.tar.bz2 de23af78fca90ce32dff2dd45b3432b2334740bb9bb7b05bf60fdbfc396ceb9c
fetch https://ftp.gnu.org/gnu/ncurses/ncurses-6.5.tar.gz ncurses.tar.gz 136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6
if [[ "${1:-all}" != relink ]]; then
  for archive in fastfetch.tar.gz htop.tar.gz tcc.tar.bz2 ncurses.tar.gz; do tar xf "$archive"; done
  python3 "$ROOT/port.py" "$WORK"
fi
FLAGS='-Wl,--wrap=getpwuid,--wrap=getpwnam,--wrap=getpwent -Os -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createProgram -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,TTY,PIPEFS,stackSave,stackRestore -sEXPORTED_FUNCTIONS=_main,_emscripten_resize_heap -sSTACK_SIZE=1048576 -sINITIAL_MEMORY=16777216 -sERROR_ON_UNDEFINED_SYMBOLS=0'
emcc -Os -c "$ROOT/../busybox/host.c" -o "$WORK/host.o"
emcc -Os -c "$ROOT/compat.c" -o "$WORK/compat.o"
if [[ "${1:-all}" == fastfetch || "${1:-all}" == all || "${1:-all}" == relink ]]; then
  OPTIONS=$(grep -oE '(option|cmake_dependent_option)\(ENABLE_[A-Z0-9_]+' fastfetch-2.40.4/CMakeLists.txt | sed -E 's/.*\(/-D/;s/$/=OFF/' | tr '\n' ' ')
  if [[ "${1:-all}" != relink ]]; then
    emcmake cmake -S fastfetch-2.40.4 -B fastfetch-build -DCMAKE_BUILD_TYPE=MinSizeRel -DBUILD_FLASHFETCH=OFF -DBUILD_TESTS=OFF $OPTIONS -DCMAKE_C_FLAGS="-D__linux__ -Wno-implicit-function-declaration" -DCMAKE_EXE_LINKER_FLAGS="$FLAGS $WORK/host.o $WORK/compat.o"
  else
    sed -i '/^CMAKE_EXE_LINKER_FLAGS:STRING=/s/$/ -Wl,--wrap=getpwuid,--wrap=getpwnam,--wrap=getpwent/' fastfetch-build/CMakeCache.txt
    touch fastfetch-2.40.4/src/fastfetch.c
  fi
  cmake --build fastfetch-build -j4 --target fastfetch
  cp fastfetch-build/fastfetch.js "$ROOT/artifacts/fastfetch.js"
  cp fastfetch-build/fastfetch.wasm "$ROOT/artifacts/fastfetch.wasm"
fi
if [[ "${1:-all}" == tcc || "${1:-all}" == all || "${1:-all}" == relink ]]; then
  cd "$WORK/tcc-0.9.27"
  if [[ "${1:-all}" != relink ]]; then ./configure --cc=emcc --cpu=i386 --cross-prefix= --prefix=/usr --tccdir=/usr/lib/tcc --extra-cflags='-Os -DCONFIG_TCC_CROSS -DONE_SOURCE=1 -DTCC_TARGET_I386 -Wno-implicit-function-declaration'; fi
  emcc -Os -DCONFIG_TCC_CROSS -DONE_SOURCE=1 -DTCC_TARGET_I386 -Wno-implicit-function-declaration tcc.c "$WORK/host.o" "$WORK/compat.o" $FLAGS -o "$ROOT/artifacts/tcc.js"
  cd "$WORK"
fi
if [[ "${1:-all}" == htop || "${1:-all}" == all || "${1:-all}" == relink ]]; then
  if [[ "${1:-all}" != relink ]]; then
  cd "$WORK/ncurses-6.5"
  emconfigure ./configure --host=wasm32-unknown-emscripten --prefix="$WORK/ncurses-install" --without-cxx --without-cxx-binding --without-ada --without-progs --without-tests --without-shared --disable-widec --disable-database --with-fallbacks=xterm,xterm-256color,vt100 --without-manpages --without-debug CFLAGS=-Os
  emmake make -j4
  emmake make install.libs install.includes
  cd "$WORK/htop-3.4.1"
  ./autogen.sh
  emconfigure ./configure --host=wasm32-unknown-emscripten --disable-unicode --disable-affinity --disable-sensors --disable-capabilities --disable-hwloc --disable-delayacct --disable-unwind CFLAGS='-Os -g0' CPPFLAGS="-I$WORK/ncurses-install/include" LDFLAGS="-L$WORK/ncurses-install/lib $FLAGS $WORK/host.o $WORK/compat.o"
  else cd "$WORK/htop-3.4.1"; touch htop.c; fi
  emmake make -j4 LDFLAGS="-L$WORK/ncurses-install/lib $FLAGS $WORK/host.o $WORK/compat.o"
  cp htop "$ROOT/artifacts/htop.js"
  cp htop.wasm "$ROOT/artifacts/htop.wasm"
fi
if [[ -f "$ROOT/artifacts/fastfetch.wasm" && -f "$ROOT/artifacts/htop.wasm" && -f "$ROOT/artifacts/tcc.wasm" ]]; then
  node "$ROOT/package.ts" "$WORK" "$SDK"
fi
