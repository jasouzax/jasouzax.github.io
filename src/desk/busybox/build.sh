#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="${JAZU_DESK_BUILD:-$ROOT/.build}"
VERSION=1.36.1
SDK_VERSION=4.0.20
mkdir -p "$WORK" "$ROOT/artifacts"
if ! command -v emcc >/dev/null; then
  test -d "$WORK/emsdk" || git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
  "$WORK/emsdk/emsdk" install "$SDK_VERSION"
  "$WORK/emsdk/emsdk" activate "$SDK_VERSION"
  source "$WORK/emsdk/emsdk_env.sh"
fi
if [[ "$(emcc --version)" != *" $SDK_VERSION "* ]]; then
  echo "This port requires Emscripten $SDK_VERSION; source its emsdk_env.sh first." >&2
  exit 1
fi
cd "$WORK"
test -f busybox.tar.bz2 || curl -fLsS "https://busybox.net/downloads/busybox-$VERSION.tar.bz2" -o busybox.tar.bz2
echo 'b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314  busybox.tar.bz2' | sha256sum -c -
# Extract into an owned, versioned build directory; never patch the source archive.
tar xf busybox.tar.bz2
python3 "$ROOT/port.py" "$WORK/busybox-$VERSION"
cd "busybox-$VERSION"
make clean >/dev/null
make allnoconfig >/dev/null
enable() { sed -i "/^\(# \)\?CONFIG_$1[= ]/d" .config; echo "CONFIG_$1=y" >> .config; }
string() { sed -i "/^\(# \)\?CONFIG_$1[= ]/d" .config; printf 'CONFIG_%s="%s"\n' "$1" "$2" >> .config; }
for name in ASH SH_IS_ASH ASH_JOB_CONTROL ASH_ALIAS ASH_EXPAND_PRMT ASH_GETOPTS ASH_CMDCMD ASH_HELP ASH_ECHO ASH_PRINTF ASH_TEST FEATURE_SH_EXTRA_QUIET FEATURE_SH_MATH FEATURE_EDITING FEATURE_EDITING_HISTORY FEATURE_TAB_COMPLETION FEATURE_EDITING_FANCY_PROMPT BUSYBOX SHOW_USAGE FEATURE_VERBOSE_USAGE LFS PS KILL \
  LS FEATURE_LS_FILETYPES FEATURE_LS_SORTFILES FEATURE_LS_TIMESTAMPS CAT ECHO PRINTF CP MV RM MKDIR RMDIR TOUCH LN PWD HEAD TAIL WC SORT UNIQ CUT TR TEE \
  GREP EGREP FGREP SED AWK FIND XARGS DATE SLEEP TRUE FALSE TEST EXPR BASENAME DIRNAME ENV PRINTENV UNAME ID WHOAMI HOSTNAME CHMOD OD HEXDUMP SEQ YES \
  DIFF CMP TAR GZIP GUNZIP ZCAT BUNZIP2 BZCAT UNZIP BC DC MD5SUM SHA1SUM SHA256SUM BASE64 STAT READLINK REALPATH NL TAC REV CLEAR WHICH DU DF SPLIT FOLD EXPAND \
  COMM PASTE TRUNCATE MKTEMP TREE CKSUM CRC32 FACTOR SHUF STRINGS TIMEOUT \
  FEATURE_SEAMLESS_GZ FEATURE_SEAMLESS_BZ2 FEATURE_TAR_CREATE FEATURE_TAR_AUTODETECT FEATURE_TAR_FROM FEATURE_TAR_GNU_EXTENSIONS FEATURE_TAR_LONG_OPTIONS \
  FEATURE_FIND_TYPE FEATURE_FIND_MTIME FEATURE_FIND_SIZE FEATURE_FIND_MAXDEPTH FEATURE_FIND_PATH FEATURE_FIND_NOT FEATURE_FIND_DELETE FEATURE_FIND_EXEC \
  FEATURE_FANCY_HEAD FEATURE_FANCY_TAIL FEATURE_FANCY_ECHO FEATURE_DATE_ISOFMT FEATURE_CP_LONG_OPTIONS FEATURE_HUMAN_READABLE; do enable "$name"; done
string EXTRA_CFLAGS '-Os -Wno-error -Wno-implicit-function-declaration -Wno-int-conversion -Wno-incompatible-pointer-types -Wno-unused-command-line-argument'
string EXTRA_LDFLAGS '-sMODULARIZE=1 -sEXPORT_NAME=createBusybox -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,TTY,PIPEFS,stackSave,stackRestore -sEXPORTED_FUNCTIONS=_main,_jazu_child,_jazu_interrupt,_emscripten_resize_heap -sSTACK_SIZE=1048576 -sINITIAL_MEMORY=8388608 -sERROR_ON_UNDEFINED_SYMBOLS=0 -Os'
(yes '' || true) | make oldconfig >/dev/null
sed -i 's/-Wl,--sort-common//g; s/-Wl,--sort-section alignment//g; s/-Wl,--warn-common//g' scripts/trylink
make -j"$(nproc)" CC=emcc HOSTCC=gcc AR=emar RANLIB=emranlib LD=emcc SKIP_STRIP=y busybox_unstripped
cp busybox_unstripped "$ROOT/artifacts/busybox.js"
cp busybox_unstripped.wasm "$ROOT/artifacts/busybox.wasm"
sed -i 's/busybox_unstripped\.wasm/busybox.wasm/g' "$ROOT/artifacts/busybox.js"
cp .config "$ROOT/artifacts/busybox.config"
# Source/license accompany the redistributable port; the release also needs the
# verified upstream source archive, fetched by this recipe.
cp "$WORK/busybox.tar.bz2" "$ROOT/artifacts/busybox-source.tar.bz2"
cp LICENSE "$ROOT/artifacts/LICENSE"
node "$ROOT/package.ts"
printf 'Built BusyBox %s with Emscripten %s\n' "$VERSION" "$SDK_VERSION"
