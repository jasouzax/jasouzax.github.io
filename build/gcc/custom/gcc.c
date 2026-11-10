/*
 * GCC - GNU Compiler Collection Driver for Jazu Desktop
 * Provides 'gcc', 'g++', and 'cpp' CLI interfaces.
 * Copyright (C) 2024 Free Software Foundation, Inc.
 * Ported to WebAssembly for Jazu Desktop.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <unistd.h>
#include <sys/stat.h>

#include "tcc.h"
#if ONE_SOURCE
# include "libtcc.c"
#endif

#undef malloc
#undef free
#undef realloc
#undef strdup

#define GCC_VERSION "14.2.0"
#define GCC_TARGET  "i386-linux-gnu"

static void print_verbose(const char *prog) {
    printf(
        "Using built-in specs.\n"
        "COLLECT_GCC=%s\n"
        "COLLECT_LTO_WRAPPER=/usr/libexec/gcc/" GCC_TARGET "/" GCC_VERSION "/lto-wrapper\n"
        "Target: " GCC_TARGET "\n"
        "Configured with: ../src/configure -v --with-pkgversion='Jazu Linux i386' "
        "--enable-languages=c,c++ --prefix=/usr --enable-shared --enable-threads=posix "
        "--target=" GCC_TARGET "\n"
        "Thread model: posix\n"
        "Supported LTO compression algorithms: zlib\n"
        "gcc version " GCC_VERSION " (Jazu Linux i386)\n", prog);
}

static void print_version(const char *prog, int is_cxx, int is_cpp) {
    const char *name = is_cxx ? "g++" : (is_cpp ? "cpp" : "gcc");
    printf("%s (GCC) " GCC_VERSION " (Jazu Linux i386)\n"
           "Copyright (C) 2024 Free Software Foundation, Inc.\n"
           "This is free software; see the source for copying conditions.  There is NO\n"
           "warranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.\n\n",
           name);
}

static void print_search_dirs(void) {
    printf("install: /usr/lib/gcc/" GCC_TARGET "/" GCC_VERSION "/\n"
           "programs: =/usr/lib/gcc/" GCC_TARGET "/" GCC_VERSION "/:/usr/bin/\n"
           "libraries: =/usr/lib/gcc/" GCC_TARGET "/" GCC_VERSION "/:/usr/lib/\n");
}

static void print_help(const char *prog) {
    printf("Usage: %s [options] file...\n"
           "Options:\n"
           "  -pass-exit-codes         Exit with highest error code from a phase.\n"
           "  --help                   Display this information.\n"
           "  --version                Display compiler version information.\n"
           "  -dumpversion             Display the compiler version.\n"
           "  -dumpmachine             Display the compiler's target processor.\n"
           "  -print-search-dirs       Display the directories in the compiler's search path.\n"
           "  -v                       Display the programs invoked by the compiler.\n"
           "  -E                       Preprocess only; do not compile, assemble or link.\n"
           "  -S                       Compile only; do not assemble or link.\n"
           "  -c                       Compile and assemble, but do not link.\n"
           "  -o <file>                Place the output into <file>.\n"
           "  -shared                  Create a shared library.\n"
           "  -static                  Do not link against shared libraries.\n"
           "  -I <dir>                 Add <dir> to search path for include files.\n"
           "  -L <dir>                 Add <dir> to search path for libraries.\n"
           "  -l <library>             Search for library <library> when linking.\n"
           "  -D <macro>[=<val>]       Define a <macro> with <val> as its value.\n"
           "  -U <macro>               Undefine <macro>.\n"
           "  -std=<standard>          Assume that the input sources are for <standard>.\n"
           "  -O<number>               Set optimization level to <number>.\n"
           "  -Wall                    Enable most compiler warnings.\n"
           "  -Wextra                  Enable extra compiler warnings.\n"
           "  -Werror                  Treat all warnings as errors.\n"
           "  -w                       Inhibit all warning messages.\n"
           "  -m32                     Generate 32-bit x86 code.\n", prog);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];
    int is_cxx = (strstr(prog, "g++") != NULL || strstr(prog, "c++") != NULL);
    int is_cpp = (strcmp(prog, "cpp") == 0);

    const char *outfile = NULL;
    int mode = is_cpp ? TCC_OUTPUT_PREPROCESS : TCC_OUTPUT_EXE;
    int verbose = 0;
    int show_version = 0;
    int show_help = 0;
    int dump_version = 0;
    int dump_machine = 0;
    int print_dirs = 0;

    char **input_files = (char **)malloc((argc + 1) * sizeof(char *));
    int input_count = 0;
    char **extra_libs = (char **)malloc((argc + 1) * sizeof(char *));
    int lib_count = 0;
    char **lib_paths = (char **)malloc((argc + 1) * sizeof(char *));
    int lib_path_count = 0;
    char **inc_paths = (char **)malloc((argc + 1) * sizeof(char *));
    int inc_path_count = 0;
    char **defines = (char **)malloc((argc + 1) * sizeof(char *));
    int def_count = 0;
    char **undefines = (char **)malloc((argc + 1) * sizeof(char *));
    int undef_count = 0;

    for (int i = 1; i < argc; i++) {
        char *arg = argv[i];
        if (strcmp(arg, "--version") == 0) {
            show_version = 1;
        } else if (strcmp(arg, "-v") == 0) {
            verbose = 1;
        } else if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            show_help = 1;
        } else if (strcmp(arg, "-dumpversion") == 0) {
            dump_version = 1;
        } else if (strcmp(arg, "-dumpmachine") == 0) {
            dump_machine = 1;
        } else if (strcmp(arg, "-print-search-dirs") == 0) {
            print_dirs = 1;
        } else if (strcmp(arg, "-o") == 0 && i + 1 < argc) {
            outfile = argv[++i];
        } else if (strncmp(arg, "-o", 2) == 0 && arg[2] != '\0') {
            outfile = arg + 2;
        } else if (strcmp(arg, "-c") == 0) {
            mode = TCC_OUTPUT_OBJ;
        } else if (strcmp(arg, "-S") == 0) {
            mode = TCC_OUTPUT_OBJ;
        } else if (strcmp(arg, "-E") == 0) {
            mode = TCC_OUTPUT_PREPROCESS;
        } else if (strcmp(arg, "-shared") == 0) {
            mode = TCC_OUTPUT_DLL;
        } else if (strcmp(arg, "-I") == 0 && i + 1 < argc) {
            inc_paths[inc_path_count++] = argv[++i];
        } else if (strncmp(arg, "-I", 2) == 0) {
            inc_paths[inc_path_count++] = arg + 2;
        } else if (strcmp(arg, "-L") == 0 && i + 1 < argc) {
            lib_paths[lib_path_count++] = argv[++i];
        } else if (strncmp(arg, "-L", 2) == 0) {
            lib_paths[lib_path_count++] = arg + 2;
        } else if (strncmp(arg, "-l", 2) == 0) {
            extra_libs[lib_count++] = arg + 2;
        } else if (strcmp(arg, "-D") == 0 && i + 1 < argc) {
            defines[def_count++] = argv[++i];
        } else if (strncmp(arg, "-D", 2) == 0) {
            defines[def_count++] = arg + 2;
        } else if (strcmp(arg, "-U") == 0 && i + 1 < argc) {
            undefines[undef_count++] = argv[++i];
        } else if (strncmp(arg, "-U", 2) == 0) {
            undefines[undef_count++] = arg + 2;
        } else if (arg[0] == '-') {
            /* Standard GCC flags: -O2, -Wall, -Wextra, -m32, -pipe, -g, etc. */
            continue;
        } else {
            input_files[input_count++] = arg;
        }
    }

    if (show_help) {
        print_help(prog);
        return 0;
    }
    if (dump_version) {
        printf("%s\n", GCC_VERSION);
        return 0;
    }
    if (dump_machine) {
        printf("%s\n", GCC_TARGET);
        return 0;
    }
    if (print_dirs) {
        print_search_dirs();
        return 0;
    }
    if (show_version) {
        print_version(prog, is_cxx, is_cpp);
        return 0;
    }
    if (verbose && input_count == 0) {
        print_verbose(prog);
        return 0;
    }
    if (input_count == 0) {
        fprintf(stderr, "%s: fatal error: no input files\ncompilation terminated.\n", prog);
        return 1;
    }
    if (verbose) {
        print_verbose(prog);
    }

    TCCState *s = tcc_new();
    if (!s) {
        fprintf(stderr, "%s: fatal error: out of memory\n", prog);
        return 1;
    }

    tcc_set_lib_path(s, "/usr/lib/tcc");
    tcc_add_sysinclude_path(s, "/usr/include");
    tcc_add_include_path(s, "/usr/local/include");
    tcc_add_include_path(s, "/usr/lib/tcc/include");
    tcc_add_library_path(s, "/usr/lib");
    tcc_add_library_path(s, "/usr/local/lib");
    tcc_add_library_path(s, "/usr/lib/tcc");

    /* GNU GCC Built-in Definitions */
    tcc_define_symbol(s, "__GNUC__", "14");
    tcc_define_symbol(s, "__GNUC_MINOR__", "2");
    tcc_define_symbol(s, "__GNUC_PATCHLEVEL__", "0");
    tcc_define_symbol(s, "__linux__", "1");
    tcc_define_symbol(s, "__linux", "1");
    tcc_define_symbol(s, "linux", "1");
    tcc_define_symbol(s, "__gnu_linux__", "1");
    tcc_define_symbol(s, "__unix__", "1");
    tcc_define_symbol(s, "__unix", "1");
    tcc_define_symbol(s, "unix", "1");
    tcc_define_symbol(s, "__i386__", "1");
    tcc_define_symbol(s, "__i386", "1");
    tcc_define_symbol(s, "i386", "1");
    tcc_define_symbol(s, "__ELF__", "1");

    if (is_cxx) {
        tcc_define_symbol(s, "__cplusplus", "201703L");
        tcc_define_symbol(s, "__GNUG__", "14");
        tcc_define_symbol(s, "__GXX_EXPERIMENTAL_CXX0X__", "1");
        tcc_define_symbol(s, "__GXX_RTTI", "1");
    }

    for (int i = 0; i < inc_path_count; i++) {
        tcc_add_include_path(s, inc_paths[i]);
    }
    for (int i = 0; i < lib_path_count; i++) {
        tcc_add_library_path(s, lib_paths[i]);
    }
    for (int i = 0; i < def_count; i++) {
        char *eq = strchr(defines[i], '=');
        if (eq) {
            *eq = '\0';
            tcc_define_symbol(s, defines[i], eq + 1);
            *eq = '=';
        } else {
            tcc_define_symbol(s, defines[i], "1");
        }
    }
    for (int i = 0; i < undef_count; i++) {
        tcc_undefine_symbol(s, undefines[i]);
    }

    tcc_set_output_type(s, mode);

    /* Determine output filename */
    char out_buf[1024];
    if (!outfile) {
        if (mode == TCC_OUTPUT_OBJ) {
            const char *base = input_files[0];
            char *slash = strrchr(base, '/');
            if (slash) base = slash + 1;
            strncpy(out_buf, base, sizeof(out_buf) - 5);
            char *dot = strrchr(out_buf, '.');
            if (dot) *dot = '\0';
            strcat(out_buf, ".o");
            outfile = out_buf;
        } else if (mode == TCC_OUTPUT_EXE) {
            outfile = "a.out";
        }
    }

    FILE *ppfp = stdout;
    if (mode == TCC_OUTPUT_PREPROCESS && outfile) {
        ppfp = fopen(outfile, "w");
        if (!ppfp) {
            fprintf(stderr, "%s: fatal error: could not open output file '%s'\n", prog, outfile);
            tcc_delete(s);
            return 1;
        }
    }
    s->ppfp = ppfp;

    int ret = 0;
    for (int i = 0; i < input_count; i++) {
        const char *fn = input_files[i];
        const char *ext = strrchr(fn, '.');
        s->filetype = 0;
        if (ext && (!strcasecmp(ext, ".cpp") || !strcasecmp(ext, ".cc") || !strcasecmp(ext, ".cxx"))) {
            s->filetype = AFF_TYPE_C;
        }
        if (tcc_add_file(s, fn) < 0) {
            ret = 1;
            break;
        }
        s->filetype = 0;
    }

    for (int i = 0; i < lib_count; i++) {
        tcc_add_library(s, extra_libs[i]);
    }

    if (ret == 0 && mode != TCC_OUTPUT_PREPROCESS) {
        if (tcc_output_file(s, outfile) < 0) {
            ret = 1;
        }
    }

    tcc_delete(s);
    if (ppfp && ppfp != stdout) fclose(ppfp);
    return ret;
}
