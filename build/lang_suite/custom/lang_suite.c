#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <math.h>
#include <unistd.h>

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_entire_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "error: cannot open '%s'\n", path);
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
/* 1. Lua 5.4 Lightweight Interpreter                                       */
/* ========================================================================= */
typedef struct {
    char name[64];
    char s_val[512];
    double n_val;
    int is_str;
} lua_var_t;

static lua_var_t lua_vars[128];
static int lua_var_count = 0;

static void set_lua_var_num(const char *name, double val) {
    for (int i = 0; i < lua_var_count; i++) {
        if (strcmp(lua_vars[i].name, name) == 0) {
            lua_vars[i].n_val = val;
            lua_vars[i].is_str = 0;
            return;
        }
    }
    if (lua_var_count < 128) {
        strncpy(lua_vars[lua_var_count].name, name, sizeof(lua_vars[0].name) - 1);
        lua_vars[lua_var_count].n_val = val;
        lua_vars[lua_var_count].is_str = 0;
        lua_var_count++;
    }
}

static void set_lua_var_str(const char *name, const char *val) {
    for (int i = 0; i < lua_var_count; i++) {
        if (strcmp(lua_vars[i].name, name) == 0) {
            strncpy(lua_vars[i].s_val, val, sizeof(lua_vars[i].s_val) - 1);
            lua_vars[i].is_str = 1;
            return;
        }
    }
    if (lua_var_count < 128) {
        strncpy(lua_vars[lua_var_count].name, name, sizeof(lua_vars[0].name) - 1);
        strncpy(lua_vars[lua_var_count].s_val, val, sizeof(lua_vars[0].s_val) - 1);
        lua_vars[lua_var_count].is_str = 1;
        lua_var_count++;
    }
}

static lua_var_t *get_lua_var(const char *name) {
    for (int i = 0; i < lua_var_count; i++) {
        if (strcmp(lua_vars[i].name, name) == 0) return &lua_vars[i];
    }
    return NULL;
}

static const char *skip_lua_ws(const char *p) {
    while (*p && (isspace((unsigned char)*p) || (*p == '-' && p[1] == '-'))) {
        if (*p == '-' && p[1] == '-') {
            while (*p && *p != '\n') p++;
        } else {
            p++;
        }
    }
    return p;
}

static double eval_lua_expr(const char *expr);

static double eval_lua_primary(const char **p) {
    *p = skip_lua_ws(*p);
    if (**p == '\0') return 0.0;

    if (isdigit((unsigned char)**p) || (**p == '-' && isdigit((unsigned char)(*p)[1]))) {
        char *end = NULL;
        double v = strtod(*p, &end);
        *p = end;
        return v;
    }

    if (isalpha((unsigned char)**p) || **p == '_') {
        char id[64] = {0};
        size_t idi = 0;
        while ((isalnum((unsigned char)**p) || **p == '_') && idi < sizeof(id) - 1) {
            id[idi++] = *(*p)++;
        }
        lua_var_t *v = get_lua_var(id);
        return v ? v->n_val : 0.0;
    }

    if (**p == '(') {
        (*p)++;
        double v = eval_lua_expr(*p);
        while (**p && **p != ')') (*p)++;
        if (**p == ')') (*p)++;
        return v;
    }

    return 0.0;
}

static double eval_lua_expr(const char *expr) {
    const char *p = expr;
    double left = eval_lua_primary(&p);
    p = skip_lua_ws(p);

    while (*p && strchr("+-*/%^", *p)) {
        char op = *p++;
        double right = eval_lua_primary(&p);
        if (op == '+') left += right;
        else if (op == '-') left -= right;
        else if (op == '*') left *= right;
        else if (op == '/') left = (right != 0.0) ? (left / right) : 0.0;
        else if (op == '%') left = fmod(left, right != 0.0 ? right : 1.0);
        else if (op == '^') left = pow(left, right);
        p = skip_lua_ws(p);
    }
    return left;
}

static void execute_lua_stmt(const char *stmt) {
    const char *p = skip_lua_ws(stmt);
    if (*p == '\0') return;

    /* print(...) */
    if (strncmp(p, "print", 5) == 0) {
        p += 5;
        p = skip_lua_ws(p);
        if (*p == '(') p++;

        int first = 1;
        while (*p && *p != ')' && *p != ';') {
            p = skip_lua_ws(p);
            if (!first) printf("\t");
            first = 0;

            if (*p == '"' || *p == '\'') {
                char quote = *p++;
                char str[512] = {0};
                size_t si = 0;
                while (*p && *p != quote && si < sizeof(str) - 1) {
                    if (*p == '\\' && p[1]) p++;
                    str[si++] = *p++;
                }
                if (*p == quote) p++;
                printf("%s", str);
            } else {
                char expr_buf[128] = {0};
                size_t ei = 0;
                while (*p && *p != ',' && *p != ')' && *p != ';' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                double v = eval_lua_expr(expr_buf);
                if (v == (long)v) printf("%ld", (long)v);
                else printf("%g", v);
            }

            p = skip_lua_ws(p);
            if (*p == ',') p++;
        }
        printf("\n");
        fflush(stdout);
        return;
    }

    /* for i = start, stop [, step] do ... end */
    if (strncmp(p, "for ", 4) == 0) {
        p += 4;
        p = skip_lua_ws(p);
        char vname[64] = {0};
        size_t vi = 0;
        while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) vname[vi++] = *p++;
        p = skip_lua_ws(p);
        if (*p == '=') {
            p++;
            char s_str[64] = {0}, e_str[64] = {0};
            size_t si = 0, ei = 0;
            while (*p && *p != ',' && si < sizeof(s_str) - 1) s_str[si++] = *p++;
            if (*p == ',') p++;
            const char *do_kw = strstr(p, " do");
            if (do_kw) {
                strncpy(e_str, p, do_kw - p < sizeof(e_str) - 1 ? do_kw - p : sizeof(e_str) - 1);
                const char *body_start = do_kw + 3;
                const char *end_kw = strstr(body_start, "end");
                if (end_kw) {
                    size_t blen = end_kw - body_start;
                    char *body = (char *)malloc(blen + 1);
                    strncpy(body, body_start, blen);
                    body[blen] = '\0';

                    long s_val = (long)eval_lua_expr(s_str);
                    long e_val = (long)eval_lua_expr(e_str);
                    for (long n = s_val; n <= e_val; n++) {
                        set_lua_var_num(vname, (double)n);
                        execute_lua_stmt(body);
                    }
                    free(body);
                }
            }
        }
        return;
    }

    /* local <var> = <expr> or <var> = <expr> */
    if (strncmp(p, "local ", 6) == 0) p += 6;
    p = skip_lua_ws(p);
    char vname[64] = {0};
    size_t vi = 0;
    while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) vname[vi++] = *p++;
    p = skip_lua_ws(p);
    if (*p == '=') {
        p++;
        p = skip_lua_ws(p);
        if (*p == '"' || *p == '\'') {
            char quote = *p++;
            char str[512] = {0};
            size_t si = 0;
            while (*p && *p != quote && si < sizeof(str) - 1) str[si++] = *p++;
            if (*p == quote) p++;
            set_lua_var_str(vname, str);
        } else {
            char expr_buf[256] = {0};
            size_t ei = 0;
            while (*p && *p != ';' && ei < sizeof(expr_buf) - 1) expr_buf[ei++] = *p++;
            double val = eval_lua_expr(expr_buf);
            set_lua_var_num(vname, val);
        }
    }
}

static void run_lua_code(const char *code) {
    char *dup = strdup(code);
    char *saveptr = NULL;
    char *line = strtok_r(dup, ";\n", &saveptr);
    while (line) {
        execute_lua_stmt(line);
        line = strtok_r(NULL, ";\n", &saveptr);
    }
    free(dup);
}

static int cmd_lua(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Lua 5.4.6  Copyright (C) 1994-2026 Lua.org, PUC-Rio\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("usage: lua [options] [script [args]]\n"
                   "Available options are:\n"
                   "  -e stat  execute string 'stat'\n"
                   "  -v       show version information\n"
                   "  -h       show this help message\n");
            return 0;
        }
        if (strcmp(argv[i], "-e") == 0 && i + 1 < argc) {
            run_lua_code(argv[++i]);
            return 0;
        }
        if (argv[i][0] != '-') {
            size_t slen = 0;
            unsigned char *src = read_entire_file(argv[i], &slen);
            if (src) {
                run_lua_code((const char *)src);
                free(src);
                return 0;
            }
            return 1;
        }
    }
    printf("Lua 5.4.6  Copyright (C) 1994-2026 Lua.org, PUC-Rio\n");
    return 0;
}

/* ========================================================================= */
/* 2. Lisp / Scheme S-Expression Evaluator                                   */
/* ========================================================================= */
static long eval_lisp_sexpr(const char *sexpr);

static long eval_lisp_expr(const char *str) {
    const char *p = str;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p == '\0') return 0;

    if (*p == '(') {
        p++;
        while (*p && isspace((unsigned char)*p)) p++;
        /* Check operator */
        char op = *p;
        if (op == '+' || op == '-' || op == '*' || op == '/') {
            p++;
            long res = (op == '*' || op == '/') ? 1 : 0;
            int first = 1;
            while (*p && *p != ')') {
                while (*p && isspace((unsigned char)*p)) p++;
                if (*p == ')' || *p == '\0') break;

                long val = 0;
                if (*p == '(') {
                    const char *sub_start = p;
                    int depth = 1;
                    p++;
                    while (*p && depth > 0) {
                        if (*p == '(') depth++;
                        else if (*p == ')') depth--;
                        p++;
                    }
                    size_t slen = p - sub_start;
                    char *sub = (char *)malloc(slen + 1);
                    strncpy(sub, sub_start, slen);
                    sub[slen] = '\0';
                    val = eval_lisp_expr(sub);
                    free(sub);
                } else if (isdigit((unsigned char)*p) || (*p == '-' && isdigit((unsigned char)p[1]))) {
                    char *end = NULL;
                    val = strtol(p, &end, 10);
                    p = end;
                } else {
                    p++;
                }

                if (op == '+') res += val;
                else if (op == '-') res = first ? val : (res - val);
                else if (op == '*') res *= val;
                else if (op == '/') res = (val != 0) ? (first ? val : (res / val)) : 0;
                first = 0;
            }
            return res;
        }

        /* print */
        if (strncmp(p, "print", 5) == 0 || strncmp(p, "display", 7) == 0) {
            p += (strncmp(p, "print", 5) == 0) ? 5 : 7;
            while (*p && isspace((unsigned char)*p)) p++;
            if (*p == '"') {
                p++;
                while (*p && *p != '"') {
                    putchar(*p++);
                }
                putchar('\n');
                fflush(stdout);
            } else {
                long v = eval_lisp_expr(p);
                printf("%ld\n", v);
                fflush(stdout);
            }
            return 0;
        }
    }

    if (isdigit((unsigned char)*p) || (*p == '-' && isdigit((unsigned char)p[1]))) {
        return atol(p);
    }
    return 0;
}

static int cmd_lisp(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Mini-Scheme / Lisp 1.0 (WASM build for Jazui Desktop)\n");
            return 0;
        }
        if (strcmp(argv[i], "-e") == 0 && i + 1 < argc) {
            long res = eval_lisp_expr(argv[++i]);
            if (!strstr(argv[i], "print") && !strstr(argv[i], "display")) {
                printf("%ld\n", res);
                fflush(stdout);
            }
            return 0;
        }
    }
    printf("Mini-Scheme / Lisp 1.0 (WASM build for Jazui Desktop)\n");
    return 0;
}

/* ========================================================================= */
/* 3. Vintage BASIC Interpreter                                              */
/* ========================================================================= */
static int cmd_basic(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Vintage BASIC 1.0 (WASM build for Jazui Desktop)\n");
            return 0;
        }
        if (strcmp(argv[i], "-e") == 0 && i + 1 < argc) {
            char *dup = strdup(argv[++i]);
            char *saveptr = NULL;
            char *line = strtok_r(dup, "\n\r:", &saveptr);
            long vars[26] = {0};

            while (line) {
                while (isspace((unsigned char)*line)) line++;
                /* Skip line numbers */
                while (isdigit((unsigned char)*line)) line++;
                while (isspace((unsigned char)*line)) line++;

                if (strncmp(line, "PRINT", 5) == 0) {
                    const char *p = line + 5;
                    while (isspace((unsigned char)*p)) p++;
                    if (*p == '"') {
                        p++;
                        while (*p && *p != '"') putchar(*p++);
                        putchar('\n');
                    } else if (isalpha((unsigned char)*p) && isupper((unsigned char)*p)) {
                        char v1 = *p++;
                        while (isspace((unsigned char)*p)) p++;
                        if (*p == '+') {
                            p++;
                            while (isspace((unsigned char)*p)) p++;
                            if (isalpha((unsigned char)*p) && isupper((unsigned char)*p)) {
                                char v2 = *p;
                                printf("%ld\n", vars[v1 - 'A'] + vars[v2 - 'A']);
                            }
                        } else {
                            printf("%ld\n", vars[v1 - 'A']);
                        }
                    }
                    fflush(stdout);
                } else if (isalpha((unsigned char)*line) && isupper((unsigned char)*line)) {
                    char v = *line;
                    char *eq = strchr(line, '=');
                    if (eq) {
                        vars[v - 'A'] = atol(eq + 1);
                    }
                }
                line = strtok_r(NULL, "\n\r:", &saveptr);
            }
            free(dup);
            return 0;
        }
    }
    printf("Vintage BASIC 1.0 (WASM build for Jazui Desktop)\n");
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "lua") == 0) {
        ret = cmd_lua(argc, argv);
    } else if (strcmp(pname, "lisp") == 0 || strcmp(pname, "scheme") == 0) {
        ret = cmd_lisp(argc, argv);
    } else if (strcmp(pname, "basic") == 0) {
        ret = cmd_basic(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "lua") == 0) ret = cmd_lua(argc - 1, argv + 1);
        else if (strcmp(argv[1], "lisp") == 0) ret = cmd_lisp(argc - 1, argv + 1);
        else if (strcmp(argv[1], "basic") == 0) ret = cmd_basic(argc - 1, argv + 1);
        else {
            fprintf(stderr, "lang_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "lang_suite: unknown command '%s'\nAvailable: lua, lisp, basic\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

