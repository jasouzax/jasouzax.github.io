#!/usr/bin/env python3
"""Rebuild Desk's upstream languages, SQLite, image tools and command directory.

Run with Emscripten 4.0.20 activated. Sources are pinned and verified before use.
Outputs follow the existing build/<package> contract; manifests pin the WASM hash.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / ".cache" / "desk-extra"
FLAGS = ["-Os", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createProgram",
         "-sINVOKE_RUN=0", "-sEXIT_RUNTIME=0", "-sALLOW_MEMORY_GROWTH=1",
         "-sFORCE_FILESYSTEM=1", "-sENVIRONMENT=web,worker", "-sSTACK_SIZE=1048576",
         "-sINITIAL_MEMORY=16777216",
         "-sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,TTY,PIPEFS,stackSave,stackRestore",
         "-sEXPORTED_FUNCTIONS=_main,_emscripten_resize_heap"]
PACKAGES = {
    "scheme": ("1.42", ["scheme", "tinyscheme"], "https://downloads.sourceforge.net/project/tinyscheme/tinyscheme/tinyscheme-1.42/tinyscheme-1.42.tar.gz",
               "17b0b1bffd22f3d49d5833e22a120b339039d2cfda0b46d6fc51dd2f01b407ad", "tinyscheme-1.42", "tar.gz"),
    "lua": ("5.4.8", ["lua", "lua5.4"], "https://www.lua.org/ftp/lua-5.4.8.tar.gz",
            "4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae", "lua-5.4.8", "tar.gz"),
    "quickjs": ("2025-09-13", ["qjs", "js"], "https://bellard.org/quickjs/quickjs-2025-09-13-2.tar.xz",
                "996c6b5018fc955ad4d06426d0e9cb713685a00c825aa5c0418bd53f7df8b0b4", "quickjs-2025-09-13", "tar.xz"),
    "sqlite3": ("3.50.4", ["sqlite3"], "https://sqlite.org/2025/sqlite-amalgamation-3500400.zip",
                "1d3049dd0f830a025a53105fc79fd2ab9431aea99e137809d064d8ee8356b032", "sqlite-amalgamation-3500400", "zip"),
    "image_tools": ("1.0.0", ["imgconvert", "identify", "png2jpg", "jpg2png", "bmp2png", "png2bmp"], None, None, None, "tar.gz"),
    "tools_catalog": ("1.1.0", ["tools"], None, None, None, "tar.gz"),
}


def run(args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT)


def build(name):
    version, commands, url, digest, source_dir, extension = PACKAGES[name]
    output = ROOT / "build" / name
    custom = ROOT / "desk" / "program" / name
    output.mkdir(parents=True, exist_ok=True)
    custom.mkdir(parents=True, exist_ok=True)
    source = None
    archive = WORK / f"{name}.{extension}"
    if url:
        if not archive.exists():
            with urllib.request.urlopen(url, timeout=90) as response:
                archive.write_bytes(response.read())
        if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"Source checksum mismatch: {archive}")
        if extension == "zip":
            with zipfile.ZipFile(archive) as bundle:
                for item in bundle.namelist():
                    if not (WORK / item).resolve().is_relative_to(WORK.resolve()):
                        raise RuntimeError("Unsafe archive path")
                bundle.extractall(WORK)
        else:
            with tarfile.open(archive) as bundle:
                bundle.extractall(WORK, filter="data")
        source = WORK / source_dir
        shutil.copyfile(archive, output / f"{name}-source.{extension}")

    extra = []
    if name == "scheme":
        (output / "desk_scheme_init.h").write_text("static const char desk_scheme_init[] = " + json.dumps((source / "init.scm").read_text()) + ";\n")
        sources = [custom / "cli.c", source / "scheme.c"]
        extra = [f"-I{source}", f"-I{output}", "-DSTANDALONE=0", "-DUSE_DL=0", "-DUSE_STRLWR=0", "-Wno-switch"]
        license_text = (source / "COPYING").read_text()
    elif name == "lua":
        sources = sorted(p for p in (source / "src").glob("*.c") if p.name != "luac.c")
        extra = ["-DLUA_USE_POSIX"]
        license_text = (source / "doc" / "readme.html").read_text()
    elif name == "quickjs":
        sources = [custom / "cli.c"] + [source / file for file in ["quickjs.c", "dtoa.c", "libregexp.c", "libunicode.c", "cutils.c"]]
        extra = [f"-I{source}", "-D_GNU_SOURCE", f'-DCONFIG_VERSION="{version}"']
        license_text = (source / "LICENSE").read_text()
    elif name == "sqlite3":
        sources = [source / "shell.c", source / "sqlite3.c"]
        extra = ["-DSQLITE_THREADSAFE=0", "-DSQLITE_OMIT_LOAD_EXTENSION", "-DSQLITE_OMIT_WAL", "-DSQLITE_ENABLE_FTS5", "-DSQLITE_ENABLE_RTREE", "-DSQLITE_DISABLE_LFS"]
        license_text = "SQLite is in the public domain. https://sqlite.org/copyright.html\n" + (source / "sqlite3.c").read_text()[:1500]
    else:
        sources = [custom / f"{name}.c"]
        license_text = (ROOT / "desk/program/image_suite/LICENSE").read_text() if name == "image_tools" else (custom / "LICENSE").read_text()

    run(["emcc", *sources, *FLAGS, *extra, "-lm", "-o", output / f"{name}.js"])
    license_text = "\n".join(line.rstrip() for line in license_text.splitlines()) + "\n"
    (custom / "LICENSE").write_text(license_text)
    (output / f"{name}-LICENSE").write_text(license_text)
    (output / f"{name}.d.ts").write_text("declare function createProgram(options?: any): Promise<any>;\nexport default createProgram;\n")
    # Include our CLI/build sources with the distributed upstream source.
    with tarfile.open(output / f"{name}-port.tar.gz", "w:gz") as bundle:
        for path in sorted(custom.glob("*")):
            if path.is_file() and path.name != "program.json":
                bundle.add(path, arcname=f"{name}/{path.name}")
        bundle.add(Path(__file__), arcname="common/build_extra.py")
        if name == "image_tools":
            for file in ["stb_image.h", "stb_image_write.h"]:
                bundle.add(ROOT / "desk/program/image_suite" / file, arcname=f"image_suite/{file}")
    if not url:
        shutil.copyfile(output / f"{name}-port.tar.gz", output / f"{name}-source.tar.gz")
    manifest = {"name": name, "version": version + "-jazu.1", "extension": extension,
                "commands": commands, "files": {"wasm": f"build/{name}/{name}.wasm", "loader": f"build/{name}/{name}.js"},
                "sha256": hashlib.sha256((output / f"{name}.wasm").read_bytes()).hexdigest(), "flags": {"applet": False}}
    if url:
        manifest.update(source_url=url, source_sha256=digest)
    (custom / "program.json").write_text(json.dumps(manifest, indent=4) + "\n")
    print(f"Built {name}: {', '.join(commands)}", flush=True)


if __name__ == "__main__":
    if " 4.0.20 " not in subprocess.check_output(["emcc", "--version"], text=True):
        raise RuntimeError("Activate Emscripten 4.0.20 before building")
    WORK.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:] or PACKAGES:
        if name not in PACKAGES:
            raise RuntimeError(f"Unknown package: {name}")
        build(name)
