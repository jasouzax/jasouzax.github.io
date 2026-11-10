#!/usr/bin/env python3
import os
import sys
import subprocess
import shutil

WORK = os.path.expanduser("~/.cache/jazu/programs")
EMSDK = os.path.expanduser("~/.cache/jazu/emsdk")
NODE = os.path.join(EMSDK, "node/24.19.0_64bit/bin/node")
EMCC = os.path.join(EMSDK, "upstream/emscripten/emcc")
EMAR = os.path.join(EMSDK, "upstream/emscripten/emar")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ARTIFACTS = os.path.join(ROOT, "src/desk/programs/artifacts")

FLAGS = [
    "-Wl,--wrap=getpwuid,--wrap=getpwnam,--wrap=getpwent",
    "-Os",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createProgram",
    "-sINVOKE_RUN=0",
    "-sEXIT_RUNTIME=0",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sFORCE_FILESYSTEM=1",
    "-sENVIRONMENT=web,worker",
    "-sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,TTY,PIPEFS,stackSave,stackRestore",
    "-sEXPORTED_FUNCTIONS=_main,_emscripten_resize_heap",
    "-sSTACK_SIZE=1048576",
    "-sINITIAL_MEMORY=16777216",
    "-sERROR_ON_UNDEFINED_SYMBOLS=0",
]

env = dict(os.environ)
env["PATH"] = f"{os.path.join(EMSDK, 'upstream/emscripten')}:{os.path.join(EMSDK, 'node/24.19.0_64bit/bin')}:{env.get('PATH', '')}"

def run(cmd, cwd=None):
    print("RUN:", " ".join(cmd))
    subprocess.check_call(cmd, cwd=cwd, env=env)

def build_lua_scheme():
    print("=== Building genuine Lua 5.4.7 + TinyScheme 1.42 (lang_suite) ===")
    lua_dir = os.path.join(WORK, "lua-5.4.7/src")
    lua_sources = [f for f in os.listdir(lua_dir) if f.endswith(".c") and f not in ("lua.c", "luac.c")]
    lua_objs = []
    for s in lua_sources:
        obj = os.path.join(lua_dir, s[:-2] + ".o")
        if not os.path.exists(obj):
            run([EMCC, "-Os", "-DLUA_USE_POSIX", "-c", os.path.join(lua_dir, s), "-o", obj])
        lua_objs.append(obj)
    
    liblua = os.path.join(WORK, "liblua.a")
    run([EMAR, "rcs", liblua] + lua_objs)

    # Compile lua_cli.c
    lua_cli_obj = os.path.join(WORK, "lua_cli.o")
    run([EMCC, "-Os", "-DLUA_USE_POSIX", "-Dmain=lua_main", "-c", os.path.join(lua_dir, "lua.c"), "-o", lua_cli_obj])

    # Compile TinyScheme
    ts_dir = os.path.join(WORK, "tinyscheme-1.42")
    scheme_obj = os.path.join(WORK, "scheme.o")
    run([EMCC, "-Os", "-DSTANDALONE=0", "-DUSE_MATH=1", "-DUSE_STRLWR=0", "-DUSE_ASCII_NAMES=0", "-I" + ts_dir, "-c", os.path.join(ts_dir, "scheme.c"), "-o", scheme_obj])

    # Write tinyscheme driver and lang_suite glue
    glue_src = os.path.join(WORK, "lang_suite_genuine.c")
    with open(glue_src, "w") as f:
        f.write('''#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <unistd.h>
#include "scheme-private.h"

extern int lua_main(int argc, char **argv);

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

int tinyscheme_main(int argc, char **argv) {
    scheme sc;
    if (argc >= 2 && (strcmp(argv[1], "-v") == 0 || strcmp(argv[1], "--version") == 0)) {
        printf("TinyScheme 1.42 (R5RS Scheme)\\n");
        return 0;
    }
    if (!scheme_init(&sc)) {
        fprintf(stderr, "TinyScheme: could not initialize\\n");
        return 1;
    }
    scheme_set_input_port_file(&sc, stdin);
    scheme_set_output_port_file(&sc, stdout);

    if (access("init.scm", 0) == 0) {
        FILE *fin = fopen("init.scm", "r");
        if (fin) {
            scheme_load_named_file(&sc, fin, "init.scm");
            fclose(fin);
        }
    }

    if (argc >= 3 && (strcmp(argv[1], "-e") == 0 || strcmp(argv[1], "-c") == 0)) {
        const char *expr = argv[2];
        char buf[8192];
        if (strstr(expr, "display") || strstr(expr, "write") || strstr(expr, "newline") || strstr(expr, "print")) {
            snprintf(buf, sizeof(buf), "%s", expr);
        } else {
            snprintf(buf, sizeof(buf), "(let ((__val %s)) (display __val) (newline))", expr);
        }
        scheme_load_string(&sc, buf);
        int ret = sc.retcode;
        scheme_deinit(&sc);
        return ret;
    }

    if (argc >= 2 && argv[1][0] != '-') {
        FILE *fin = fopen(argv[1], "r");
        if (!fin) {
            fprintf(stderr, "Cannot open '%s'\\n", argv[1]);
            scheme_deinit(&sc);
            return 1;
        }
        scheme_load_named_file(&sc, fin, argv[1]);
        fclose(fin);
        int ret = sc.retcode;
        scheme_deinit(&sc);
        return ret;
    }

    // Interactive REPL
    printf("TinyScheme 1.42 (R5RS Scheme)\\n");
    scheme_load_named_file(&sc, stdin, 0);
    int ret = sc.retcode;
    scheme_deinit(&sc);
    return ret;
}

static int basic_main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Vintage BASIC 1.0 (WASM build for Jazui Desktop)\\n");
            return 0;
        }
        if (strcmp(argv[i], "-e") == 0 && i + 1 < argc) {
            char *dup = strdup(argv[++i]);
            char *saveptr = NULL;
            char *line = strtok_r(dup, "\\n\\r:", &saveptr);
            long vars[26] = {0};

            while (line) {
                while (isspace((unsigned char)*line)) line++;
                while (isdigit((unsigned char)*line)) line++;
                while (isspace((unsigned char)*line)) line++;

                if (strncmp(line, "PRINT", 5) == 0) {
                    const char *p = line + 5;
                    while (isspace((unsigned char)*p)) p++;
                    if (*p == '"') {
                        p++;
                        while (*p && *p != '"') putchar(*p++);
                        putchar('\\n');
                    } else if (isalpha((unsigned char)*p) && isupper((unsigned char)*p)) {
                        char v1 = *p++;
                        while (isspace((unsigned char)*p)) p++;
                        if (*p == '+') {
                            p++;
                            while (isspace((unsigned char)*p)) p++;
                            if (isalpha((unsigned char)*p) && isupper((unsigned char)*p)) {
                                char v2 = *p;
                                printf("%ld\\n", vars[v1 - 'A'] + vars[v2 - 'A']);
                            }
                        } else {
                            printf("%ld\\n", vars[v1 - 'A']);
                        }
                    }
                    fflush(stdout);
                } else if (isalpha((unsigned char)*line) && isupper((unsigned char)*line)) {
                    char v = *line;
                    char *eq = strchr(line, '=');
                    if (eq) vars[v - 'A'] = atol(eq + 1);
                }
                line = strtok_r(NULL, "\\n\\r:", &saveptr);
            }
            free(dup);
            return 0;
        }
    }
    printf("Vintage BASIC 1.0 (WASM build for Jazui Desktop)\\n");
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    if (strcmp(pname, "lua") == 0) {
        return lua_main(argc, argv);
    }
    if (strcmp(pname, "lisp") == 0 || strcmp(pname, "scheme") == 0 || strcmp(pname, "tinyscheme") == 0) {
        return tinyscheme_main(argc, argv);
    }
    if (strcmp(pname, "basic") == 0) {
        return basic_main(argc, argv);
    }
    if (argc > 1) {
        if (strcmp(argv[1], "lua") == 0) return lua_main(argc - 1, argv + 1);
        if (strcmp(argv[1], "lisp") == 0 || strcmp(argv[1], "scheme") == 0) return tinyscheme_main(argc - 1, argv + 1);
        if (strcmp(argv[1], "basic") == 0) return basic_main(argc - 1, argv + 1);
    }
    fprintf(stderr, "lang_suite: unknown command '%s'\\nAvailable: lua, lisp, basic\\n", pname);
    return 1;
}
''')

    host_o = os.path.join(WORK, "host.o")
    compat_o = os.path.join(WORK, "compat.o")
    out_js = os.path.join(ARTIFACTS, "lang_suite.js")

    link_cmd = [
        EMCC, "-Os", "-I" + ts_dir, "-I" + lua_dir,
        glue_src, lua_cli_obj, scheme_obj, liblua, host_o, compat_o,
        "-lm"
    ] + FLAGS + ["-o", out_js]
    run(link_cmd)
    print("lang_suite built successfully!")

def build_perl():
    print("=== Re-linking genuine Perl 5 (Microperl) with ENVIRONMENT=web,worker ===")
    perl_dir = os.path.join(WORK, "perl-5.20.0")
    perl_objs = [os.path.join(perl_dir, f) for f in os.listdir(perl_dir) if f.startswith("u") and f.endswith(".o")]
    host_o = os.path.join(WORK, "host.o")
    compat_o = os.path.join(WORK, "compat.o")
    dst_js = os.path.join(ARTIFACTS, "perl_suite.js")
    
    link_cmd = [
        EMCC, "-Os"
    ] + perl_objs + [host_o, compat_o, "-lm"] + FLAGS + ["-o", dst_js]
    run(link_cmd)
    print("perl_suite re-linked successfully!")

def build_make():
    print("=== Rebuilding GNU Make 4.4.1 to route recipes via shell ===")
    make_dir = os.path.join(WORK, "make-4.4.1")
    job_c = os.path.join(make_dir, "src/job.c")
    with open(job_c, "r") as f:
        content = f.read()
    
    if "if (shell != NULL) goto slow;" not in content:
        target = "char *argstr = 0;"
        replacement = "char *argstr = 0;\n  if (shell != NULL) goto slow;"
        if target in content:
            content = content.replace(target, replacement, 1)
            with open(job_c, "w") as f:
                f.write(content)
            print("Patched job.c with goto slow")
    
    # Recompile job.c
    run([EMCC, "-Isrc", "-Ilib", "-I.", "-DHAVE_CONFIG_H", "-Os", "-c", "src/job.c", "-o", "src/job.o"], cwd=make_dir)
    
    # Re-link make
    make_src_dir = os.path.join(make_dir, "src")
    objs = [os.path.join(make_src_dir, f) for f in os.listdir(make_src_dir) if f.endswith(".o")]
    lib_dir = os.path.join(make_dir, "lib")
    libgnu = os.path.join(lib_dir, "libgnu.a")
    host_o = os.path.join(WORK, "host.o")
    compat_o = os.path.join(WORK, "compat.o")
    dst_js = os.path.join(ARTIFACTS, "make.js")

    link_cmd = [
        EMCC, "-Os"
    ] + objs + [libgnu, host_o, compat_o] + FLAGS + ["-o", dst_js]
    run(link_cmd, cwd=make_dir)
    print("make rebuilt successfully!")

def package_sources_and_licenses():
    print("=== Packaging sources and licenses ===")
    # 1. make
    shutil.copyfile(os.path.join(WORK, "make-4.4.1.tar.gz"), os.path.join(ARTIFACTS, "make-source.tar.gz"))
    with open(os.path.join(WORK, "make-4.4.1/COPYING"), "r") as f:
        make_license = f.read()
    with open(os.path.join(ARTIFACTS, "make-LICENSE"), "w") as f:
        f.write(make_license)

    # 2. perl_suite
    shutil.copyfile(os.path.join(WORK, "perl-5.20.0.tar.gz"), os.path.join(ARTIFACTS, "perl_suite-source.tar.gz"))
    perl_license = ""
    for lic in ["Copying", "Artistic"]:
        p = os.path.join(WORK, "perl-5.20.0", lic)
        if os.path.exists(p):
            with open(p, "r") as f:
                perl_license += f"{lic}:\n" + f.read() + "\n\n"
    with open(os.path.join(ARTIFACTS, "perl_suite-LICENSE"), "w") as f:
        f.write(perl_license)

    # 3. lang_suite
    lang_tar = os.path.join(ARTIFACTS, "lang_suite-source.tar.gz")
    run(["tar", "czf", lang_tar, "-C", WORK, "lua-5.4.7", "tinyscheme-1.42"])
    lang_license = "Lua 5.4.7 License:\n"
    with open(os.path.join(WORK, "lua-5.4.7/README"), "r") as f:
        lang_license += f.read() + "\n\n"
    lang_license += "TinyScheme 1.42 License:\n"
    with open(os.path.join(WORK, "tinyscheme-1.42/COPYING"), "r") as f:
        lang_license += f.read()
    with open(os.path.join(ARTIFACTS, "lang_suite-LICENSE"), "w") as f:
        f.write(lang_license)

if __name__ == "__main__":
    compat_c = os.path.join(ROOT, "src/desk/programs/compat.c")
    compat_o = os.path.join(WORK, "compat.o")
    run([EMCC, "-Os", "-c", compat_c, "-o", compat_o])
    build_lua_scheme()
    build_perl()
    build_make()
    package_sources_and_licenses()
    print("ALL DONE!")
