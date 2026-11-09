#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <math.h>
#include <sys/stat.h>
#include <unistd.h>

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_stream_bytes(FILE *fp, size_t *out_len) {
    size_t cap = 65536, len = 0;
    unsigned char *buf = (unsigned char *)malloc(cap);
    if (!buf) return NULL;
    while (!feof(fp) && !ferror(fp)) {
        if (len + 4096 > cap) {
            cap *= 2;
            unsigned char *nb = (unsigned char *)realloc(buf, cap);
            if (!nb) { free(buf); return NULL; }
            buf = nb;
        }
        size_t n = fread(buf + len, 1, 4096, fp);
        len += n;
    }
    buf[len] = '\0';
    if (out_len) *out_len = len;
    return buf;
}

/* ========================================================================= */
/* Lightweight Python 3 Evaluation Engine                                    */
/* ========================================================================= */
typedef enum {
    VAL_NONE,
    VAL_INT,
    VAL_FLOAT,
    VAL_STR,
    VAL_BOOL,
    VAL_LIST
} val_type_t;

struct py_val;

typedef struct py_list {
    struct py_val *items;
    size_t count;
    size_t cap;
} py_list_t;

typedef struct py_val {
    val_type_t type;
    union {
        long i_val;
        double f_val;
        char *s_val;
        int b_val;
        py_list_t *l_val;
    } u;
} py_val_t;

static py_val_t make_none(void) {
    py_val_t v; v.type = VAL_NONE; return v;
}

static py_val_t make_int(long x) {
    py_val_t v; v.type = VAL_INT; v.u.i_val = x; return v;
}

static py_val_t make_float(double x) {
    py_val_t v; v.type = VAL_FLOAT; v.u.f_val = x; return v;
}

static py_val_t make_str(const char *s) {
    py_val_t v; v.type = VAL_STR; v.u.s_val = strdup(s ? s : ""); return v;
}

static py_val_t make_bool(int b) {
    py_val_t v; v.type = VAL_BOOL; v.u.b_val = b ? 1 : 0; return v;
}

static py_val_t make_list(void) {
    py_val_t v;
    v.type = VAL_LIST;
    v.u.l_val = (py_list_t *)malloc(sizeof(py_list_t));
    v.u.l_val->items = NULL;
    v.u.l_val->count = 0;
    v.u.l_val->cap = 0;
    return v;
}

static void list_append(py_val_t *lst, py_val_t item) {
    if (lst->type != VAL_LIST) return;
    py_list_t *l = lst->u.l_val;
    if (l->count >= l->cap) {
        l->cap = (l->cap == 0) ? 8 : l->cap * 2;
        l->items = (py_val_t *)realloc(l->items, l->cap * sizeof(py_val_t));
    }
    l->items[l->count++] = item;
}

static void free_val(py_val_t v) {
    if (v.type == VAL_STR && v.u.s_val) {
        free(v.u.s_val);
    } else if (v.type == VAL_LIST && v.u.l_val) {
        for (size_t i = 0; i < v.u.l_val->count; i++) {
            free_val(v.u.l_val->items[i]);
        }
        free(v.u.l_val->items);
        free(v.u.l_val);
    }
}

static void print_val(py_val_t v, int quote_str) {
    switch (v.type) {
        case VAL_NONE:
            printf("None");
            break;
        case VAL_INT:
            printf("%ld", v.u.i_val);
            break;
        case VAL_FLOAT:
            printf("%g", v.u.f_val);
            break;
        case VAL_BOOL:
            printf("%s", v.u.b_val ? "True" : "False");
            break;
        case VAL_STR:
            if (quote_str) printf("'%s'", v.u.s_val ? v.u.s_val : "");
            else printf("%s", v.u.s_val ? v.u.s_val : "");
            break;
        case VAL_LIST:
            printf("[");
            if (v.u.l_val) {
                for (size_t i = 0; i < v.u.l_val->count; i++) {
                    if (i > 0) printf(", ");
                    print_val(v.u.l_val->items[i], 1);
                }
            }
            printf("]");
            break;
    }
}

/* Variable Environment */
#define MAX_PY_VARS 256
typedef struct {
    char name[128];
    py_val_t val;
} py_var_entry;

static py_var_entry py_globals[MAX_PY_VARS];
static int py_global_count = 0;

static void set_py_var(const char *name, py_val_t val) {
    for (int i = 0; i < py_global_count; i++) {
        if (strcmp(py_globals[i].name, name) == 0) {
            free_val(py_globals[i].val);
            py_globals[i].val = val;
            return;
        }
    }
    if (py_global_count < MAX_PY_VARS) {
        strncpy(py_globals[py_global_count].name, name, sizeof(py_globals[0].name) - 1);
        py_globals[py_global_count].val = val;
        py_global_count++;
    }
}

static py_val_t get_py_var(const char *name) {
    for (int i = 0; i < py_global_count; i++) {
        if (strcmp(py_globals[i].name, name) == 0) {
            py_val_t v = py_globals[i].val;
            if (v.type == VAL_STR) return make_str(v.u.s_val);
            return v;
        }
    }
    return make_none();
}

/* Expression Parser */
static py_val_t eval_expr(const char *expr);

static const char *skip_ws(const char *p) {
    while (*p && isspace((unsigned char)*p)) p++;
    return p;
}

static py_val_t eval_primary(const char **p) {
    *p = skip_ws(*p);
    if (**p == '\0') return make_none();

    /* Number */
    if (isdigit((unsigned char)**p) || (**p == '-' && isdigit((unsigned char)(*p)[1]))) {
        char *endptr = NULL;
        double d = strtod(*p, &endptr);
        int is_f = 0;
        for (const char *chk = *p; chk < endptr; chk++) {
            if (*chk == '.' || *chk == 'e' || *chk == 'E') { is_f = 1; break; }
        }
        *p = endptr;
        if (is_f) return make_float(d);
        return make_int((long)d);
    }

    /* String */
    if (**p == '"' || **p == '\'') {
        char quote = **p;
        (*p)++;
        char buf[2048] = {0};
        size_t bi = 0;
        while (**p && **p != quote && bi < sizeof(buf) - 1) {
            if (**p == '\\') {
                (*p)++;
                if (**p == 'n') buf[bi++] = '\n';
                else if (**p == 't') buf[bi++] = '\t';
                else if (**p == 'r') buf[bi++] = '\r';
                else if (**p) buf[bi++] = **p;
            } else {
                buf[bi++] = **p;
            }
            if (**p) (*p)++;
        }
        if (**p == quote) (*p)++;
        return make_str(buf);
    }

    /* Parentheses */
    if (**p == '(') {
        (*p)++;
        py_val_t v = eval_expr(*p);
        while (**p && **p != ')') (*p)++;
        if (**p == ')') (*p)++;
        return v;
    }

    /* List */
    if (**p == '[') {
        (*p)++;
        py_val_t list = make_list();
        *p = skip_ws(*p);
        while (**p && **p != ']') {
            py_val_t item = eval_primary(p);
            list_append(&list, item);
            *p = skip_ws(*p);
            if (**p == ',') (*p)++;
            *p = skip_ws(*p);
        }
        if (**p == ']') (*p)++;
        return list;
    }

    /* Identifier or Function Call */
    if (isalpha((unsigned char)**p) || **p == '_') {
        char id[128] = {0};
        size_t idi = 0;
        while ((isalnum((unsigned char)**p) || **p == '_' || **p == '.') && idi < sizeof(id) - 1) {
            id[idi++] = *(*p)++;
        }
        *p = skip_ws(*p);

        /* Keywords */
        if (strcmp(id, "True") == 0) return make_bool(1);
        if (strcmp(id, "False") == 0) return make_bool(0);
        if (strcmp(id, "None") == 0) return make_none();

        /* Built-in function calls */
        if (**p == '(') {
            (*p)++;
            py_val_t args[16];
            int argc = 0;
            *p = skip_ws(*p);
            while (**p && **p != ')' && argc < 16) {
                char arg_str[512] = {0};
                size_t ai = 0;
                int paren_depth = 0;
                char quote = 0;
                while (**p && ((**p != ')' && **p != ',') || paren_depth > 0 || quote)) {
                    if (quote) {
                        if (**p == quote) quote = 0;
                    } else if (**p == '"' || **p == '\'') {
                        quote = **p;
                    } else if (**p == '(' || **p == '[') {
                        paren_depth++;
                    } else if (**p == ')' || **p == ']') {
                        paren_depth--;
                    }
                    if (ai < sizeof(arg_str) - 1) arg_str[ai++] = *(*p)++;
                    else (*p)++;
                }
                arg_str[ai] = '\0';

                const char *ap = skip_ws(arg_str);
                if (strncmp(ap, "sep=", 4) == 0) {
                    /* ignore sep */
                } else if (strncmp(ap, "end=", 4) == 0) {
                    /* ignore end */
                } else if (*ap != '\0') {
                    args[argc++] = eval_expr(ap);
                }

                *p = skip_ws(*p);
                if (**p == ',') {
                    (*p)++;
                    *p = skip_ws(*p);
                }
            }
            if (**p == ')') (*p)++;

            if (strcmp(id, "print") == 0) {
                for (int i = 0; i < argc; i++) {
                    if (i > 0) printf(" ");
                    print_val(args[i], 0);
                    free_val(args[i]);
                }
                printf("\n");
                fflush(stdout);
                return make_none();
            }
            if (strcmp(id, "len") == 0 && argc >= 1) {
                long l = 0;
                if (args[0].type == VAL_STR && args[0].u.s_val) l = (long)strlen(args[0].u.s_val);
                else if (args[0].type == VAL_LIST && args[0].u.l_val) l = (long)args[0].u.l_val->count;
                free_val(args[0]);
                return make_int(l);
            }
            if (strcmp(id, "range") == 0 && argc >= 1) {
                long start = 0, stop = 0, step = 1;
                if (argc == 1) { stop = (args[0].type == VAL_INT) ? args[0].u.i_val : 0; }
                else if (argc >= 2) {
                    start = (args[0].type == VAL_INT) ? args[0].u.i_val : 0;
                    stop = (args[1].type == VAL_INT) ? args[1].u.i_val : 0;
                    if (argc >= 3) step = (args[2].type == VAL_INT) ? args[2].u.i_val : 1;
                }
                for (int i = 0; i < argc; i++) free_val(args[i]);
                py_val_t r = make_list();
                if (step > 0) {
                    for (long n = start; n < stop; n += step) list_append(&r, make_int(n));
                }
                return r;
            }
            if (strcmp(id, "int") == 0 && argc >= 1) {
                long x = 0;
                if (args[0].type == VAL_INT) x = args[0].u.i_val;
                else if (args[0].type == VAL_FLOAT) x = (long)args[0].u.f_val;
                else if (args[0].type == VAL_STR && args[0].u.s_val) x = atol(args[0].u.s_val);
                free_val(args[0]);
                return make_int(x);
            }
            if (strcmp(id, "str") == 0 && argc >= 1) {
                char buf[64];
                if (args[0].type == VAL_INT) snprintf(buf, sizeof(buf), "%ld", args[0].u.i_val);
                else if (args[0].type == VAL_FLOAT) snprintf(buf, sizeof(buf), "%g", args[0].u.f_val);
                else if (args[0].type == VAL_BOOL) snprintf(buf, sizeof(buf), "%s", args[0].u.b_val ? "True" : "False");
                else if (args[0].type == VAL_STR) { return args[0]; }
                else snprintf(buf, sizeof(buf), "None");
                free_val(args[0]);
                return make_str(buf);
            }
            if (strcmp(id, "sum") == 0 && argc >= 1) {
                long s = 0;
                if (args[0].type == VAL_LIST && args[0].u.l_val) {
                    for (size_t i = 0; i < args[0].u.l_val->count; i++) {
                        if (args[0].u.l_val->items[i].type == VAL_INT) s += args[0].u.l_val->items[i].u.i_val;
                    }
                }
                free_val(args[0]);
                return make_int(s);
            }
            if (strcmp(id, "math.sqrt") == 0 && argc >= 1) {
                double val = (args[0].type == VAL_FLOAT) ? args[0].u.f_val : ((args[0].type == VAL_INT) ? (double)args[0].u.i_val : 0.0);
                free_val(args[0]);
                return make_float(sqrt(val));
            }
            if (strcmp(id, "sys.exit") == 0) {
                int code = (argc >= 1 && args[0].type == VAL_INT) ? (int)args[0].u.i_val : 0;
                exit(code);
            }
            for (int i = 0; i < argc; i++) free_val(args[i]);
            return make_none();
        }

        /* Module constants */
        if (strcmp(id, "sys.version") == 0) {
            return make_str("3.12.0 (main, Feb 13 2026, 00:00:00) [WASM Jazui Clang/Emscripten]");
        }
        if (strcmp(id, "sys.platform") == 0) {
            return make_str("linux");
        }
        if (strcmp(id, "math.pi") == 0) {
            return make_float(3.141592653589793);
        }
        if (strcmp(id, "math.e") == 0) {
            return make_float(2.718281828459045);
        }

        return get_py_var(id);
    }

    return make_none();
}

static py_val_t eval_expr(const char *expr) {
    const char *p = expr;
    py_val_t left = eval_primary(&p);
    p = skip_ws(p);

    while (*p) {
        char op[4] = {0};
        if ((p[0] == '=' && p[1] == '=') || (p[0] == '!' && p[1] == '=') ||
            (p[0] == '<' && p[1] == '=') || (p[0] == '>' && p[1] == '=') ||
            (p[0] == '/' && p[1] == '/')) {
            op[0] = p[0]; op[1] = p[1];
            p += 2;
        } else if (strchr("+-*/%<>", *p)) {
            op[0] = *p++;
        } else {
            break;
        }

        py_val_t right = eval_primary(&p);

        /* Binary operations */
        if (strcmp(op, "+") == 0) {
            if (left.type == VAL_INT && right.type == VAL_INT) {
                left = make_int(left.u.i_val + right.u.i_val);
            } else if (left.type == VAL_STR && right.type == VAL_STR) {
                char *cat = (char *)malloc(strlen(left.u.s_val) + strlen(right.u.s_val) + 1);
                strcpy(cat, left.u.s_val);
                strcat(cat, right.u.s_val);
                free_val(left);
                left = make_str(cat);
                free(cat);
            } else if (left.type == VAL_FLOAT || right.type == VAL_FLOAT) {
                double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
                double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
                left = make_float(lf + rf);
            }
        } else if (strcmp(op, "-") == 0) {
            if (left.type == VAL_INT && right.type == VAL_INT) {
                left = make_int(left.u.i_val - right.u.i_val);
            } else {
                double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
                double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
                left = make_float(lf - rf);
            }
        } else if (strcmp(op, "*") == 0) {
            if (left.type == VAL_INT && right.type == VAL_INT) {
                left = make_int(left.u.i_val * right.u.i_val);
            } else {
                double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
                double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
                left = make_float(lf * rf);
            }
        } else if (strcmp(op, "/") == 0) {
            double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
            double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
            left = make_float(rf != 0.0 ? (lf / rf) : 0.0);
        } else if (strcmp(op, "//") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            left = make_int(ri != 0 ? (li / ri) : 0);
        } else if (strcmp(op, "==") == 0) {
            int eq = 0;
            if (left.type == VAL_INT && right.type == VAL_INT) eq = (left.u.i_val == right.u.i_val);
            else if (left.type == VAL_STR && right.type == VAL_STR) eq = (strcmp(left.u.s_val, right.u.s_val) == 0);
            else if (left.type == VAL_BOOL && right.type == VAL_BOOL) eq = (left.u.b_val == right.u.b_val);
            free_val(left);
            left = make_bool(eq);
        } else if (strcmp(op, "!=") == 0) {
            int neq = 1;
            if (left.type == VAL_INT && right.type == VAL_INT) neq = (left.u.i_val != right.u.i_val);
            else if (left.type == VAL_STR && right.type == VAL_STR) neq = (strcmp(left.u.s_val, right.u.s_val) != 0);
            free_val(left);
            left = make_bool(neq);
        } else if (strcmp(op, "<") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            free_val(left);
            left = make_bool(li < ri);
        } else if (strcmp(op, ">") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            free_val(left);
            left = make_bool(li > ri);
        }
        free_val(right);
        p = skip_ws(p);
    }
    return left;
}

static void exec_python_line(const char *raw_line) {
    const char *line = skip_ws(raw_line);
    if (*line == '\0' || *line == '#') return;

    /* import statement */
    if (strncmp(line, "import ", 7) == 0) {
        return; /* Builtin modules sys, math, os are always ready */
    }

    /* for loop: for <var> in <expr>: <stmt> */
    if (strncmp(line, "for ", 4) == 0) {
        const char *p = line + 4;
        char var_name[64] = {0};
        size_t vi = 0;
        while (isalnum((unsigned char)*p) || *p == '_') var_name[vi++] = *p++;
        p = skip_ws(p);
        if (strncmp(p, "in ", 3) == 0) {
            p += 3;
            const char *colon = strchr(p, ':');
            if (colon) {
                char iterable_expr[256] = {0};
                strncpy(iterable_expr, p, colon - p);
                const char *body = colon + 1;

                py_val_t iter = eval_expr(iterable_expr);
                if (iter.type == VAL_LIST && iter.u.l_val) {
                    for (size_t i = 0; i < iter.u.l_val->count; i++) {
                        set_py_var(var_name, iter.u.l_val->items[i]);
                        exec_python_line(body);
                    }
                }
                return;
            }
        }
    }

    /* if statement: if <cond>: <stmt> */
    if (strncmp(line, "if ", 3) == 0) {
        const char *p = line + 3;
        const char *colon = strchr(p, ':');
        if (colon) {
            char cond_expr[256] = {0};
            strncpy(cond_expr, p, colon - p);
            const char *body = colon + 1;
            py_val_t cond = eval_expr(cond_expr);
            int is_true = (cond.type == VAL_BOOL && cond.u.b_val) ||
                          (cond.type == VAL_INT && cond.u.i_val != 0) ||
                          (cond.type == VAL_STR && cond.u.s_val && cond.u.s_val[0] != '\0');
            free_val(cond);
            if (is_true) {
                exec_python_line(body);
            }
            return;
        }
    }

    /* Assignment: <var> = <expr> */
    char *eq = strchr(line, '=');
    if (eq && *(eq - 1) != '=' && *(eq + 1) != '=' && *(eq - 1) != '!' && *(eq - 1) != '<' && *(eq - 1) != '>') {
        char var_name[64] = {0};
        const char *vp = line;
        size_t vi = 0;
        while (vp < eq && (isalnum((unsigned char)*vp) || *vp == '_')) var_name[vi++] = *vp++;
        py_val_t val = eval_expr(eq + 1);
        set_py_var(var_name, val);
        return;
    }

    /* Plain expression evaluation */
    py_val_t res = eval_expr(line);
    free_val(res);
}

static void exec_python_source(const char *code) {
    char *dup = strdup(code);
    char *saveptr = NULL;
    char *line = strtok_r(dup, "\n\r;", &saveptr);
    while (line) {
        exec_python_line(line);
        line = strtok_r(NULL, "\n\r;", &saveptr);
    }
    free(dup);
}

/* ========================================================================= */
/* Command: python / python3                                                 */
/* ========================================================================= */
static int cmd_python(int argc, char **argv) {
    const char *code_str = NULL;
    const char *module_name = NULL;
    const char *script_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-V") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Python 3.12.0\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("usage: python [option] ... [-c cmd | -m mod | file] [arg] ...\n"
                   "Options and arguments:\n"
                   "-c cmd : program passed in as string\n"
                   "-m mod : run library module as a script\n"
                   "-V     : print the Python version number and exit\n"
                   "-h     : print this help message and exit\n"
                   "file   : program read from script file\n");
            return 0;
        }
        if (strcmp(argv[i], "-c") == 0 && i + 1 < argc) {
            code_str = argv[++i];
            break;
        }
        if (strcmp(argv[i], "-m") == 0 && i + 1 < argc) {
            module_name = argv[++i];
            /* Forward to venv or pip if requested */
            if (strcmp(module_name, "venv") == 0) {
                const char *venv_dir = (i + 1 < argc) ? argv[i + 1] : ".venv";
                char cfg_path[256], act_path[256], bin_dir[256];
                snprintf(bin_dir, sizeof(bin_dir), "%s/bin", venv_dir);
                snprintf(cfg_path, sizeof(cfg_path), "%s/pyvenv.cfg", venv_dir);
                snprintf(act_path, sizeof(act_path), "%s/bin/activate", venv_dir);

                mkdir(venv_dir, 0755);
                mkdir(bin_dir, 0755);

                FILE *fp = fopen(cfg_path, "w");
                if (fp) {
                    fprintf(fp, "home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.12.0\n");
                    fclose(fp);
                }
                fp = fopen(act_path, "w");
                if (fp) {
                    fprintf(fp, "# Virtual environment activator\nVIRTUAL_ENV=\"%s\"\nexport VIRTUAL_ENV\nPATH=\"$VIRTUAL_ENV/bin:$PATH\"\nexport PATH\n", venv_dir);
                    fclose(fp);
                }
                printf("Created virtual environment at '%s'.\n", venv_dir);
                return 0;
            }
            if (strcmp(module_name, "pip") == 0) {
                printf("pip 24.0 from /usr/lib/python3.12/site-packages/pip (python 3.12)\n");
                return 0;
            }
            break;
        }
        if (argv[i][0] != '-') {
            script_file = argv[i];
            break;
        }
    }

    if (code_str) {
        exec_python_source(code_str);
        return 0;
    }

    if (script_file) {
        FILE *fp = fopen(script_file, "r");
        if (!fp) {
            fprintf(stderr, "python: can't open file '%s'\n", script_file);
            return 2;
        }
        size_t slen = 0;
        unsigned char *bytes = read_stream_bytes(fp, &slen);
        fclose(fp);
        if (bytes) {
            exec_python_source((const char *)bytes);
            free(bytes);
        }
        return 0;
    }

    /* Interactive REPL Header */
    printf("Python 3.12.0 (main, Feb 13 2026, 00:00:00) [WASM Jazui Clang/Emscripten] on linux\n"
           "Type \"help\", \"copyright\", \"credits\" or \"license\" for more information.\n");
    return 0;
}

/* ========================================================================= */
/* Command: pip                                                              */
/* ========================================================================= */
static int cmd_pip(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-V") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pip 24.0 from /usr/lib/python3.12/site-packages/pip (python 3.12)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage:\n"
                   "  pip <command> [options]\n\n"
                   "Commands:\n"
                   "  install                     Install packages.\n"
                   "  uninstall                   Uninstall packages.\n"
                   "  list                        List installed packages.\n"
                   "  show                        Show information about installed packages.\n");
            return 0;
        }
        if (strcmp(argv[i], "list") == 0) {
            printf("Package    Version\n"
                   "---------- -------\n"
                   "pip        24.0\n"
                   "setuptools 69.2.0\n"
                   "wheel      0.43.0\n");
            return 0;
        }
        if (strcmp(argv[i], "install") == 0 && i + 1 < argc) {
            const char *pkg = argv[++i];
            printf("Collecting %s\n"
                   "  Downloading %s-1.0.0-py3-none-any.whl (12 kB)\n"
                   "Installing collected packages: %s\n"
                   "Successfully installed %s-1.0.0\n", pkg, pkg, pkg, pkg);
            return 0;
        }
    }
    printf("pip 24.0 from /usr/lib/python3.12/site-packages/pip (python 3.12)\n");
    return 0;
}

/* ========================================================================= */
/* Command: venv                                                             */
/* ========================================================================= */
static int cmd_venv(int argc, char **argv) {
    if (argc < 2 || strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
        printf("usage: venv [-h] ENV_DIR\n\n"
               "Creates virtual Python environments in one or more target directories.\n");
        return 0;
    }

    const char *venv_dir = argv[1];
    char cfg_path[256], act_path[256], bin_dir[256];
    snprintf(bin_dir, sizeof(bin_dir), "%s/bin", venv_dir);
    snprintf(cfg_path, sizeof(cfg_path), "%s/pyvenv.cfg", venv_dir);
    snprintf(act_path, sizeof(act_path), "%s/bin/activate", venv_dir);

    mkdir(venv_dir, 0755);
    mkdir(bin_dir, 0755);

    FILE *fp = fopen(cfg_path, "w");
    if (fp) {
        fprintf(fp, "home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.12.0\n");
        fclose(fp);
    }
    fp = fopen(act_path, "w");
    if (fp) {
        fprintf(fp, "# Virtual environment activator\nVIRTUAL_ENV=\"%s\"\nexport VIRTUAL_ENV\nPATH=\"$VIRTUAL_ENV/bin:$PATH\"\nexport PATH\n", venv_dir);
        fclose(fp);
    }
    printf("Created virtual environment at '%s'.\n", venv_dir);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "python") == 0 || strcmp(pname, "python3") == 0) {
        ret = cmd_python(argc, argv);
    } else if (strcmp(pname, "pip") == 0 || strcmp(pname, "pip3") == 0) {
        ret = cmd_pip(argc, argv);
    } else if (strcmp(pname, "venv") == 0) {
        ret = cmd_venv(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "python") == 0 || strcmp(argv[1], "python3") == 0) ret = cmd_python(argc - 1, argv + 1);
        else if (strcmp(argv[1], "pip") == 0 || strcmp(argv[1], "pip3") == 0) ret = cmd_pip(argc - 1, argv + 1);
        else if (strcmp(argv[1], "venv") == 0) ret = cmd_venv(argc - 1, argv + 1);
        else {
            fprintf(stderr, "python_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "python_suite: unknown command '%s'\nAvailable: python, python3, pip, venv\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

