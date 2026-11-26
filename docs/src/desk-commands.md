# Desk command guide

Open `/desk`, create a window, and choose **Open terminal**. These commands run
locally in browser Web Workers; visitors do not install Linux or upload their
working files. A browser supporting cross-origin isolation and SharedArrayBuffer
is required. Tools load on first use. Use `tools`, `tools search Images`, or
`tools search Languages` to find commands. Most commands provide `--help`.

The terminal and file windows share the same filesystem. Save work in
`/home/user` to retain it across reloads using browser storage (or a connected
folder). `/tmp` is temporary. Browser storage can be cleared by the visitor or
browser; use the file manager's Download action for backups.

## Languages

| Commands | Runtime | Examples |
| --- | --- | --- |
| `qjs`, `js` | Upstream QuickJS 2025-09-13, with a small Desk CLI | `qjs -e 'print([1,2,3].map(x => x * 2))'`; `qjs app.mjs` |
| `lua`, `lua5.4` | Upstream Lua 5.4.8, replacing the limited `lua` evaluator | `lua -e 'local t={20,22}; print(t[1]+t[2])'`; `lua app.lua` |
| `scheme`, `tinyscheme` | Upstream TinyScheme 1.42 with its standard `init.scm` | `scheme -e '(display (map (lambda (x) (* x x)) (quote (1 2 3)))) (newline)'`; `scheme app.scm` |
| `python`, `python3` | Existing Pyodide runtime | `python3 -c 'print(sum(range(10)))'` |

QuickJS supports JavaScript expressions, functions, classes, regular expressions,
BigInt, promises, and local ES modules. Files ending in `.mjs` use module mode;
`-m` selects it explicitly. Use `-e CODE`, a script filename, or `-`/no filename
to read source from stdin. Available globals are `print`, `console.log`,
`scriptArgs`, `readFile(path)` and `writeFile(path, text)`. File IO is UTF-8 text.
Arguments include the script name as `scriptArgs[0]`. Unhandled JavaScript errors
and promise rejections exit unsuccessfully. This CLI has no Node.js APIs,
browser DOM, timers, network loader, or npm package resolution. Local imports
resolve relative to their importing module.

Lua includes its standard libraries; native dynamic modules and OS facilities
depend on browser kernel support. Scheme accepts `-e CODE`, a script file, or
stdin. Its initialization library is embedded so it needs no installed files.
The older `lisp` and `basic` commands remain compact custom language subsets.
Existing `rustc`, `cargo`, `java`, `javac` and `perl` commands also have custom
implementations and should not be assumed to match a full upstream toolchain.

```sh
printf 'print(6 * 7)\n' | lua -
printf 'console.log(JSON.stringify({answer: 42}))\n' | qjs -
qjs -e 'writeFile("answer.txt", String(6 * 7))'
cat answer.txt
```

## SQLite

`sqlite3` is the upstream SQLite 3.50.4 command shell, including SQL, JSON
functions, FTS5, R-tree indexes, dot commands and CSV/JSON output modes.

```sh
sqlite3 notes.db 'create table notes(id integer primary key, body text);'
sqlite3 notes.db "insert into notes(body) values('Hello from Desk');"
sqlite3 -json notes.db 'select * from notes;'
printf 'select 20 + 22;\n' | sqlite3
sqlite3 :memory: 'select json_array(1,2,3);'
```

Databases under `/home/user` persist and can be downloaded as ordinary SQLite
files. This browser build disables extension loading, threading and WAL. Use
database files sequentially: cross-worker database locking is not implemented.
Avoid opening the same database in multiple terminals at once.

## Image tools

`imgconvert` decodes real image bytes with stb codecs and writes PNG, JPEG, BMP
or TGA. Inputs include PNG, JPEG, BMP, TGA, GIF, PSD, HDR and binary PGM/PPM,
subject to stb support. Animated inputs produce their first frame.
`identify INPUT` prints dimensions and channel count.

```sh
imgconvert photo.jpg photo.png
imgconvert --resize 640x480 --rotate 90 photo.png rotated.png
imgconvert --crop 200x100+10+20 --flip horizontal --grayscale photo.png crop.png
imgconvert --quality 85 photo.png photo.jpg
cat photo.png | imgconvert --format bmp - - > photo.bmp
png2jpg photo.png photo.jpg
jpg2png photo.jpg photo.png
bmp2png photo.bmp photo.png
png2bmp photo.png photo.bmp
identify photo.png
```

Options apply in order: crop, resize, rotation, flip, grayscale. Resize uses
exact positive `WIDTHxHEIGHT` dimensions and nearest-neighbor sampling. Crops
use `WIDTHxHEIGHT+X+Y` and must remain inside the source. Rotation is clockwise
90, 180 or 270 degrees. Flip accepts `horizontal` or `vertical`. JPEG quality
is an integer from 1 through 100 (default 90); transparency is composited on
white. Other outputs preserve alpha where the format supports it.

Use `-` for stdin/stdout; specify `--format` for output without a recognized
extension. Aliases select their output format by default and accept the same
options. Invalid options, undecodable images, out-of-bounds crops and failed
writes return a nonzero exit status. Input is limited to 128 MiB and decoded
images/output to 40 million pixels. Large images may exceed available browser
memory. Existing `cwebp`, `dwebp`, `optipng` and `potrace` remain available for
WebP conversion, PNG optimization and vector tracing.

## Rebuilding these packages

With Python 3.12+ and Emscripten **4.0.20** activated on Linux/WSL:

```sh
source "$HOME/.cache/jazu/emsdk/emsdk_env.sh"
python3 desk/program/common/build_extra.py
# Or select packages:
python3 desk/program/common/build_extra.py quickjs image_tools tools_catalog
npm run pkgbuild
npm run build
```

The build script downloads pinned upstream archives, checks SHA-256 before
extracting, builds the shared worker ABI, and writes `build/<package>` loaders,
WASM, declarations, licenses and source archives. It updates each checked-in
`desk/program/<package>/program.json` integrity hash. Build outputs are ignored,
like other Desk program artifacts, and must be restored or rebuilt before the
site build. The site automatically discovers program manifests; the existing
shared worker runs every new executable. Upstream source archives and separate
CLI/build port archives are published under `/assets/wasm/` with licenses.

Verify with `npm run types`, the kernel worker tests, and the additional
executables test in `tests/desk_programs.spec.ts` (real browser, persistent files,
pixel colors and reloads). The browser environment provides a Linux-like
userland, not a complete Linux OS or compatibility with every native executable.
