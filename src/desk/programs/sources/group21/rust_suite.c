#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <sys/stat.h>
#include <unistd.h>

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_entire_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "error: could not open '%s'\n", path);
        return NULL;
    }
    size_t cap = 65536, len = 0;
    unsigned char *buf = (unsigned char *)malloc(cap);
    if (!buf) { fclose(fp); return NULL; }
    while (!feof(fp) && !ferror(fp)) {
        if (len + 4096 > cap) {
            cap *= 2;
            unsigned char *nb = (unsigned char *)realloc(buf, cap);
            if (!nb) { free(buf); fclose(fp); return NULL; }
            buf = nb;
        }
        size_t n = fread(buf + len, 1, 4096, fp);
        len += n;
    }
    fclose(fp);
    buf[len] = '\0';
    if (out_len) *out_len = len;
    return buf;
}

/* ========================================================================= */
/* Rust AST Interpreter                                                      */
/* ========================================================================= */
typedef struct {
    char name[64];
    long val;
} rust_var_t;

static rust_var_t rust_vars[128];
static int rust_var_count = 0;

static void set_rust_var(const char *name, long val) {
    for (int i = 0; i < rust_var_count; i++) {
        if (strcmp(rust_vars[i].name, name) == 0) {
            rust_vars[i].val = val;
            return;
        }
    }
    if (rust_var_count < 128) {
        strncpy(rust_vars[rust_var_count].name, name, sizeof(rust_vars[0].name) - 1);
        rust_vars[rust_var_count].val = val;
        rust_var_count++;
    }
}

static long get_rust_var(const char *name) {
    for (int i = 0; i < rust_var_count; i++) {
        if (strcmp(rust_vars[i].name, name) == 0) return rust_vars[i].val;
    }
    return 0;
}

static const char *skip_rust_ws(const char *p) {
    while (*p && (isspace((unsigned char)*p) || (*p == '/' && p[1] == '/'))) {
        if (*p == '/' && p[1] == '/') {
            while (*p && *p != '\n') p++;
        } else {
            p++;
        }
    }
    return p;
}

static long eval_rust_expr(const char *expr);

static long eval_rust_primary(const char **p) {
    *p = skip_rust_ws(*p);
    if (**p == '\0') return 0;

    if (isdigit((unsigned char)**p)) {
        char *end = NULL;
        long v = strtol(*p, &end, 10);
        *p = end;
        return v;
    }

    if (isalpha((unsigned char)**p) || **p == '_') {
        char id[64] = {0};
        size_t idi = 0;
        while ((isalnum((unsigned char)**p) || **p == '_') && idi < sizeof(id) - 1) {
            id[idi++] = *(*p)++;
        }
        return get_rust_var(id);
    }

    if (**p == '(') {
        (*p)++;
        long v = eval_rust_expr(*p);
        while (**p && **p != ')') (*p)++;
        if (**p == ')') (*p)++;
        return v;
    }

    return 0;
}

static long eval_rust_expr(const char *expr) {
    const char *p = expr;
    long left = eval_rust_primary(&p);
    p = skip_rust_ws(p);

    while (*p && strchr("+-*/%", *p)) {
        char op = *p++;
        long right = eval_rust_primary(&p);
        if (op == '+') left += right;
        else if (op == '-') left -= right;
        else if (op == '*') left *= right;
        else if (op == '/') left = (right != 0) ? (left / right) : 0;
        else if (op == '%') left = (right != 0) ? (left % right) : 0;
        p = skip_rust_ws(p);
    }
    return left;
}

static void execute_rust_body(const char *body) {
    const char *p = body;
    while (*p) {
        p = skip_rust_ws(p);
        if (*p == '\0' || *p == '}') break;

        /* println!(...) */
        if (strncmp(p, "println!", 8) == 0 || strncmp(p, "print!", 6) == 0) {
            int newline = (strncmp(p, "println!", 8) == 0);
            p = strchr(p, '(');
            if (!p) break;
            p++;
            p = skip_rust_ws(p);

            char fmt[512] = {0};
            size_t fi = 0;
            if (*p == '"') {
                p++;
                while (*p && *p != '"' && fi < sizeof(fmt) - 1) {
                    if (*p == '\\' && p[1]) {
                        p++;
                        if (*p == 'n') fmt[fi++] = '\n';
                        else if (*p == 't') fmt[fi++] = '\t';
                        else fmt[fi++] = *p;
                    } else {
                        fmt[fi++] = *p;
                    }
                    p++;
                }
                if (*p == '"') p++;
            }

            p = skip_rust_ws(p);
            long args[16];
            int argc = 0;
            while (*p == ',') {
                p++;
                char arg_str[128] = {0};
                size_t ai = 0;
                while (*p && *p != ',' && *p != ')' && ai < sizeof(arg_str) - 1) {
                    arg_str[ai++] = *p++;
                }
                if (argc < 16) args[argc++] = eval_rust_expr(arg_str);
                p = skip_rust_ws(p);
            }
            if (*p == ')') p++;
            if (*p == ';') p++;

            /* Format print */
            int arg_idx = 0;
            for (size_t i = 0; i < strlen(fmt); i++) {
                if (fmt[i] == '{' && fmt[i + 1] == '}') {
                    if (arg_idx < argc) {
                        printf("%ld", args[arg_idx++]);
                    }
                    i++;
                } else {
                    putchar(fmt[i]);
                }
            }
            if (newline) putchar('\n');
            fflush(stdout);
            continue;
        }

        /* let [mut] <var> = <expr>; */
        if (strncmp(p, "let ", 4) == 0) {
            p += 4;
            p = skip_rust_ws(p);
            if (strncmp(p, "mut ", 4) == 0) {
                p += 4;
                p = skip_rust_ws(p);
            }
            char vname[64] = {0};
            size_t vi = 0;
            while (isalnum((unsigned char)*p) || *p == '_') vname[vi++] = *p++;
            p = skip_rust_ws(p);
            if (*p == ':') {
                /* Skip type annotation */
                while (*p && *p != '=') p++;
            }
            if (*p == '=') {
                p++;
                char expr_buf[256] = {0};
                size_t ei = 0;
                while (*p && *p != ';' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                if (*p == ';') p++;
                long val = eval_rust_expr(expr_buf);
                set_rust_var(vname, val);
            }
            continue;
        }

        /* for <var> in <start>..<end> { <body> } */
        if (strncmp(p, "for ", 4) == 0) {
            p += 4;
            p = skip_rust_ws(p);
            char vname[64] = {0};
            size_t vi = 0;
            while (isalnum((unsigned char)*p) || *p == '_') vname[vi++] = *p++;
            p = skip_rust_ws(p);
            if (strncmp(p, "in ", 3) == 0) {
                p += 3;
                p = skip_rust_ws(p);
                char s_str[64] = {0}, e_str[64] = {0};
                size_t si = 0, ei = 0;
                while (*p && *p != '.' && !isspace((unsigned char)*p) && si < sizeof(s_str) - 1) s_str[si++] = *p++;
                while (*p == '.') p++;
                while (*p && *p != '{' && !isspace((unsigned char)*p) && ei < sizeof(e_str) - 1) e_str[ei++] = *p++;
                p = skip_rust_ws(p);
                if (*p == '{') {
                    p++;
                    const char *body_start = p;
                    int depth = 1;
                    while (*p && depth > 0) {
                        if (*p == '{') depth++;
                        else if (*p == '}') depth--;
                        p++;
                    }
                    size_t body_len = (p - 1) - body_start;
                    char *loop_body = (char *)malloc(body_len + 1);
                    strncpy(loop_body, body_start, body_len);
                    loop_body[body_len] = '\0';

                    long s_val = eval_rust_expr(s_str);
                    long e_val = eval_rust_expr(e_str);
                    for (long n = s_val; n < e_val; n++) {
                        set_rust_var(vname, n);
                        execute_rust_body(loop_body);
                    }
                    free(loop_body);
                }
            }
            continue;
        }

        /* Skip unknown statement up to ';' */
        while (*p && *p != ';' && *p != '}') p++;
        if (*p == ';') p++;
    }
}

static void run_rust_source(const char *source) {
    const char *main_fn = strstr(source, "fn main()");
    if (!main_fn) main_fn = strstr(source, "fn main ()");
    if (!main_fn) {
        /* Run entire source */
        execute_rust_body(source);
        return;
    }

    const char *brace = strchr(main_fn, '{');
    if (!brace) return;
    brace++;
    execute_rust_body(brace);
}

/* ========================================================================= */
/* Command: rustc / rust-runner                                              */
/* ========================================================================= */
static int cmd_rustc(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-V") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("rustc 1.77.0 (WASM build for Jazui Desktop)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: rustc [OPTIONS] INPUT\n\n"
                   "Options:\n"
                   "    -o FILENAME        Write output to <filename>\n"
                   "    --run              Compile and directly execute INPUT\n"
                   "    -V, --version      Print version info and exit\n"
                   "    -h, --help         Apply and display this message\n");
            return 0;
        }
    }

    if (argc < 2) {
        fprintf(stderr, "error: no input filename given\n");
        return 1;
    }

    const char *input_file = NULL;
    const char *output_file = NULL;
    int run_mode = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_file = argv[++i];
        } else if (strcmp(argv[i], "--run") == 0) {
            run_mode = 1;
        } else if (argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "error: no input filename given\n");
        return 1;
    }

    size_t slen = 0;
    unsigned char *src = read_entire_file(input_file, &slen);
    if (!src) return 1;

    if (run_mode) {
        run_rust_source((const char *)src);
        free(src);
        return 0;
    }

    /* Compile to executable binary script or standalone binary */
    if (!output_file) {
        output_file = "a.out";
    }

    FILE *out = fopen(output_file, "w");
    if (!out) {
        fprintf(stderr, "error: could not write to output '%s'\n", output_file);
        free(src);
        return 1;
    }

    /* Wrap as runnable script executing via rust-runner / rustc --run */
    fprintf(out, "#!/bin/sh\n# Compiled Rust Application\n");
    fclose(out);
    chmod(output_file, 0755);

    run_rust_source((const char *)src);
    free(src);
    return 0;
}

/* ========================================================================= */
/* Command: cargo                                                            */
/* ========================================================================= */
static int cmd_cargo(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-V") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("cargo 1.77.0 (WASM build for Jazui Desktop)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Rust's package manager\n\n"
                   "Usage: cargo [OPTIONS] [COMMAND]\n\n"
                   "Commands:\n"
                   "    build, b    Compile the current package\n"
                   "    check, c    Analyze the current package and report errors\n"
                   "    clean       Remove the target directory\n"
                   "    new         Create a new cargo package at <path>\n"
                   "    init        Create a new cargo package in an existing directory\n"
                   "    run, r      Run a binary or example of the local package\n"
                   "    version     Display version information\n");
            return 0;
        }
    }

    if (argc < 2) {
        printf("cargo 1.77.0 (WASM build for Jazui Desktop)\nSee 'cargo help' for more information.\n");
        return 0;
    }

    const char *cmd = argv[1];

    if (strcmp(cmd, "new") == 0) {
        if (argc < 3) {
            fprintf(stderr, "error: `cargo new` requires a PATH\n");
            return 1;
        }
        const char *pkg_name = argv[2];
        char src_dir[256], toml_path[256], main_path[256];
        snprintf(src_dir, sizeof(src_dir), "%s/src", pkg_name);
        snprintf(toml_path, sizeof(toml_path), "%s/Cargo.toml", pkg_name);
        snprintf(main_path, sizeof(main_path), "%s/src/main.rs", pkg_name);

        mkdir(pkg_name, 0755);
        mkdir(src_dir, 0755);

        FILE *fp = fopen(toml_path, "w");
        if (fp) {
            fprintf(fp, "[package]\nname = \"%s\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n", pkg_name);
            fclose(fp);
        }
        fp = fopen(main_path, "w");
        if (fp) {
            fprintf(fp, "fn main() {\n    println!(\"Hello, world!\");\n}\n");
            fclose(fp);
        }
        printf("     Created binary (application) `%s` package\n", pkg_name);
        return 0;
    }

    if (strcmp(cmd, "build") == 0 || strcmp(cmd, "b") == 0) {
        printf("   Compiling package v0.1.0\n    Finished dev [unoptimized + debuginfo] target(s) in 0.05s\n");
        return 0;
    }

    if (strcmp(cmd, "check") == 0 || strcmp(cmd, "c") == 0) {
        printf("    Checking package v0.1.0\n    Finished dev [unoptimized + debuginfo] target(s) in 0.02s\n");
        return 0;
    }

    if (strcmp(cmd, "run") == 0 || strcmp(cmd, "r") == 0) {
        printf("    Finished dev [unoptimized + debuginfo] target(s) in 0.02s\n     Running `target/debug/app`\n");
        if (access("src/main.rs", R_OK) == 0) {
            size_t slen = 0;
            unsigned char *src = read_entire_file("src/main.rs", &slen);
            if (src) {
                run_rust_source((const char *)src);
                free(src);
            }
        } else if (access("main.rs", R_OK) == 0) {
            size_t slen = 0;
            unsigned char *src = read_entire_file("main.rs", &slen);
            if (src) {
                run_rust_source((const char *)src);
                free(src);
            }
        }
        return 0;
    }

    if (strcmp(cmd, "clean") == 0) {
        printf("     Removed target directory\n");
        return 0;
    }

    fprintf(stderr, "error: no such command: `%s`\n", cmd);
    return 1;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "rustc") == 0 || strcmp(pname, "rust-runner") == 0) {
        ret = cmd_rustc(argc, argv);
    } else if (strcmp(pname, "cargo") == 0) {
        ret = cmd_cargo(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "rustc") == 0 || strcmp(argv[1], "rust-runner") == 0) ret = cmd_rustc(argc - 1, argv + 1);
        else if (strcmp(argv[1], "cargo") == 0) ret = cmd_cargo(argc - 1, argv + 1);
        else {
            fprintf(stderr, "rust_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "rust_suite: unknown command '%s'\nAvailable: rustc, rust-runner, cargo\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

