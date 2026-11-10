# WASM Systems & Packages Status

This document catalogs all core runtime systems (virtual filesystems, execution bridges, sysroots, toolchain engines) and every packaged executable in the Jazu Desktop WebAssembly environment.

---

## 1. Runtime Systems & Architecture

These systems enable packages, binaries, virtual filesystems, and compilers to interact and execute seamlessly in the browser.

| System | Role & Responsibility | Implementation & Integration |
| :--- | :--- | :--- |
| **Virtual Filesystem (VFS) & Worker IPC** | Unified hierarchical in-memory filesystem with POSIX file descriptor semantics (`open`, `read`, `write`, `seek`, `stat`, `create`, `unlink`, `opendir`, `readdir`). | Synchronous IPC over `SharedArrayBuffer` using `Atomics.wait` and `Atomics.store` (`wasm_protocol.ts`, `wasm_worker_runtime.ts`, `wasm_host.ts`). Bridges Emscripten `FS` and `PIPEFS`. |
| **ELF Binary Runner & Dispatcher** | Transparently detects and executes compiled Linux ELF binaries directly from the shell or programs. | `wasm_host.ts` inspects executable headers: detects `0x7F 'E' 'L' 'F'`, reads `e_ident[EI_CLASS]` (1 for 32-bit ELF, 2 for 64-bit ELF), and dispatches execution dynamically to `box86` or `box64`. |
| **32-bit Linux Sysroot (`x86`)** | Provides standard Linux C headers and runtime symbols for 32-bit compilation. | `tcc-sysroot.json` packaged into `/usr/include`, `/usr/lib`, `/lib/ld-linux.so.2`, and `libc.so`. Used by `tcc` (32-bit). |
| **64-bit Linux Sysroot (`x86_64`)** | Provides standard AMD64 Linux headers, runtime objects, and dynamic stubs for 64-bit compilation. | Injected into `/usr/include`, `/usr/lib64`, `crt1.o`, and `x86_64-libc.so`. Used by `x86_64-tcc` and `tcc -m64` / `clang -target x86_64-pc-linux-gnu`. |
| **WASI Sysroot (`wasm32-wasi`)** | Provides WASI libc headers (`stdio.h`, `stdlib.h`, etc.) and system libraries for compilation targeting WASM. | Mounted at `/sysroot` in the virtual filesystem; utilized by Clang for targeting `wasm32-unknown-wasi`. |
| **LLVM / Wasmer Compiler Engine** | Full LLVM 16 compiler backend packaged as WebC container running via Wasmer SDK in a dedicated worker. | `assets/wasm/clang.webc` running via `@wasmer/sdk` (`llvm_service.ts`, `wasm_worker_gcc.ts`). Used for C/C++ compilation targeting WebAssembly. |
| **Pyodide CPython Runtime System** | Full Python 3.12 WebAssembly runtime with loaded standard library. | `pyodide.asm.wasm` and `python_stdlib.zip` loaded dynamically by `wasm_worker_python_suite.ts`. Mounts the desktop virtual filesystem directly into Python's `sys.path`. |
| **TTY / Terminal Line Discipline** | Manages ANSI terminal attributes, raw mode, canonical echo, and signal handling (`SIGINT`, `SIGTERM`). | Integrated into `desk_shell.ts`, `xterm-5.5.0`, and worker I/O pipelines (`wasm_worker_runtime.ts`). |

---

## 2. Package Categories

* **`upstream`**: Genuine open-source software compiled directly from its official upstream C/C++ source code to WebAssembly via Emscripten or LLVM.
* **`redirect`**: Wrapper or driver frontend that translates flags and delegates execution directly to an `upstream` engine.
* **`custom`**: Handcrafted C re-implementations, custom user-mode CPU emulators, or synthetic script handlers.

---

## 3. Toolchains & Compilers

| Package / Binary | Category | Underlying Engine | Description |
| :--- | :--- | :--- | :--- |
| **`tcc` / `cc`** | `upstream` | Tiny C Compiler 0.9.27 (Fabrice Bellard) | Compiles ISO C99 source code directly to 32-bit x86 Linux ELF binaries. |
| **`x86_64-tcc`** | `upstream` | Tiny C Compiler 0.9.27 (AMD64 build) | Cross-compiles ISO C99 source code to authentic 64-bit AMD64 Linux ELF binaries. |
| **`clang` / `clang++`** | `upstream` | LLVM Clang 16.0.0 (`clang.webc`) | Full LLVM Clang toolchain compiling C/C++ to `wasm32-wasi`. When invoked with `-target x86_64*`, redirects to `x86_64-tcc`. |
| **`gcc` / `g++` / `cpp`** | `redirect` | `x86_64-tcc` (for `-m64`/`x86_64`), `tcc` (for 32-bit), or `clang` (for wasm32) | Front-end CLI driver that mimics GCC 14.2.0 flags, macro definitions, and diagnostics, delegating to upstream compilers. |
| **`make`** | `custom` | Custom C parser (`make.c`, 368 LOC) | Basic Makefile parser supporting target rules, prerequisites, variable definitions, and command execution. |
| **`rustc` / `rust-runner`** | `custom` | Custom C AST interpreter (`rust_suite.c`) | Evaluator for basic Rust syntax producing runnable shell/evaluation scripts. |
| **`cargo`** | `custom` | Custom C generator (`rust_suite.c`) | Scaffolds basic `Cargo.toml` projects and executes entry points. |
| **`javac`** | `custom` | Custom C compiler (`jvm_suite.c`) | Compiles basic Java source code into valid JVM `.class` bytecode. |

---

## 4. Runtimes & Binary Emulators

| Package / Binary | Category | Underlying Engine | Description |
| :--- | :--- | :--- | :--- |
| **`python` / `python3`** | `upstream` | CPython 3.12 (Pyodide 0.26+) | Full standard CPython interpreter with REPL, standard library (`python_stdlib.zip`), and NumPy support. |
| **`pip` / `venv`** | `redirect` | Synthetic handler in `wasm_worker_python_suite.ts` | CLI helper providing package management diagnostics and virtual environment scaffolding for Python. |
| **`box86` / `linux-exec`** | `custom` | Custom 32-bit x86 CPU emulator (`exec_suite.c`) | User-mode x86 CPU interpreter executing 32-bit Linux ELF binaries with dynamic libc symbol traps. |
| **`box64` / `linux64-exec`** | `custom` | Custom 64-bit AMD64 CPU emulator (`exec_suite.c`) | User-mode AMD64 CPU interpreter executing 64-bit Linux ELF binaries with Linux `syscall` traps and REX decoding. |
| **`wine` / `win-exec`** | `custom` | Custom PE loader (`exec_suite.c`) | User-mode PE32 executable loader with basic Win32 API symbol traps. |
| **`java`** | `custom` | Custom JVM interpreter (`jvm_suite.c`) | Custom stack-based JVM bytecode interpreter executing `.class` binaries. |
| **`perl`** | `custom` | Custom C parser (`perl_suite.c`) | Evaluator for basic Perl 5 expressions and scripts. |
| **`lua` / `lisp` / `basic`** | `custom` | Custom C interpreters (`lang_suite.c`) | Compact embedded interpreters for Lua 5.4, Lisp/Scheme, and BASIC. |

---

## 5. Core Utilities & System Monitoring

| Package / Binary | Category | Upstream Source / Implementation |
| :--- | :--- | :--- |
| **BusyBox suite** (`sh`, `ash`, `ls`, `cat`, `cp`, `mv`, `rm`, `mkdir`, `rmdir`, `chmod`, `chown`, `touch`, `grep`, `egrep`, `fgrep`, `sed`, `awk`, `find`, `xargs`, `tar`, `gzip`, `gunzip`, `bzip2`, `bunzip2`, `base32`, `xxd`, `wc`, `tr`, `fold`, `head`, `tail`, `tee`, `cut`, `sort`, `uniq`, `shuf`, `nl`, `factor`, `bc`, `dc`, `cal`, `date`, `sleep`, `echo`, `printf`, `env`, `pwd`, `which`, `test`, `true`, `false`, `yes`, `seq`, `rev`, `strings`, `dos2unix`, `unix2dos`, `mac2unix`, `md5sum`, `sha1sum`, `sha256sum`, `sha512sum`, `cksum`, `crc32`, etc.) | **`upstream`** | **BusyBox 1.36.1** official C source compiled to `busybox.wasm`. |
| **`fastfetch`** | **`upstream`** | **Fastfetch 2.40.4** official C codebase with browser sysinfo hooks. |
| **`htop`** | **`upstream`** | **htop 3.4.1** official C codebase linked with GNU ncurses 6.5. |
| **`tree`** | **`upstream`** | **Steve Baker Tree 2.1.3** official C source. |
| **`pwgen`** | **`upstream`** | **Theodore Ts'o pwgen 2.08** official C source. |
| **`file`** | **`custom`** | Custom C magic header analyzer (`linux_suite.c`). |
| **`readelf`** | **`custom`** | Custom C 32-bit and 64-bit ELF header and symbol table inspector (`linux_suite.c`). |

---

## 6. Data, Text & File Format Utilities

| Package / Binary | Category | Implementation Details |
| :--- | :--- | :--- |
| **`jq`** | **`upstream`** | **jq 1.7.1** official C codebase linked with Oniguruma regex library. |
| **`caesar` / `morse`** | **`upstream`** | **FreeBSD / NetBSD Games** official C sources. |
| **`sha384sum`** | **`upstream`** | **RFC 6234** standard reference C implementation. |
| **`urlencode` / `urldecode`** | **`custom`** | Custom C URL encoder/decoder (`group1/urlencode.c`). |
| **`htmlencode` / `htmldecode`**| **`custom`** | Custom C HTML entity encoder/decoder (`group1/htmlencode.c`). |
| **`atob` / `btoa`** | **`custom`** | Custom C Base64 string encoder/decoder (`group1/base64_helper.c`). |
| **`rot13`** | **`custom`** | Custom C ROT13 cipher (`group1/rot13.c`). |
| **`json-flatten`** | **`custom`** | Custom C nested JSON flattener (`group3/json_flatten.c`). |
| **`csv2json` / `json2csv` / `tsv2json` / `json2tsv`** | **`custom`** | Custom C bidirectional tabular-JSON converter (`group3/csv_json.c`). |
| **`json2yaml`** | **`custom`** | Custom C JSON to YAML converter (`group3/json2yaml.c`). |
| **`ini2json` / `env2json` / `json2env`** | **`custom`** | Custom C INI/ENV configuration converter (`group3/ini_env_json.c`). |
| **`casing_tools`** (`title-case`, `camel-case`, `snake-case`, `kebab-case`, `slugify`) | **`custom`** | Custom C string transformer (`group4/casing_tools.c`). |
| **`text_stats`** (`count-chars`, `charfreq`) | **`custom`** | Custom C character statistics and histogram generator (`group4/text_stats.c`). |
| **`text_gen`** (`lorem`, `str-repeat`) | **`custom`** | Custom C text generator (`group4/text_gen.c`). |
| **`banner` / `banner-js`** | **`custom`** | Custom C ASCII art banner generator (`group4/banner.c`). |
| **`word_games`** (`pig-latin`, `anagram`, `palindrome`) | **`custom`** | Custom C word manipulation suite (`group4/word_games.c`). |
| **`numbase`** (`dec2bin`, `dec2hex`, `dec2oct`, `hex2dec`) | **`custom`** | Custom C numeral base converter (`group5/numbase.c`). |
| **`random-bytes`** | **`custom`** | Custom C cryptographic random hex generator (`group5/random_bytes.c`). |
| **`math_suite`** (`fib`, `gcd`, `lcm`, `stats`, `matrix`) | **`custom`** | Custom C mathematical algorithms suite (`group5/math_suite.c`). |
| **`uuid_token`** (`uuidgen`, `nanoid`) | **`custom`** | Custom C RFC 4122 v4 UUID and NanoID token generator (`group6/uuid_token.c`). |
| **`color_tools`** (`hex2rgb`, `rgb2hex`, `color-mix`) | **`custom`** | Custom C color model converter (`group7/color_tools.c`). |
| **`date_units`** (`date-diff`, `bytes-human`, `temp`, `unit`) | **`custom`** | Custom C duration and measurement converter (`group8/date_units.c`). |
| **`qr`** | **`custom`** | QR code terminal renderer using `qrcodegen` (`group9/qr_main.c`). |
| **`net_tools`** (`url-parse`, `http-status`, `mime-type`) | **`custom`** | Custom C network and MIME helper (`group9/net_tools.c`). |
| **`file_analysis`** (`entropy`, `detect-encoding`, `file-info`) | **`custom`** | Custom C Shannon entropy and encoding detector (`group9/file_analysis.c`). |
| **`string_helpers`** (`escape-string`, `unescape-string`, `count-tokens`) | **`custom`** | Custom C string escape and LLM token counter (`group10/string_helpers.c`). |
| **`markup_tools`** (`md2html`, `html2text`) | **`custom`** | Custom C markdown parser and HTML stripper (`group10/markup_tools.c`). |
| **`tools`** | **`custom`** | Catalog directory listing (`group10/tools_catalog.c`). |
| **`iconv` / `recode`** | **`custom`** | Custom C charset encoding tables (`group11/encoding_suite.c`). |
| **`xmlstarlet` / `xq`** | **`custom`** | Custom C XML parser built on `cJSON` (`group12/xml_suite.c`). |
| **`yq`** | **`custom`** | Custom C YAML processor (`group12/yq.c`). |
| **`csv_suite`** (`csvsql`, `csvformat`, `xlsx2csv`, `csvjson`, `in2csv`) | **`custom`** | Custom C tabular data transformer (`group12/csv_suite.c`). |

---

## 7. Media, Document & Archive Utilities

| Package / Binary | Category | Implementation Details |
| :--- | :--- | :--- |
| **`optipng`** | **`upstream`** | **OptiPNG 0.7.8** official C codebase. |
| **`cwebp` / `dwebp`** | **`upstream`** | **Google libwebp 1.4.0** official C tools. |
| **`flac` / `metaflac`** | **`upstream`** | **Xiph.Org FLAC 1.4.3** official C suite. |
| **`potrace` / `mkbitmap`** | **`upstream`** | **Potrace 1.16** official C codebase. |
| **`lame`** | **`upstream`** | **LAME 3.100** official MP3 encoder. |
| **`bchunk` / `bin2iso`** | **`upstream`** | **BinChunker 1.2.2 / bin2iso 1.9b** official C sources. |
| **`pdf_suite`** (`pdftotext`, `pdfinfo`, `pdfimages`, `img2pdf`, `qpdf`) | **`custom`** | Custom C PDF stream search, header parser, and image extractor (`group13/pdf_suite.c`). |
| **`postscript_suite`** (`enscript`, `a2ps`) | **`custom`** | Custom C plain text to PostScript converter (`group13/postscript_suite.c`). |
| **`doc_suite`** (`antiword`, `docx2txt`, `odt2txt`) | **`custom`** | Custom C document stream and XML text extractor (`group13/doc_suite.c`). |
| **`image_suite`** (`pngtopnm`, `pnmtopng`, `jpegtopnm`, `pnmtojpeg`, `jpegoptim`) | **`custom`** | Custom C image converters built on `stb_image.h` and `stb_image_write.h` (`group14/image_suite.c`). |
| **`audio_suite`** (`sox`, `soxi`, `oggdec`, `oggenc`, `opusdec`, `opusenc`) | **`custom`** | Custom C WAV synthesizer and audio header parser using `stb_vorbis.h` (`group15/audio_suite.c`). |
| **`disk_archive_suite`** (`iat`, `7z`, `p7zip`) | **`custom`** | Custom C ISO 9660 and 7z archive header extractor (`group16/disk_archive_suite.c`). |

