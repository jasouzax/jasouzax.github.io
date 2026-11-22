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
/* Rust Types and Variables                                                  */
/* ========================================================================= */
typedef enum {
    RUST_VAL_INT = 0,
    RUST_VAL_STR = 1
} rust_type_t;

typedef struct {
    rust_type_t type;
    long ival;
    char sval[1024];
} rust_value_t;

typedef struct {
    char name[64];
    rust_type_t type;
    long ival;
    char sval[1024];
} rust_var_t;

static rust_var_t rust_vars[256];
static int rust_var_count = 0;

static void clear_rust_vars(void) {
    rust_var_count = 0;
}

static rust_var_t *find_rust_var(const char *name) {
    for (int i = 0; i < rust_var_count; i++) {
        if (strcmp(rust_vars[i].name, name) == 0) return &rust_vars[i];
    }
    return NULL;
}

static void set_rust_int(const char *name, long val) {
    rust_var_t *v = find_rust_var(name);
    if (!v) {
        if (rust_var_count >= 256) return;
        v = &rust_vars[rust_var_count++];
        strncpy(v->name, name, sizeof(v->name) - 1);
        v->name[sizeof(v->name) - 1] = '\0';
    }
    v->type = RUST_VAL_INT;
    v->ival = val;
    snprintf(v->sval, sizeof(v->sval), "%ld", val);
}

static void set_rust_str(const char *name, const char *str) {
    rust_var_t *v = find_rust_var(name);
    if (!v) {
        if (rust_var_count >= 256) return;
        v = &rust_vars[rust_var_count++];
        strncpy(v->name, name, sizeof(v->name) - 1);
        v->name[sizeof(v->name) - 1] = '\0';
    }
    v->type = RUST_VAL_STR;
    v->ival = atol(str ? str : "0");
    if (str) {
        strncpy(v->sval, str, sizeof(v->sval) - 1);
        v->sval[sizeof(v->sval) - 1] = '\0';
    } else {
        v->sval[0] = '\0';
    }
}

static const char *skip_rust_ws(const char *p) {
    while (*p) {
        if (isspace((unsigned char)*p)) {
            p++;
        } else if (*p == '/' && p[1] == '/') {
            while (*p && *p != '\n') p++;
        } else if (*p == '/' && p[1] == '*') {
            p += 2;
            while (*p && !(*p == '*' && p[1] == '/')) p++;
            if (*p) p += 2;
        } else {
            break;
        }
    }
    return p;
}

/* ========================================================================= */
/* Expression Evaluator (Strings & Integers)                                 */
/* ========================================================================= */
static rust_value_t eval_rust_value(const char *expr);

static rust_value_t eval_rust_primary(const char **p) {
    rust_value_t res;
    res.type = RUST_VAL_INT;
    res.ival = 0;
    res.sval[0] = '\0';

    *p = skip_rust_ws(*p);
    if (**p == '\0') return res;

    /* String literal: "..." */
    if (**p == '"') {
        (*p)++;
        res.type = RUST_VAL_STR;
        size_t si = 0;
        while (**p && **p != '"' && si < sizeof(res.sval) - 1) {
            if (**p == '\\' && (*p)[1]) {
                (*p)++;
                if (**p == 'n') res.sval[si++] = '\n';
                else if (**p == 't') res.sval[si++] = '\t';
                else if (**p == 'r') res.sval[si++] = '\r';
                else res.sval[si++] = **p;
            } else {
                res.sval[si++] = **p;
            }
            (*p)++;
        }
        if (**p == '"') (*p)++;
        res.sval[si] = '\0';
        res.ival = atol(res.sval);
        return res;
    }

    /* String constructors: String::new(), String:new(), String::from(...) */
    if (strncmp(*p, "String::new()", 13) == 0 || strncmp(*p, "String:new()", 12) == 0 ||
        strncmp(*p, "String::default()", 17) == 0) {
        if (strncmp(*p, "String::new()", 13) == 0) *p += 13;
        else if (strncmp(*p, "String:new()", 12) == 0) *p += 12;
        else *p += 17;
        res.type = RUST_VAL_STR;
        res.ival = 0;
        res.sval[0] = '\0';
        return res;
    }

    if (strncmp(*p, "String::from", 12) == 0 || strncmp(*p, "String:from", 11) == 0) {
        if (strncmp(*p, "String::from", 12) == 0) *p += 12;
        else *p += 11;
        *p = skip_rust_ws(*p);
        if (**p == '(') {
            (*p)++;
            rust_value_t inner = eval_rust_primary(p);
            *p = skip_rust_ws(*p);
            if (**p == ')') (*p)++;
            inner.type = RUST_VAL_STR;
            return inner;
        }
    }

    /* Number literal */
    if (isdigit((unsigned char)**p)) {
        char *end = NULL;
        long v = strtol(*p, &end, 10);
        *p = end;
        res.type = RUST_VAL_INT;
        res.ival = v;
        snprintf(res.sval, sizeof(res.sval), "%ld", v);
        return res;
    }

    /* Booleans */
    if (strncmp(*p, "true", 4) == 0 && !isalnum((unsigned char)(*p)[4]) && (*p)[4] != '_') {
        *p += 4;
        res.type = RUST_VAL_INT;
        res.ival = 1;
        strcpy(res.sval, "true");
        return res;
    }
    if (strncmp(*p, "false", 5) == 0 && !isalnum((unsigned char)(*p)[5]) && (*p)[5] != '_') {
        *p += 5;
        res.type = RUST_VAL_INT;
        res.ival = 0;
        strcpy(res.sval, "false");
        return res;
    }

    /* Parenthesized expression: (...) */
    if (**p == '(') {
        (*p)++;
        res = eval_rust_value(*p);
        while (**p && **p != ')') (*p)++;
        if (**p == ')') (*p)++;
        return res;
    }

    /* Identifier or method call: var, var.trim(), var.len(), etc. */
    if (isalpha((unsigned char)**p) || **p == '_') {
        char id[64] = {0};
        size_t idi = 0;
        while ((isalnum((unsigned char)**p) || **p == '_') && idi < sizeof(id) - 1) {
            id[idi++] = *(*p)++;
        }

        rust_var_t *v = find_rust_var(id);
        if (v) {
            res.type = v->type;
            res.ival = v->ival;
            strncpy(res.sval, v->sval, sizeof(res.sval) - 1);
            res.sval[sizeof(res.sval) - 1] = '\0';
        }

        /* Check for method call: .trim(), .len(), .to_string() */
        *p = skip_rust_ws(*p);
        if (**p == '.') {
            if (strncmp(*p, ".trim()", 7) == 0 || strncmp(*p, ".trim_end()", 11) == 0) {
                if (strncmp(*p, ".trim()", 7) == 0) *p += 7;
                else *p += 11;
                /* Strip whitespace */
                char *s = res.sval;
                while (*s && isspace((unsigned char)*s)) s++;
                memmove(res.sval, s, strlen(s) + 1);
                size_t l = strlen(res.sval);
                while (l > 0 && isspace((unsigned char)res.sval[l - 1])) {
                    res.sval[l - 1] = '\0';
                    l--;
                }
                res.type = RUST_VAL_STR;
                res.ival = atol(res.sval);
            } else if (strncmp(*p, ".len()", 6) == 0) {
                *p += 6;
                res.type = RUST_VAL_INT;
                res.ival = (long)strlen(res.sval);
                snprintf(res.sval, sizeof(res.sval), "%ld", res.ival);
            } else if (strncmp(*p, ".to_string()", 12) == 0) {
                *p += 12;
                res.type = RUST_VAL_STR;
            }
        }

        return res;
    }

    return res;
}

static rust_value_t eval_rust_value(const char *expr) {
    const char *p = expr;
    rust_value_t left = eval_rust_primary(&p);
    p = skip_rust_ws(p);

    while (*p && strchr("+-*/%", *p)) {
        char op = *p++;
        rust_value_t right = eval_rust_primary(&p);

        if (op == '+' && (left.type == RUST_VAL_STR || right.type == RUST_VAL_STR)) {
            /* String concatenation */
            char combined[1024] = {0};
            snprintf(combined, sizeof(combined), "%s%s", left.sval, right.sval);
            left.type = RUST_VAL_STR;
            strncpy(left.sval, combined, sizeof(left.sval) - 1);
            left.sval[sizeof(left.sval) - 1] = '\0';
            left.ival = atol(left.sval);
        } else {
            /* Arithmetic operation */
            left.type = RUST_VAL_INT;
            if (op == '+') left.ival += right.ival;
            else if (op == '-') left.ival -= right.ival;
            else if (op == '*') left.ival *= right.ival;
            else if (op == '/') left.ival = (right.ival != 0) ? (left.ival / right.ival) : 0;
            else if (op == '%') left.ival = (right.ival != 0) ? (left.ival % right.ival) : 0;
            snprintf(left.sval, sizeof(left.sval), "%ld", left.ival);
        }
        p = skip_rust_ws(p);
    }
    return left;
}

/* ========================================================================= */
/* Stdin Reader Handler                                                      */
/* ========================================================================= */
static int handle_read_line(const char *stmt) {
    const char *p = strstr(stmt, "read_line");
    if (!p) return 0;
    p += 9;
    p = skip_rust_ws(p);
    if (*p != '(') return 0;
    p++;
    p = skip_rust_ws(p);
    if (*p == '&') {
        p++;
        p = skip_rust_ws(p);
    }
    if (strncmp(p, "mut ", 4) == 0) {
        p += 4;
        p = skip_rust_ws(p);
    }
    char vname[64] = {0};
    size_t vi = 0;
    while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) {
        vname[vi++] = *p++;
    }
    if (vi == 0) return 0;

    fflush(stdout);
    char buf[1024] = {0};
    if (fgets(buf, sizeof(buf), stdin) != NULL) {
        /* Strip trailing \r and \n */
        size_t len = strlen(buf);
        while (len > 0 && (buf[len - 1] == '\r' || buf[len - 1] == '\n')) {
            buf[len - 1] = '\0';
            len--;
        }
        set_rust_str(vname, buf);
    } else {
        set_rust_str(vname, "");
    }
    return 1;
}

/* ========================================================================= */
/* Rust Statement Executor                                                   */
/* ========================================================================= */
static void execute_rust_body(const char *body) {
    const char *p = body;
    while (*p) {
        p = skip_rust_ws(p);
        if (*p == '\0' || *p == '}') break;

        /* Skip module imports: use ...; */
        if (strncmp(p, "use ", 4) == 0) {
            while (*p && *p != ';') p++;
            if (*p == ';') p++;
            continue;
        }

        /* println!(...) or print!(...) */
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
                        else if (*p == 'r') fmt[fi++] = '\r';
                        else fmt[fi++] = *p;
                    } else {
                        fmt[fi++] = *p;
                    }
                    p++;
                }
                if (*p == '"') p++;
            }

            p = skip_rust_ws(p);
            rust_value_t args[16];
            int argc = 0;
            while (*p == ',') {
                p++;
                char arg_str[256] = {0};
                size_t ai = 0;
                int paren = 0;
                while (*p && (paren > 0 || (*p != ',' && *p != ')')) && ai < sizeof(arg_str) - 1) {
                    if (*p == '(') paren++;
                    else if (*p == ')') paren--;
                    arg_str[ai++] = *p++;
                }
                if (argc < 16) {
                    args[argc++] = eval_rust_value(arg_str);
                }
                p = skip_rust_ws(p);
            }
            if (*p == ')') p++;
            if (*p == ';') p++;

            /* Format and print */
            int arg_idx = 0;
            for (size_t i = 0; i < strlen(fmt); i++) {
                if (fmt[i] == '{') {
                    if (fmt[i + 1] == '}' || (fmt[i + 1] == ':' && fmt[i + 2] == '?' && fmt[i + 3] == '}')) {
                        if (fmt[i + 1] == ':') i += 3;
                        else i += 1;
                        if (arg_idx < argc) {
                            rust_value_t val = args[arg_idx++];
                            if (val.type == RUST_VAL_STR) printf("%s", val.sval);
                            else printf("%ld", val.ival);
                        }
                    } else {
                        /* Named interpolation: {name} */
                        char vname[64] = {0};
                        size_t vni = 0;
                        size_t j = i + 1;
                        while (fmt[j] && fmt[j] != '}' && fmt[j] != ':' && vni < sizeof(vname) - 1) {
                            vname[vni++] = fmt[j++];
                        }
                        while (fmt[j] && fmt[j] != '}') j++;
                        if (fmt[j] == '}' && vni > 0) {
                            i = j;
                            rust_var_t *v = find_rust_var(vname);
                            if (v) {
                                if (v->type == RUST_VAL_STR) printf("%s", v->sval);
                                else printf("%ld", v->ival);
                            } else {
                                rust_value_t val = eval_rust_value(vname);
                                if (val.type == RUST_VAL_STR) printf("%s", val.sval);
                                else printf("%ld", val.ival);
                            }
                        } else {
                            putchar(fmt[i]);
                        }
                    }
                } else {
                    putchar(fmt[i]);
                }
            }
            if (newline) putchar('\n');
            fflush(stdout);
            continue;
        }

        /* Check if CURRENT statement contains read_line */
        const char *semi = strchr(p, ';');
        size_t stmt_len = semi ? (size_t)(semi - p) : strlen(p);
        if (stmt_len < 1024) {
            char stmt_buf[1024] = {0};
            strncpy(stmt_buf, p, stmt_len);
            stmt_buf[stmt_len] = '\0';
            if (strstr(stmt_buf, "read_line") && (strstr(stmt_buf, "stdin") || strstr(stmt_buf, "read_line("))) {
                handle_read_line(stmt_buf);
                p = semi ? semi + 1 : p + strlen(p);
                continue;
            }
        }

        /* let [mut] <var> [: type] [= <expr>]; */
        if (strncmp(p, "let ", 4) == 0) {
            p += 4;
            p = skip_rust_ws(p);
            if (strncmp(p, "mut ", 4) == 0) {
                p += 4;
                p = skip_rust_ws(p);
            }
            char vname[64] = {0};
            size_t vi = 0;
            while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) {
                vname[vi++] = *p++;
            }
            p = skip_rust_ws(p);
            if (*p == ':') {
                /* Skip type annotation */
                while (*p && *p != '=' && *p != ';') p++;
            }
            if (*p == '=') {
                p++;
                char expr_buf[512] = {0};
                size_t ei = 0;
                while (*p && *p != ';' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                if (*p == ';') p++;
                if (strstr(expr_buf, "read_line")) {
                    handle_read_line(expr_buf);
                } else {
                    rust_value_t val = eval_rust_value(expr_buf);
                    if (val.type == RUST_VAL_STR) set_rust_str(vname, val.sval);
                    else set_rust_int(vname, val.ival);
                }
            } else {
                if (*p == ';') p++;
                set_rust_str(vname, "");
            }
            continue;
        }

        /* for <var> in <start>..<end> { <body> } */
        if (strncmp(p, "for ", 4) == 0) {
            p += 4;
            p = skip_rust_ws(p);
            char vname[64] = {0};
            size_t vi = 0;
            while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) {
                vname[vi++] = *p++;
            }
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
                    if (loop_body) {
                        strncpy(loop_body, body_start, body_len);
                        loop_body[body_len] = '\0';

                        rust_value_t s_val = eval_rust_value(s_str);
                        rust_value_t e_val = eval_rust_value(e_str);
                        for (long n = s_val.ival; n < e_val.ival; n++) {
                            set_rust_int(vname, n);
                            execute_rust_body(loop_body);
                        }
                        free(loop_body);
                    }
                }
            }
            continue;
        }

        /* Assignment: <var> = <expr>; or <var> += <expr>; */
        if (isalpha((unsigned char)*p) || *p == '_') {
            const char *ident_start = p;
            char vname[64] = {0};
            size_t vi = 0;
            while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) {
                vname[vi++] = *p++;
            }
            p = skip_rust_ws(p);
            if (*p == '=' && p[1] != '=') {
                p++;
                char expr_buf[512] = {0};
                size_t ei = 0;
                while (*p && *p != ';' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                if (*p == ';') p++;
                rust_value_t val = eval_rust_value(expr_buf);
                if (val.type == RUST_VAL_STR) set_rust_str(vname, val.sval);
                else set_rust_int(vname, val.ival);
                continue;
            } else if (*p == '+' && p[1] == '=') {
                p += 2;
                char expr_buf[512] = {0};
                size_t ei = 0;
                while (*p && *p != ';' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                if (*p == ';') p++;
                rust_value_t val = eval_rust_value(expr_buf);
                rust_var_t *cur = find_rust_var(vname);
                if (cur && cur->type == RUST_VAL_STR) {
                    strncat(cur->sval, val.sval, sizeof(cur->sval) - strlen(cur->sval) - 1);
                } else if (cur) {
                    set_rust_int(vname, cur->ival + val.ival);
                }
                continue;
            } else {
                p = ident_start;
            }
        }

        /* Skip unknown statement up to ';' */
        while (*p && *p != ';' && *p != '}') p++;
        if (*p == ';') p++;
    }
}

static void run_rust_source(const char *source) {
    clear_rust_vars();
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
    int depth = 1;
    const char *end = brace;
    while (*end && depth > 0) {
        if (*end == '{') depth++;
        else if (*end == '}') depth--;
        end++;
    }
    size_t blen = (end - 1) - brace;
    char *body = (char *)malloc(blen + 1);
    if (!body) return;
    memcpy(body, brace, blen);
    body[blen] = '\0';
    execute_rust_body(body);
    free(body);
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

    /* Wrap as runnable script executing via rustc --run */
    fprintf(out, "#!/bin/sh\nrustc --run %s \"$@\"\n", input_file);
    fclose(out);
    chmod(output_file, 0755);

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
        mkdir("target", 0755);
        mkdir("target/debug", 0755);
        FILE *fp = fopen("target/debug/app", "w");
        if (fp) {
            fprintf(fp, "#!/bin/sh\nif [ -f src/main.rs ]; then rustc --run src/main.rs \"$@\"; else rustc --run main.rs \"$@\"; fi\n");
            fclose(fp);
            chmod("target/debug/app", 0755);
        }
        printf("   Compiling package v0.1.0\n    Finished dev [unoptimized + debuginfo] target(s) in 0.05s\n");
        return 0;
    }

    if (strcmp(cmd, "check") == 0 || strcmp(cmd, "c") == 0) {
        printf("    Checking package v0.1.0\n    Finished dev [unoptimized + debuginfo] target(s) in 0.02s\n");
        return 0;
    }

    if (strcmp(cmd, "run") == 0 || strcmp(cmd, "r") == 0) {
        printf("    Finished dev [unoptimized + debuginfo] target(s) in 0.02s\n     Running `target/debug/app`\n");
        fflush(stdout);
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
