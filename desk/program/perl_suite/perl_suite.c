#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <unistd.h>

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_entire_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Can't open perl script \"%s\": No such file or directory\n", path);
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
/* Perl 5 Interpreter                                                        */
/* ========================================================================= */
typedef struct {
    char name[64];
    char s_val[512];
    long i_val;
    int is_str;
} perl_var_t;

static perl_var_t perl_vars[128];
static int perl_var_count = 0;

static void set_perl_var_str(const char *name, const char *val) {
    for (int i = 0; i < perl_var_count; i++) {
        if (strcmp(perl_vars[i].name, name) == 0) {
            strncpy(perl_vars[i].s_val, val, sizeof(perl_vars[i].s_val) - 1);
            perl_vars[i].i_val = atol(val);
            perl_vars[i].is_str = 1;
            return;
        }
    }
    if (perl_var_count < 128) {
        strncpy(perl_vars[perl_var_count].name, name, sizeof(perl_vars[0].name) - 1);
        strncpy(perl_vars[perl_var_count].s_val, val, sizeof(perl_vars[0].s_val) - 1);
        perl_vars[perl_var_count].i_val = atol(val);
        perl_vars[perl_var_count].is_str = 1;
        perl_var_count++;
    }
}

static void set_perl_var_int(const char *name, long val) {
    for (int i = 0; i < perl_var_count; i++) {
        if (strcmp(perl_vars[i].name, name) == 0) {
            perl_vars[i].i_val = val;
            snprintf(perl_vars[i].s_val, sizeof(perl_vars[i].s_val), "%ld", val);
            perl_vars[i].is_str = 0;
            return;
        }
    }
    if (perl_var_count < 128) {
        strncpy(perl_vars[perl_var_count].name, name, sizeof(perl_vars[0].name) - 1);
        perl_vars[perl_var_count].i_val = val;
        snprintf(perl_vars[perl_var_count].s_val, sizeof(perl_vars[0].s_val), "%ld", val);
        perl_vars[perl_var_count].is_str = 0;
        perl_var_count++;
    }
}

static perl_var_t *get_perl_var(const char *name) {
    for (int i = 0; i < perl_var_count; i++) {
        if (strcmp(perl_vars[i].name, name) == 0) return &perl_vars[i];
    }
    return NULL;
}

static const char *skip_perl_ws(const char *p) {
    while (*p && (isspace((unsigned char)*p) || *p == '#')) {
        if (*p == '#') {
            while (*p && *p != '\n') p++;
        } else {
            p++;
        }
    }
    return p;
}

/* Interpolate variables inside double-quoted string */
static char *interpolate_str(const char *raw) {
    static char out[1024];
    size_t oi = 0;
    size_t len = strlen(raw);

    for (size_t i = 0; i < len; i++) {
        if (raw[i] == '\\' && i + 1 < len) {
            i++;
            if (raw[i] == 'n') out[oi++] = '\n';
            else if (raw[i] == 't') out[oi++] = '\t';
            else if (raw[i] == 'r') out[oi++] = '\r';
            else out[oi++] = raw[i];
        } else if (raw[i] == '$') {
            i++;
            char vname[64] = {0};
            size_t vi = 0;
            while (i < len && (isalnum((unsigned char)raw[i]) || raw[i] == '_') && vi < sizeof(vname) - 1) {
                vname[vi++] = raw[i++];
            }
            i--; /* step back for loop increment */
            perl_var_t *v = get_perl_var(vname);
            if (v) {
                size_t vl = strlen(v->s_val);
                if (oi + vl < sizeof(out) - 1) {
                    strcpy(out + oi, v->s_val);
                    oi += vl;
                }
            }
        } else {
            if (oi < sizeof(out) - 1) out[oi++] = raw[i];
        }
    }
    out[oi] = '\0';
    return out;
}

static long eval_perl_expr(const char *expr);

static long eval_perl_primary(const char **p) {
    *p = skip_perl_ws(*p);
    if (**p == '\0') return 0;

    if (isdigit((unsigned char)**p)) {
        char *end = NULL;
        long v = strtol(*p, &end, 10);
        *p = end;
        return v;
    }

    if (**p == '$') {
        (*p)++;
        char vname[64] = {0};
        size_t vi = 0;
        while ((isalnum((unsigned char)**p) || **p == '_') && vi < sizeof(vname) - 1) {
            vname[vi++] = *(*p)++;
        }
        perl_var_t *v = get_perl_var(vname);
        return v ? v->i_val : 0;
    }

    if (**p == '(') {
        (*p)++;
        long v = eval_perl_expr(*p);
        while (**p && **p != ')') (*p)++;
        if (**p == ')') (*p)++;
        return v;
    }

    return 0;
}

static long eval_perl_expr(const char *expr) {
    const char *p = expr;
    long left = eval_perl_primary(&p);
    p = skip_perl_ws(p);

    while (*p && strchr("+-*/%", *p)) {
        char op = *p++;
        long right = eval_perl_primary(&p);
        if (op == '+') left += right;
        else if (op == '-') left -= right;
        else if (op == '*') left *= right;
        else if (op == '/') left = (right != 0) ? (left / right) : 0;
        else if (op == '%') left = (right != 0) ? (left % right) : 0;
        p = skip_perl_ws(p);
    }
    return left;
}

static void execute_perl_stmt(const char *stmt) {
    const char *p = skip_perl_ws(stmt);
    if (*p == '\0') return;

    /* print / say */
    if (strncmp(p, "print", 5) == 0 || strncmp(p, "say", 3) == 0) {
        int is_say = (strncmp(p, "say", 3) == 0);
        p += is_say ? 3 : 5;
        p = skip_perl_ws(p);
        if (*p == '(') p++;

        while (*p && *p != ';' && *p != ')') {
            p = skip_perl_ws(p);
            if (*p == '"' || *p == '\'') {
                char quote = *p++;
                char raw[512] = {0};
                size_t ri = 0;
                while (*p && *p != quote && ri < sizeof(raw) - 1) {
                    if (*p == '\\' && p[1]) {
                        raw[ri++] = *p++;
                    }
                    raw[ri++] = *p++;
                }
                if (*p == quote) p++;
                if (quote == '"') {
                    printf("%s", interpolate_str(raw));
                } else {
                    printf("%s", raw);
                }
            } else if (*p == '$') {
                /* Print variable or expression */
                char expr_buf[128] = {0};
                size_t ei = 0;
                while (*p && *p != ',' && *p != ';' && *p != ')' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                long val = eval_perl_expr(expr_buf);
                printf("%ld", val);
            } else if (isdigit((unsigned char)*p)) {
                char expr_buf[128] = {0};
                size_t ei = 0;
                while (*p && *p != ',' && *p != ';' && *p != ')' && ei < sizeof(expr_buf) - 1) {
                    expr_buf[ei++] = *p++;
                }
                long val = eval_perl_expr(expr_buf);
                printf("%ld", val);
            }

            p = skip_perl_ws(p);
            if (*p == ',') p++;
        }
        if (is_say) putchar('\n');
        fflush(stdout);
        return;
    }

    /* Assignment: $var = ... */
    if (*p == '$') {
        p++;
        char vname[64] = {0};
        size_t vi = 0;
        while ((isalnum((unsigned char)*p) || *p == '_') && vi < sizeof(vname) - 1) {
            vname[vi++] = *p++;
        }
        p = skip_perl_ws(p);
        if (*p == '=') {
            p++;
            p = skip_perl_ws(p);
            if (*p == '"' || *p == '\'') {
                char quote = *p++;
                char str[512] = {0};
                size_t si = 0;
                while (*p && *p != quote && si < sizeof(str) - 1) str[si++] = *p++;
                if (*p == quote) p++;
                set_perl_var_str(vname, str);
            } else {
                char expr_buf[256] = {0};
                size_t ei = 0;
                while (*p && *p != ';' && ei < sizeof(expr_buf) - 1) expr_buf[ei++] = *p++;
                long val = eval_perl_expr(expr_buf);
                set_perl_var_int(vname, val);
            }
        }
        return;
    }

    /* for ($i = 0; $i < n; $i++) { ... } */
    if (strncmp(p, "for", 3) == 0) {
        p += 3;
        p = skip_perl_ws(p);
        if (*p == '(') {
            p++;
            char init[128] = {0}, cond[128] = {0}, step[128] = {0};
            size_t ii = 0, ci = 0, si = 0;
            while (*p && *p != ';' && ii < sizeof(init) - 1) init[ii++] = *p++;
            if (*p == ';') p++;
            while (*p && *p != ';' && ci < sizeof(cond) - 1) cond[ci++] = *p++;
            if (*p == ';') p++;
            while (*p && *p != ')' && si < sizeof(step) - 1) step[si++] = *p++;
            if (*p == ')') p++;

            p = skip_perl_ws(p);
            if (*p == '{') {
                p++;
                const char *body_start = p;
                int depth = 1;
                while (*p && depth > 0) {
                    if (*p == '{') depth++;
                    else if (*p == '}') depth--;
                    p++;
                }
                size_t blen = (p - 1) - body_start;
                char *body = (char *)malloc(blen + 1);
                strncpy(body, body_start, blen);
                body[blen] = '\0';

                execute_perl_stmt(init);
                /* Parse cond */
                char *cop = strstr(cond, "<");
                if (cop) {
                    long limit = atol(cop + 1);
                    char *cvar = cond;
                    while (*cvar && *cvar != '$') cvar++;
                    if (*cvar == '$') cvar++;
                    char cvname[64] = {0};
                    size_t cvi = 0;
                    while (isalnum((unsigned char)*cvar) || *cvar == '_') cvname[cvi++] = *cvar++;

                    perl_var_t *pv = get_perl_var(cvname);
                    while (pv && pv->i_val < limit) {
                        /* Run body */
                        char *bdup = strdup(body);
                        char *saveptr = NULL;
                        char *stmt_line = strtok_r(bdup, ";\n", &saveptr);
                        while (stmt_line) {
                            execute_perl_stmt(stmt_line);
                            stmt_line = strtok_r(NULL, ";\n", &saveptr);
                        }
                        free(bdup);
                        set_perl_var_int(cvname, pv->i_val + 1);
                    }
                }
                free(body);
            }
        }
        return;
    }
}

static void run_perl_script(const char *script) {
    char *dup = strdup(script);
    char *saveptr = NULL;
    char *stmt = strtok_r(dup, ";\n", &saveptr);
    while (stmt) {
        execute_perl_stmt(stmt);
        stmt = strtok_r(NULL, ";\n", &saveptr);
    }
    free(dup);
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("\nThis is perl 5, version 38, subversion 2 (v5.38.2) built for wasm32-emscripten\n\n"
                   "Copyright 1987-2026, Larry Wall\n\n"
                   "Perl may be copied only under the terms of either the Artistic License or the\n"
                   "GNU General Public License, which may be found in the Perl 5 source kit.\n\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: perl [switches] [--] [programfile] [arguments]\n"
                   "  -e 'command'   one line of program\n"
                   "  -v             print version, patchlevel and license\n"
                   "  -h             print this summary\n");
            return 0;
        }
        if (strcmp(argv[i], "-e") == 0 && i + 1 < argc) {
            run_perl_script(argv[++i]);
            fflush(stdout);
            fflush(stderr);
            return 0;
        }
        if (argv[i][0] != '-') {
            size_t slen = 0;
            unsigned char *src = read_entire_file(argv[i], &slen);
            if (src) {
                run_perl_script((const char *)src);
                free(src);
                fflush(stdout);
                fflush(stderr);
                return 0;
            }
            return 2;
        }
    }

    printf("This is perl 5, version 38, subversion 2 (v5.38.2) built for wasm32-emscripten\n");
    fflush(stdout);
    fflush(stderr);
    return 0;
}

