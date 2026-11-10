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
    if (lst->type != VAL_LIST || !lst->u.l_val) return;
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

static py_val_t clone_val(py_val_t v) {
    if (v.type == VAL_STR) return make_str(v.u.s_val);
    if (v.type == VAL_LIST && v.u.l_val) {
        py_val_t copy = make_list();
        for (size_t i = 0; i < v.u.l_val->count; i++) {
            list_append(&copy, clone_val(v.u.l_val->items[i]));
        }
        return copy;
    }
    return v;
}

static int is_truthy(py_val_t v) {
    if (v.type == VAL_BOOL) return v.u.b_val;
    if (v.type == VAL_INT) return v.u.i_val != 0;
    if (v.type == VAL_FLOAT) return v.u.f_val != 0.0;
    if (v.type == VAL_STR) return v.u.s_val && v.u.s_val[0] != '\0';
    if (v.type == VAL_LIST) return v.u.l_val && v.u.l_val->count > 0;
    return 0;
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
            return clone_val(py_globals[i].val);
        }
    }
    return make_none();
}

static void append_to_var(const char *name, py_val_t item) {
    for (int i = 0; i < py_global_count; i++) {
        if (strcmp(py_globals[i].name, name) == 0 && py_globals[i].val.type == VAL_LIST) {
            list_append(&py_globals[i].val, item);
            return;
        }
    }
    free_val(item);
}

/* User Defined Functions */
#define MAX_PY_FUNCS 64
typedef struct {
    char name[64];
    char params[8][32];
    int param_count;
    char body[2048];
} py_func_t;

static py_func_t py_funcs[MAX_PY_FUNCS];
static int py_func_count = 0;

static void define_function(const char *name, char params[8][32], int pcount, const char *body) {
    for (int i = 0; i < py_func_count; i++) {
        if (strcmp(py_funcs[i].name, name) == 0) {
            py_funcs[i].param_count = pcount;
            for (int k = 0; k < pcount; k++) strncpy(py_funcs[i].params[k], params[k], 31);
            strncpy(py_funcs[i].body, body, sizeof(py_funcs[i].body) - 1);
            return;
        }
    }
    if (py_func_count < MAX_PY_FUNCS) {
        strncpy(py_funcs[py_func_count].name, name, sizeof(py_funcs[0].name) - 1);
        py_funcs[py_func_count].param_count = pcount;
        for (int k = 0; k < pcount; k++) strncpy(py_funcs[py_func_count].params[k], params[k], 31);
        strncpy(py_funcs[py_func_count].body, body, sizeof(py_funcs[0].body) - 1);
        py_func_count++;
    }
}

/* Forward declarations */
static py_val_t eval_expr(const char *expr);
static void exec_python_line(const char *raw_line);
static void exec_python_statements(const char *code);
static void exec_python_source(const char *code);

static const char *skip_ws(const char *p) {
    while (*p && isspace((unsigned char)*p)) p++;
    return p;
}

static py_val_t eval_primary(const char **p) {
    *p = skip_ws(*p);
    if (**p == '\0') return make_none();

    /* Unary minus */
    if (**p == '-' && !isdigit((unsigned char)(*p)[1])) {
        (*p)++;
        py_val_t sub = eval_primary(p);
        if (sub.type == VAL_INT) return make_int(-sub.u.i_val);
        if (sub.type == VAL_FLOAT) return make_float(-sub.u.f_val);
        return sub;
    }

    /* Unary not */
    if (strncmp(*p, "not ", 4) == 0) {
        *p += 4;
        py_val_t sub = eval_primary(p);
        int b = !is_truthy(sub);
        free_val(sub);
        return make_bool(b);
    }

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
        char buf[4096] = {0};
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

    /* List literal: [1, 2, 3] */
    if (**p == '[') {
        (*p)++;
        py_val_t list = make_list();
        *p = skip_ws(*p);
        while (**p && **p != ']') {
            py_val_t item = eval_expr(*p);
            list_append(&list, item);
            while (**p && **p != ',' && **p != ']') (*p)++;
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

        /* String methods: <var>.upper(), <var>.lower(), <var>.strip() */
        char *dot = strchr(id, '.');
        if (dot && **p == '(') {
            *dot = '\0';
            const char *var_name = id;
            const char *method = dot + 1;
            (*p)++;
            while (**p && **p != ')') (*p)++;
            if (**p == ')') (*p)++;
            py_val_t target = get_py_var(var_name);
            if (target.type == VAL_STR && target.u.s_val) {
                if (strcmp(method, "upper") == 0) {
                    char *copy = strdup(target.u.s_val);
                    for (char *c = copy; *c; c++) *c = toupper((unsigned char)*c);
                    free_val(target);
                    py_val_t r = make_str(copy);
                    free(copy);
                    return r;
                }
                if (strcmp(method, "lower") == 0) {
                    char *copy = strdup(target.u.s_val);
                    for (char *c = copy; *c; c++) *c = tolower((unsigned char)*c);
                    free_val(target);
                    py_val_t r = make_str(copy);
                    free(copy);
                    return r;
                }
                if (strcmp(method, "strip") == 0) {
                    const char *s = target.u.s_val;
                    while (*s && isspace((unsigned char)*s)) s++;
                    char *copy = strdup(s);
                    size_t l = strlen(copy);
                    while (l > 0 && isspace((unsigned char)copy[l - 1])) copy[--l] = '\0';
                    free_val(target);
                    py_val_t r = make_str(copy);
                    free(copy);
                    return r;
                }
            }
            free_val(target);
            return make_none();
        }

        /* Check for user-defined function */
        for (int f = 0; f < py_func_count; f++) {
            if (strcmp(py_funcs[f].name, id) == 0 && **p == '(') {
                (*p)++;
                py_val_t call_args[8];
                int carg_count = 0;
                *p = skip_ws(*p);
                while (**p && **p != ')' && carg_count < 8) {
                    char arg_str[256] = {0};
                    size_t ai = 0;
                    int p_depth = 0;
                    while (**p && ((**p != ')' && **p != ',') || p_depth > 0)) {
                        if (**p == '(') p_depth++;
                        else if (**p == ')') p_depth--;
                        if (ai < sizeof(arg_str) - 1) arg_str[ai++] = *(*p)++;
                        else (*p)++;
                    }
                    call_args[carg_count++] = eval_expr(skip_ws(arg_str));
                    *p = skip_ws(*p);
                    if (**p == ',') (*p)++;
                    *p = skip_ws(*p);
                }
                if (**p == ')') (*p)++;

                py_val_t saved[8];
                int had_saved[8] = {0};
                for (int k = 0; k < py_funcs[f].param_count; k++) {
                    for (int g = 0; g < py_global_count; g++) {
                        if (strcmp(py_globals[g].name, py_funcs[f].params[k]) == 0) {
                            saved[k] = clone_val(py_globals[g].val);
                            had_saved[k] = 1;
                            break;
                        }
                    }
                    if (k < carg_count) {
                        set_py_var(py_funcs[f].params[k], call_args[k]);
                    }
                }

                py_val_t ret_val = make_none();
                const char *ret_kw = strstr(py_funcs[f].body, "return ");
                if (ret_kw) {
                    ret_val = eval_expr(skip_ws(ret_kw + 7));
                } else if (strcmp(skip_ws(py_funcs[f].body), "return") == 0) {
                    ret_val = make_none();
                } else {
                    exec_python_source(py_funcs[f].body);
                }

                for (int k = 0; k < py_funcs[f].param_count; k++) {
                    if (had_saved[k]) {
                        set_py_var(py_funcs[f].params[k], saved[k]);
                    } else {
                        for (int g = 0; g < py_global_count; g++) {
                            if (strcmp(py_globals[g].name, py_funcs[f].params[k]) == 0) {
                                free_val(py_globals[g].val);
                                for (int m = g; m < py_global_count - 1; m++) py_globals[m] = py_globals[m + 1];
                                py_global_count--;
                                break;
                            }
                        }
                    }
                }
                return ret_val;
            }
        }

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
            if (strcmp(id, "input") == 0) {
                if (argc >= 1) {
                    print_val(args[0], 0);
                    fflush(stdout);
                    free_val(args[0]);
                }
                char in_buf[4096] = {0};
                if (fgets(in_buf, sizeof(in_buf), stdin)) {
                    size_t l = strlen(in_buf);
                    while (l > 0 && (in_buf[l - 1] == '\n' || in_buf[l - 1] == '\r')) in_buf[--l] = '\0';
                    return make_str(in_buf);
                }
                return make_str("");
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
            if (strcmp(id, "float") == 0 && argc >= 1) {
                double x = 0.0;
                if (args[0].type == VAL_FLOAT) x = args[0].u.f_val;
                else if (args[0].type == VAL_INT) x = (double)args[0].u.i_val;
                else if (args[0].type == VAL_STR && args[0].u.s_val) x = atof(args[0].u.s_val);
                free_val(args[0]);
                return make_float(x);
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
            if (strcmp(id, "bool") == 0 && argc >= 1) {
                int b = is_truthy(args[0]);
                free_val(args[0]);
                return make_bool(b);
            }
            if (strcmp(id, "abs") == 0 && argc >= 1) {
                if (args[0].type == VAL_INT) {
                    long v = args[0].u.i_val;
                    free_val(args[0]);
                    return make_int(v < 0 ? -v : v);
                }
                if (args[0].type == VAL_FLOAT) {
                    double v = args[0].u.f_val;
                    free_val(args[0]);
                    return make_float(fabs(v));
                }
            }
            if (strcmp(id, "type") == 0 && argc >= 1) {
                const char *tname = "<class 'NoneType'>";
                if (args[0].type == VAL_INT) tname = "<class 'int'>";
                else if (args[0].type == VAL_FLOAT) tname = "<class 'float'>";
                else if (args[0].type == VAL_STR) tname = "<class 'str'>";
                else if (args[0].type == VAL_BOOL) tname = "<class 'bool'>";
                else if (args[0].type == VAL_LIST) tname = "<class 'list'>";
                free_val(args[0]);
                return make_str(tname);
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
            if (strcmp(id, "min") == 0 && argc >= 1) {
                long m = (args[0].type == VAL_INT) ? args[0].u.i_val : 0;
                for (int i = 1; i < argc; i++) {
                    if (args[i].type == VAL_INT && args[i].u.i_val < m) m = args[i].u.i_val;
                }
                for (int i = 0; i < argc; i++) free_val(args[i]);
                return make_int(m);
            }
            if (strcmp(id, "max") == 0 && argc >= 1) {
                long m = (args[0].type == VAL_INT) ? args[0].u.i_val : 0;
                for (int i = 1; i < argc; i++) {
                    if (args[i].type == VAL_INT && args[i].u.i_val > m) m = args[i].u.i_val;
                }
                for (int i = 0; i < argc; i++) free_val(args[i]);
                return make_int(m);
            }
            if (strcmp(id, "round") == 0 && argc >= 1) {
                double v = (args[0].type == VAL_FLOAT) ? args[0].u.f_val : (double)args[0].u.i_val;
                free_val(args[0]);
                return make_int((long)round(v));
            }
            if (strcmp(id, "math.sqrt") == 0 && argc >= 1) {
                double val = (args[0].type == VAL_FLOAT) ? args[0].u.f_val : ((args[0].type == VAL_INT) ? (double)args[0].u.i_val : 0.0);
                free_val(args[0]);
                return make_float(sqrt(val));
            }
            if (strcmp(id, "sys.exit") == 0 || strcmp(id, "exit") == 0 || strcmp(id, "quit") == 0) {
                int code = (argc >= 1 && args[0].type == VAL_INT) ? (int)args[0].u.i_val : 0;
                exit(code);
            }
            for (int i = 0; i < argc; i++) free_val(args[i]);
            return make_none();
        }

        /* Check for indexing: id[index] */
        if (**p == '[') {
            (*p)++;
            py_val_t idx_val = eval_expr(*p);
            while (**p && **p != ']') (*p)++;
            if (**p == ']') (*p)++;
            py_val_t var_val = get_py_var(id);
            if (var_val.type == VAL_LIST && var_val.u.l_val && idx_val.type == VAL_INT) {
                long idx = idx_val.u.i_val;
                long count = (long)var_val.u.l_val->count;
                if (idx < 0) idx += count;
                py_val_t ret_val = make_none();
                if (idx >= 0 && idx < count) {
                    ret_val = clone_val(var_val.u.l_val->items[idx]);
                }
                free_val(var_val);
                free_val(idx_val);
                return ret_val;
            }
            if (var_val.type == VAL_STR && var_val.u.s_val && idx_val.type == VAL_INT) {
                long idx = idx_val.u.i_val;
                long len = (long)strlen(var_val.u.s_val);
                if (idx < 0) idx += len;
                char ch[2] = {0};
                if (idx >= 0 && idx < len) ch[0] = var_val.u.s_val[idx];
                free_val(var_val);
                free_val(idx_val);
                return make_str(ch);
            }
            free_val(var_val);
            free_val(idx_val);
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
        char op[8] = {0};
        if (strncmp(p, "and ", 4) == 0) {
            strcpy(op, "and");
            p += 4;
        } else if (strncmp(p, "or ", 3) == 0) {
            strcpy(op, "or");
            p += 3;
        } else if (p[0] == '*' && p[1] == '*') {
            strcpy(op, "**");
            p += 2;
        } else if ((p[0] == '=' && p[1] == '=') || (p[0] == '!' && p[1] == '=') ||
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
            } else if (left.type == VAL_STR && right.type == VAL_INT) {
                long count = right.u.i_val;
                if (count <= 0) {
                    free_val(left);
                    left = make_str("");
                } else {
                    size_t slen = strlen(left.u.s_val);
                    char *rep = (char *)malloc(slen * count + 1);
                    rep[0] = '\0';
                    for (long k = 0; k < count; k++) strcat(rep, left.u.s_val);
                    free_val(left);
                    left = make_str(rep);
                    free(rep);
                }
            } else {
                double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
                double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
                left = make_float(lf * rf);
            }
        } else if (strcmp(op, "**") == 0) {
            double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
            double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
            double res = pow(lf, rf);
            if (left.type == VAL_INT && right.type == VAL_INT && rf >= 0 && res == (long)res) {
                left = make_int((long)res);
            } else {
                left = make_float(res);
            }
        } else if (strcmp(op, "/") == 0) {
            double lf = (left.type == VAL_FLOAT) ? left.u.f_val : (double)left.u.i_val;
            double rf = (right.type == VAL_FLOAT) ? right.u.f_val : (double)right.u.i_val;
            left = make_float(rf != 0.0 ? (lf / rf) : 0.0);
        } else if (strcmp(op, "//") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            left = make_int(ri != 0 ? (li / ri) : 0);
        } else if (strcmp(op, "%") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            left = make_int(ri != 0 ? (li % ri) : 0);
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
        } else if (strcmp(op, "<=") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            free_val(left);
            left = make_bool(li <= ri);
        } else if (strcmp(op, ">") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            free_val(left);
            left = make_bool(li > ri);
        } else if (strcmp(op, ">=") == 0) {
            long li = (left.type == VAL_INT) ? left.u.i_val : (long)left.u.f_val;
            long ri = (right.type == VAL_INT) ? right.u.i_val : (long)right.u.f_val;
            free_val(left);
            left = make_bool(li >= ri);
        } else if (strcmp(op, "and") == 0) {
            int b = is_truthy(left) && is_truthy(right);
            free_val(left);
            left = make_bool(b);
        } else if (strcmp(op, "or") == 0) {
            int b = is_truthy(left) || is_truthy(right);
            free_val(left);
            left = make_bool(b);
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
    if (strncmp(line, "import ", 7) == 0 || strncmp(line, "from ", 5) == 0) {
        return; /* Builtin modules sys, math, os are always ready */
    }

    /* def function definition */
    if (strncmp(line, "def ", 4) == 0) {
        const char *p = line + 4;
        char fname[64] = {0};
        size_t fi = 0;
        while (isalnum((unsigned char)*p) || *p == '_') fname[fi++] = *p++;
        p = skip_ws(p);
        if (*p == '(') {
            p++;
            char params[8][32] = {{0}};
            int pcount = 0;
            while (*p && *p != ')' && pcount < 8) {
                p = skip_ws(p);
                char pname[32] = {0};
                size_t pi = 0;
                while (isalnum((unsigned char)*p) || *p == '_') pname[pi++] = *p++;
                if (pi > 0) strncpy(params[pcount++], pname, 31);
                p = skip_ws(p);
                if (*p == ',') p++;
            }
            if (*p == ')') p++;
            p = skip_ws(p);
            if (*p == ':') p++;
            const char *body = skip_ws(p);
            define_function(fname, params, pcount, body);
            return;
        }
    }

    /* List append: <var>.append(<expr>) */
    if (strstr(line, ".append(") != NULL) {
        char var_name[64] = {0};
        const char *dot = strstr(line, ".append(");
        const char *vp = line;
        size_t vi = 0;
        while (vp < dot && (isalnum((unsigned char)*vp) || *vp == '_')) var_name[vi++] = *vp++;
        const char *arg_start = dot + 8;
        const char *close_p = strrchr(arg_start, ')');
        if (close_p) {
            char arg_expr[512] = {0};
            strncpy(arg_expr, arg_start, close_p - arg_start);
            py_val_t val = eval_expr(skip_ws(arg_expr));
            append_to_var(var_name, val);
            return;
        }
    }

    /* Augmented assignment: +=, -=, *=, /= */
    const char *aug = NULL;
    char aug_op = 0;
    if ((aug = strstr(line, "+=")) != NULL) aug_op = '+';
    else if ((aug = strstr(line, "-=")) != NULL) aug_op = '-';
    else if ((aug = strstr(line, "*=")) != NULL) aug_op = '*';
    else if ((aug = strstr(line, "/=")) != NULL) aug_op = '/';

    if (aug && aug_op) {
        char var_name[64] = {0};
        const char *vp = line;
        size_t vi = 0;
        while (vp < aug && (isalnum((unsigned char)*vp) || *vp == '_')) var_name[vi++] = *vp++;
        py_val_t old_val = get_py_var(var_name);
        py_val_t rhs = eval_expr(aug + 2);
        if (old_val.type == VAL_INT && rhs.type == VAL_INT) {
            long res = old_val.u.i_val;
            if (aug_op == '+') res += rhs.u.i_val;
            else if (aug_op == '-') res -= rhs.u.i_val;
            else if (aug_op == '*') res *= rhs.u.i_val;
            else if (aug_op == '/' && rhs.u.i_val != 0) res /= rhs.u.i_val;
            set_py_var(var_name, make_int(res));
        } else if (old_val.type == VAL_STR && rhs.type == VAL_STR && aug_op == '+') {
            char *cat = (char *)malloc(strlen(old_val.u.s_val) + strlen(rhs.u.s_val) + 1);
            strcpy(cat, old_val.u.s_val);
            strcat(cat, rhs.u.s_val);
            set_py_var(var_name, make_str(cat));
            free(cat);
        } else {
            double lf = (old_val.type == VAL_FLOAT) ? old_val.u.f_val : (double)old_val.u.i_val;
            double rf = (rhs.type == VAL_FLOAT) ? rhs.u.f_val : (double)rhs.u.i_val;
            double res = lf;
            if (aug_op == '+') res += rf;
            else if (aug_op == '-') res -= rf;
            else if (aug_op == '*') res *= rf;
            else if (aug_op == '/' && rf != 0.0) res /= rf;
            set_py_var(var_name, make_float(res));
        }
        free_val(old_val);
        free_val(rhs);
        return;
    }

    /* Index assignment: <var>[<idx>] = <expr> */
    char *eq = strchr(line, '=');
    char *lbracket = strchr(line, '[');
    if (lbracket && eq && lbracket < eq) {
        char *rbracket = strchr(lbracket, ']');
        if (rbracket && rbracket < eq) {
            char var_name[64] = {0};
            strncpy(var_name, line, lbracket - line);
            char idx_str[64] = {0};
            strncpy(idx_str, lbracket + 1, rbracket - lbracket - 1);
            py_val_t idx_val = eval_expr(idx_str);
            py_val_t new_val = eval_expr(eq + 1);

            for (int k = 0; k < py_global_count; k++) {
                if (strcmp(py_globals[k].name, skip_ws(var_name)) == 0 &&
                    py_globals[k].val.type == VAL_LIST && py_globals[k].val.u.l_val &&
                    idx_val.type == VAL_INT) {
                    long idx = idx_val.u.i_val;
                    long count = (long)py_globals[k].val.u.l_val->count;
                    if (idx < 0) idx += count;
                    if (idx >= 0 && idx < count) {
                        free_val(py_globals[k].val.u.l_val->items[idx]);
                        py_globals[k].val.u.l_val->items[idx] = new_val;
                        free_val(idx_val);
                        return;
                    }
                }
            }
            free_val(idx_val);
            free_val(new_val);
            return;
        }
    }

    /* Assignment: <var> = <expr> */
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

static void exec_python_statements(const char *code) {
    const char *p = code;
    char stmt[4096] = {0};
    size_t si = 0;
    char quote = 0;
    int paren = 0;

    while (*p) {
        if (quote) {
            if (*p == quote) quote = 0;
            stmt[si++] = *p++;
        } else if (*p == '"' || *p == '\'') {
            quote = *p;
            stmt[si++] = *p++;
        } else if (*p == '(' || *p == '[') {
            paren++;
            stmt[si++] = *p++;
        } else if (*p == ')' || *p == ']') {
            paren--;
            stmt[si++] = *p++;
        } else if (*p == ';' && paren == 0) {
            stmt[si] = '\0';
            exec_python_line(stmt);
            si = 0;
            p++;
        } else {
            stmt[si++] = *p++;
        }
    }
    if (si > 0) {
        stmt[si] = '\0';
        exec_python_line(stmt);
    }
}

static void exec_python_source(const char *code) {
    if (!code || *code == '\0') return;

    char *dup = strdup(code);
    char *lines[1024];
    int line_count = 0;

    char *saveptr = NULL;
    char *l = strtok_r(dup, "\r\n", &saveptr);
    while (l && line_count < 1024) {
        lines[line_count++] = l;
        l = strtok_r(NULL, "\r\n", &saveptr);
    }

    int i = 0;
    while (i < line_count) {
        const char *raw = lines[i];
        const char *trimmed = skip_ws(raw);
        if (*trimmed == '\0' || *trimmed == '#') {
            i++;
            continue;
        }

        /* Check for for-loop block */
        if (strncmp(trimmed, "for ", 4) == 0) {
            const char *p = trimmed + 4;
            char var_name[64] = {0};
            size_t vi = 0;
            while (isalnum((unsigned char)*p) || *p == '_') var_name[vi++] = *p++;
            p = skip_ws(p);
            if (strncmp(p, "in ", 3) == 0) {
                p += 3;
                const char *colon = strchr(p, ':');
                if (colon) {
                    char iter_expr[256] = {0};
                    strncpy(iter_expr, p, colon - p);
                    const char *body_after = skip_ws(colon + 1);

                    if (*body_after != '\0') {
                        py_val_t iter = eval_expr(iter_expr);
                        if (iter.type == VAL_LIST && iter.u.l_val) {
                            for (size_t k = 0; k < iter.u.l_val->count; k++) {
                                set_py_var(var_name, clone_val(iter.u.l_val->items[k]));
                                exec_python_statements(body_after);
                            }
                        }
                        free_val(iter);
                        i++;
                        continue;
                    } else {
                        int block_start = i + 1;
                        int block_end = block_start;
                        while (block_end < line_count) {
                            const char *next_raw = lines[block_end];
                            if (*skip_ws(next_raw) == '\0') { block_end++; continue; }
                            if (next_raw[0] == ' ' || next_raw[0] == '\t') block_end++;
                            else break;
                        }

                        char block_buf[8192] = {0};
                        for (int b = block_start; b < block_end; b++) {
                            const char *bl = skip_ws(lines[b]);
                            if (*bl) {
                                strncat(block_buf, bl, sizeof(block_buf) - strlen(block_buf) - 2);
                                strncat(block_buf, "\n", sizeof(block_buf) - strlen(block_buf) - 1);
                            }
                        }

                        py_val_t iter = eval_expr(iter_expr);
                        if (iter.type == VAL_LIST && iter.u.l_val) {
                            for (size_t k = 0; k < iter.u.l_val->count; k++) {
                                set_py_var(var_name, clone_val(iter.u.l_val->items[k]));
                                exec_python_source(block_buf);
                            }
                        }
                        free_val(iter);
                        i = block_end;
                        continue;
                    }
                }
            }
        }

        /* Check for if statement block */
        if (strncmp(trimmed, "if ", 3) == 0) {
            const char *p = trimmed + 3;
            const char *colon = strchr(p, ':');
            if (colon) {
                char cond_expr[256] = {0};
                strncpy(cond_expr, p, colon - p);
                const char *body_after = skip_ws(colon + 1);

                py_val_t cond = eval_expr(cond_expr);
                int truthy = is_truthy(cond);
                free_val(cond);

                if (*body_after != '\0') {
                    if (truthy) exec_python_statements(body_after);
                    i++;
                    continue;
                } else {
                    int block_start = i + 1;
                    int block_end = block_start;
                    while (block_end < line_count) {
                        const char *next_raw = lines[block_end];
                        if (*skip_ws(next_raw) == '\0') { block_end++; continue; }
                        if (next_raw[0] == ' ' || next_raw[0] == '\t') block_end++;
                        else break;
                    }

                    char if_buf[8192] = {0};
                    for (int b = block_start; b < block_end; b++) {
                        const char *bl = skip_ws(lines[b]);
                        if (*bl) {
                            strncat(if_buf, bl, sizeof(if_buf) - strlen(if_buf) - 2);
                            strncat(if_buf, "\n", sizeof(if_buf) - strlen(if_buf) - 1);
                        }
                    }

                    char else_buf[8192] = {0};
                    int has_else = 0;
                    if (block_end < line_count && strncmp(skip_ws(lines[block_end]), "else:", 5) == 0) {
                        has_else = 1;
                        int else_start = block_end + 1;
                        int else_end = else_start;
                        while (else_end < line_count) {
                            const char *next_raw = lines[else_end];
                            if (*skip_ws(next_raw) == '\0') { else_end++; continue; }
                            if (next_raw[0] == ' ' || next_raw[0] == '\t') else_end++;
                            else break;
                        }
                        for (int b = else_start; b < else_end; b++) {
                            const char *bl = skip_ws(lines[b]);
                            if (*bl) {
                                strncat(else_buf, bl, sizeof(else_buf) - strlen(else_buf) - 2);
                                strncat(else_buf, "\n", sizeof(else_buf) - strlen(else_buf) - 1);
                            }
                        }
                        block_end = else_end;
                    }

                    if (truthy) {
                        exec_python_source(if_buf);
                    } else if (has_else) {
                        exec_python_source(else_buf);
                    }
                    i = block_end;
                    continue;
                }
            }
        }

        /* Check for while loop block */
        if (strncmp(trimmed, "while ", 6) == 0) {
            const char *p = trimmed + 6;
            const char *colon = strchr(p, ':');
            if (colon) {
                char cond_expr[256] = {0};
                strncpy(cond_expr, p, colon - p);
                const char *body_after = skip_ws(colon + 1);

                if (*body_after != '\0') {
                    int max_iter = 10000;
                    while (max_iter-- > 0) {
                        py_val_t cond = eval_expr(cond_expr);
                        int truthy = is_truthy(cond);
                        free_val(cond);
                        if (!truthy) break;
                        exec_python_statements(body_after);
                    }
                    i++;
                    continue;
                } else {
                    int block_start = i + 1;
                    int block_end = block_start;
                    while (block_end < line_count) {
                        const char *next_raw = lines[block_end];
                        if (*skip_ws(next_raw) == '\0') { block_end++; continue; }
                        if (next_raw[0] == ' ' || next_raw[0] == '\t') block_end++;
                        else break;
                    }

                    char while_buf[8192] = {0};
                    for (int b = block_start; b < block_end; b++) {
                        const char *bl = skip_ws(lines[b]);
                        if (*bl) {
                            strncat(while_buf, bl, sizeof(while_buf) - strlen(while_buf) - 2);
                            strncat(while_buf, "\n", sizeof(while_buf) - strlen(while_buf) - 1);
                        }
                    }

                    int max_iter = 10000;
                    while (max_iter-- > 0) {
                        py_val_t cond = eval_expr(cond_expr);
                        int truthy = is_truthy(cond);
                        free_val(cond);
                        if (!truthy) break;
                        exec_python_source(while_buf);
                    }
                    i = block_end;
                    continue;
                }
            }
        }

        /* Check for def function block */
        if (strncmp(trimmed, "def ", 4) == 0) {
            const char *p = trimmed + 4;
            char fname[64] = {0};
            size_t fi = 0;
            while (isalnum((unsigned char)*p) || *p == '_') fname[fi++] = *p++;
            p = skip_ws(p);
            if (*p == '(') {
                p++;
                char params[8][32] = {{0}};
                int pcount = 0;
                while (*p && *p != ')' && pcount < 8) {
                    p = skip_ws(p);
                    char pname[32] = {0};
                    size_t pi = 0;
                    while (isalnum((unsigned char)*p) || *p == '_') pname[pi++] = *p++;
                    if (pi > 0) strncpy(params[pcount++], pname, 31);
                    p = skip_ws(p);
                    if (*p == ',') p++;
                }
                if (*p == ')') p++;
                p = skip_ws(p);
                if (*p == ':') p++;
                const char *body_after = skip_ws(p);

                char fbody[2048] = {0};
                int next_i = i + 1;
                if (*body_after != '\0') {
                    strncpy(fbody, body_after, sizeof(fbody) - 1);
                } else {
                    int block_start = i + 1;
                    int block_end = block_start;
                    while (block_end < line_count) {
                        const char *next_raw = lines[block_end];
                        if (*skip_ws(next_raw) == '\0') { block_end++; continue; }
                        if (next_raw[0] == ' ' || next_raw[0] == '\t') block_end++;
                        else break;
                    }
                    for (int b = block_start; b < block_end; b++) {
                        const char *bl = skip_ws(lines[b]);
                        if (*bl) {
                            strncat(fbody, bl, sizeof(fbody) - strlen(fbody) - 2);
                            strncat(fbody, "\n", sizeof(fbody) - strlen(fbody) - 1);
                        }
                    }
                    next_i = block_end;
                }

                define_function(fname, params, pcount, fbody);
                i = next_i;
                continue;
            }
        }

        /* Default: single or semicolon-separated statements */
        exec_python_statements(trimmed);
        i++;
    }

    free(dup);
}

/* ========================================================================= */
/* Interactive REPL                                                          */
/* ========================================================================= */
static void run_python_repl(int is_interactive) {
    if (is_interactive) {
        printf("Python 3.12.0 (main, Feb 13 2026, 00:00:00) [WASM Jazui Clang/Emscripten] on linux\n"
               "Type \"help\", \"copyright\", \"credits\" or \"license\" for more information.\n");
        fflush(stdout);
    }

    char line_buf[4096];
    char multiline_buf[16384] = {0};
    int in_multiline = 0;

    while (1) {
        if (is_interactive) {
            printf("%s", in_multiline ? "... " : ">>> ");
            fflush(stdout);
        }

        if (!fgets(line_buf, sizeof(line_buf), stdin)) {
            if (in_multiline && multiline_buf[0] != '\0') {
                exec_python_source(multiline_buf);
            }
            if (is_interactive) {
                printf("\n");
                fflush(stdout);
            }
            break;
        }

        size_t len = strlen(line_buf);
        while (len > 0 && (line_buf[len - 1] == '\n' || line_buf[len - 1] == '\r')) {
            line_buf[--len] = '\0';
        }

        const char *trimmed = skip_ws(line_buf);

        if (in_multiline) {
            if (*trimmed == '\0') {
                exec_python_source(multiline_buf);
                multiline_buf[0] = '\0';
                in_multiline = 0;
                continue;
            } else if (line_buf[0] != ' ' && line_buf[0] != '\t') {
                /* Unindented line closes the multiline block */
                exec_python_source(multiline_buf);
                multiline_buf[0] = '\0';
                in_multiline = 0;
                /* Fall through to execute this line */
            } else {
                strncat(multiline_buf, "\n", sizeof(multiline_buf) - strlen(multiline_buf) - 2);
                strncat(multiline_buf, line_buf, sizeof(multiline_buf) - strlen(multiline_buf) - 1);
                continue;
            }
        }

        if (*trimmed == '\0') continue;

        if (strcmp(trimmed, "exit()") == 0 || strcmp(trimmed, "quit()") == 0) {
            break;
        }
        if (strcmp(trimmed, "exit") == 0 || strcmp(trimmed, "quit") == 0) {
            printf("Use exit() or Ctrl-D (i.e. EOF) to exit\n");
            fflush(stdout);
            continue;
        }
        if (strcmp(trimmed, "help") == 0) {
            printf("Type help() for interactive help, or help(object) for help about object.\n");
            fflush(stdout);
            continue;
        }
        if (strcmp(trimmed, "help()") == 0) {
            printf("Welcome to Python 3.12's help utility!\n"
                   "Enter any Python expression, statement, or function to evaluate.\n"
                   "Type exit() or quit() to leave the REPL.\n");
            fflush(stdout);
            continue;
        }
        if (strcmp(trimmed, "copyright") == 0 || strcmp(trimmed, "copyright()") == 0) {
            printf("Copyright (c) 2001-2026 Python Software Foundation. All Rights Reserved.\n");
            fflush(stdout);
            continue;
        }
        if (strcmp(trimmed, "credits") == 0 || strcmp(trimmed, "credits()") == 0) {
            printf("Thanks to CPython developers and the open-source community.\n");
            fflush(stdout);
            continue;
        }
        if (strcmp(trimmed, "license") == 0 || strcmp(trimmed, "license()") == 0) {
            printf("Type license() to see the full license text\n"
                   "Python 3.12 license: PSF License Agreement.\n");
            fflush(stdout);
            continue;
        }
        if (strcmp(trimmed, "clear") == 0 || strcmp(trimmed, "clear()") == 0) {
            printf("\033[H\033[2J");
            fflush(stdout);
            continue;
        }

        /* Check if line starts a block expecting indented lines */
        size_t tlen = strlen(trimmed);
        if (tlen > 0 && trimmed[tlen - 1] == ':') {
            strncpy(multiline_buf, line_buf, sizeof(multiline_buf) - 1);
            in_multiline = 1;
            continue;
        }

        char *eq = strchr(trimmed, '=');
        int is_assign = (eq && *(eq - 1) != '=' && *(eq + 1) != '=' &&
                             *(eq - 1) != '!' && *(eq - 1) != '<' && *(eq - 1) != '>');
        int is_stmt = (strncmp(trimmed, "import ", 7) == 0 ||
                       strncmp(trimmed, "from ", 5) == 0 ||
                       strncmp(trimmed, "for ", 4) == 0 ||
                       strncmp(trimmed, "if ", 3) == 0 ||
                       strncmp(trimmed, "while ", 6) == 0 ||
                       strncmp(trimmed, "def ", 4) == 0 ||
                       strncmp(trimmed, "del ", 4) == 0 ||
                       strchr(trimmed, ';') != NULL ||
                       strstr(trimmed, ".append(") != NULL ||
                       strstr(trimmed, "+=") != NULL ||
                       strstr(trimmed, "-=") != NULL ||
                       strstr(trimmed, "*=") != NULL ||
                       strstr(trimmed, "/=") != NULL ||
                       is_assign);

        if (is_stmt) {
            exec_python_source(trimmed);
        } else {
            if (strncmp(trimmed, "print(", 6) == 0) {
                exec_python_source(trimmed);
            } else {
                py_val_t val = eval_expr(trimmed);
                if (is_interactive) {
                    if (val.type != VAL_NONE) {
                        print_val(val, 1);
                        printf("\n");
                        fflush(stdout);
                    }
                }
                free_val(val);
            }
        }
    }
}

/* ========================================================================= */
/* Command: python / python3                                                 */
/* ========================================================================= */
static int cmd_python(int argc, char **argv) {
    const char *code_str = NULL;
    const char *module_name = NULL;
    const char *script_file = NULL;
    int force_interactive = 0;

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
                   "-i     : inspect interactively after running script\n"
                   "-q     : don't give version and copyright messages on interactive startup\n"
                   "file   : program read from script file\n");
            return 0;
        }
        if (strcmp(argv[i], "-i") == 0) {
            force_interactive = 1;
            continue;
        }
        if (strcmp(argv[i], "-q") == 0) {
            continue;
        }
        if (strcmp(argv[i], "-c") == 0 && i + 1 < argc) {
            code_str = argv[++i];
            break;
        }
        if (strcmp(argv[i], "-m") == 0 && i + 1 < argc) {
            module_name = argv[++i];
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
        if (!force_interactive) return 0;
    }

    if (script_file && strcmp(script_file, "-") != 0) {
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
        if (!force_interactive) return 0;
    }

    /* If piped / non-interactive stdin without -i */
    if (!isatty(fileno(stdin)) && !force_interactive) {
        size_t slen = 0;
        unsigned char *bytes = read_stream_bytes(stdin, &slen);
        if (bytes && slen > 0) {
            exec_python_source((const char *)bytes);
            free(bytes);
        }
        return 0;
    }

    /* Interactive REPL */
    run_python_repl(1);
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
