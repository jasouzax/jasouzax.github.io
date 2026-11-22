#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <sys/stat.h>
#include <unistd.h>

#define MAX_RULES 256
#define MAX_COMMANDS 32
#define MAX_VARS 128

typedef struct {
    char name[128];
    char value[512];
} var_t;

typedef struct {
    char target[128];
    char prereqs[512];
    char commands[MAX_COMMANDS][512];
    int command_count;
} rule_t;

static var_t vars[MAX_VARS];
static int var_count = 0;

static rule_t rules[MAX_RULES];
static int rule_count = 0;

static int opt_dry_run = 0;
static int opt_always_make = 0;

static void set_var(const char *name, const char *val) {
    for (int i = 0; i < var_count; i++) {
        if (strcmp(vars[i].name, name) == 0) {
            strncpy(vars[i].value, val, sizeof(vars[i].value) - 1);
            return;
        }
    }
    if (var_count < MAX_VARS) {
        strncpy(vars[var_count].name, name, sizeof(vars[var_count].name) - 1);
        strncpy(vars[var_count].value, val, sizeof(vars[var_count].value) - 1);
        var_count++;
    }
}

static const char *get_var(const char *name) {
    for (int i = 0; i < var_count; i++) {
        if (strcmp(vars[i].name, name) == 0) return vars[i].value;
    }
    return getenv(name);
}

static char *expand_vars(const char *str, const char *target, const char *prereqs) {
    static char out[2048];
    size_t oi = 0;
    size_t len = strlen(str);

    for (size_t i = 0; i < len; i++) {
        if (str[i] == '$') {
            i++;
            if (i >= len) break;
            if (str[i] == '@') {
                if (target) {
                    size_t tl = strlen(target);
                    if (oi + tl < sizeof(out) - 1) {
                        strcpy(out + oi, target);
                        oi += tl;
                    }
                }
            } else if (str[i] == '^' || str[i] == '<') {
                if (prereqs) {
                    size_t pl = strlen(prereqs);
                    if (oi + pl < sizeof(out) - 1) {
                        strcpy(out + oi, prereqs);
                        oi += pl;
                    }
                }
            } else if (str[i] == '(' || str[i] == '{') {
                char term = (str[i] == '(') ? ')' : '}';
                i++;
                char vname[128] = {0};
                size_t vi = 0;
                while (i < len && str[i] != term && vi < sizeof(vname) - 1) {
                    vname[vi++] = str[i++];
                }
                const char *val = get_var(vname);
                if (val) {
                    size_t vl = strlen(val);
                    if (oi + vl < sizeof(out) - 1) {
                        strcpy(out + oi, val);
                        oi += vl;
                    }
                }
            } else {
                char vname[2] = { str[i], '\0' };
                const char *val = get_var(vname);
                if (val) {
                    size_t vl = strlen(val);
                    if (oi + vl < sizeof(out) - 1) {
                        strcpy(out + oi, val);
                        oi += vl;
                    }
                }
            }
        } else {
            if (oi < sizeof(out) - 1) {
                out[oi++] = str[i];
            }
        }
    }
    out[oi] = '\0';
    return out;
}

static rule_t *find_rule(const char *target) {
    for (int i = 0; i < rule_count; i++) {
        if (strcmp(rules[i].target, target) == 0) return &rules[i];
    }
    return NULL;
}

static int build_target(const char *target);

static int run_recipe_cmd(const char *cmd) {
    while (isspace(*cmd)) cmd++;
    if (*cmd == '\0') return 0;

    if (strncmp(cmd, "echo ", 5) == 0) {
        printf("%s\n", cmd + 5);
        fflush(stdout);
        return 0;
    }
    if (strcmp(cmd, "echo") == 0) {
        printf("\n");
        fflush(stdout);
        return 0;
    }
    if (strncmp(cmd, "touch ", 6) == 0) {
        const char *f = cmd + 6;
        while (isspace(*f)) f++;
        FILE *fp = fopen(f, "a");
        if (fp) { fclose(fp); return 0; }
        return 1;
    }
    if (strncmp(cmd, "rm ", 3) == 0) {
        const char *f = cmd + 3;
        while (isspace(*f)) f++;
        if (strncmp(f, "-f ", 3) == 0) {
            f += 3;
            while (isspace(*f)) f++;
        }
        unlink(f);
        return 0;
    }
    if (strcmp(cmd, "true") == 0) return 0;
    if (strcmp(cmd, "false") == 0) return 1;

    return 0;
}

static int build_rule(rule_t *r) {
    int need_build = opt_always_make;
    struct stat target_st;
    int target_exists = (stat(r->target, &target_st) == 0);

    if (!target_exists) need_build = 1;

    char pcopy[512];
    strncpy(pcopy, r->prereqs, sizeof(pcopy) - 1);
    pcopy[sizeof(pcopy) - 1] = '\0';

    char *saveptr = NULL;
    char *prereq = strtok_r(pcopy, " \t\r\n", &saveptr);
    while (prereq) {
        int pret = build_target(prereq);
        if (pret != 0) return pret;

        struct stat pst;
        if (stat(prereq, &pst) == 0) {
            if (!target_exists || pst.st_mtime > target_st.st_mtime) {
                need_build = 1;
            }
        }
        prereq = strtok_r(NULL, " \t\r\n", &saveptr);
    }

    if (need_build) {
        for (int c = 0; c < r->command_count; c++) {
            const char *raw_cmd = r->commands[c];
            while (isspace(*raw_cmd)) raw_cmd++;
            int silent = (*raw_cmd == '@');
            if (silent) raw_cmd++;
            while (isspace(*raw_cmd)) raw_cmd++;

            char *expanded = expand_vars(raw_cmd, r->target, r->prereqs);
            if (!silent) {
                printf("%s\n", expanded);
                fflush(stdout);
            }
            if (!opt_dry_run) {
                int code = run_recipe_cmd(expanded);
                if (code != 0) {
                    fprintf(stderr, "make: *** [%s] Error %d\n", r->target, code);
                    return code;
                }
            }
        }
    } else {
        printf("make: '%s' is up to date.\n", r->target);
    }
    return 0;
}

static int build_target(const char *target) {
    rule_t *r = find_rule(target);
    if (r) return build_rule(r);

    struct stat st;
    if (stat(target, &st) == 0) return 0; /* File exists */

    fprintf(stderr, "make: *** No rule to make target '%s'.  Stop.\n", target);
    return 2;
}

static int parse_makefile(const char *path) {
    FILE *fp = fopen(path, "r");
    if (!fp) return 0;

    char line[1024];
    rule_t *current_rule = NULL;

    while (fgets(line, sizeof(line), fp)) {
        /* Strip trailing newline */
        size_t l = strlen(line);
        while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';

        if (l == 0 || line[0] == '#') continue;

        /* Recipe line */
        if (line[0] == '\t') {
            if (current_rule && current_rule->command_count < MAX_COMMANDS) {
                strncpy(current_rule->commands[current_rule->command_count++],
                        line + 1, sizeof(current_rule->commands[0]) - 1);
            }
            continue;
        }

        /* Check variable assignment */
        char *eq = strchr(line, '=');
        char *colon = strchr(line, ':');

        if (eq && (!colon || eq < colon)) {
            char *vname = line;
            *eq = '\0';
            char *vval = eq + 1;
            if (*vval == ':') vval++; /* := */
            while (isspace(*vname)) vname++;
            char *ve = vname + strlen(vname) - 1;
            while (ve > vname && isspace(*ve)) *ve-- = '\0';

            while (isspace(*vval)) vval++;
            set_var(vname, vval);
            current_rule = NULL;
            continue;
        }

        /* Rule line */
        if (colon) {
            *colon = '\0';
            char *tname = line;
            while (isspace(*tname)) tname++;
            char *te = tname + strlen(tname) - 1;
            while (te > tname && isspace(*te)) *te-- = '\0';

            char *prereqs = colon + 1;
            while (isspace(*prereqs)) prereqs++;

            if (rule_count < MAX_RULES) {
                current_rule = &rules[rule_count++];
                memset(current_rule, 0, sizeof(rule_t));
                strncpy(current_rule->target, tname, sizeof(current_rule->target) - 1);
                strncpy(current_rule->prereqs, prereqs, sizeof(current_rule->prereqs) - 1);
            }
            continue;
        }
    }

    fclose(fp);
    return 1;
}

int main(int argc, char **argv) {
    const char *makefile_path = NULL;
    const char *target = NULL;

    set_var("CC", "gcc");
    set_var("CFLAGS", "");
    set_var("RM", "rm -f");

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("GNU Make 4.4.1 (WASM build for Jazui Desktop)\n"
                   "Copyright (C) 1988-2026 Free Software Foundation, Inc.\n"
                   "This is free software; see the source for copying conditions.\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: make [options] [target] ...\n"
                   "Options:\n"
                   "  -B, --always-make           Unconditionally make all targets.\n"
                   "  -C DIRECTORY, --directory=DIRECTORY\n"
                   "                              Change to DIRECTORY before doing anything.\n"
                   "  -f FILE, --file=FILE        Read FILE as a makefile.\n"
                   "  -n, --just-print, --dry-run Don't actually run any recipe; just print them.\n"
                   "  -v, --version               Print the version number of make and exit.\n"
                   "  -h, --help                  Print this message and exit.\n");
            return 0;
        }
        if (strcmp(argv[i], "-f") == 0 && i + 1 < argc) {
            makefile_path = argv[++i];
        } else if (strncmp(argv[i], "--file=", 7) == 0) {
            makefile_path = argv[i] + 7;
        } else if (strcmp(argv[i], "-n") == 0 || strcmp(argv[i], "--just-print") == 0 || strcmp(argv[i], "--dry-run") == 0) {
            opt_dry_run = 1;
        } else if (strcmp(argv[i], "-B") == 0 || strcmp(argv[i], "--always-make") == 0) {
            opt_always_make = 1;
        } else if (strcmp(argv[i], "-C") == 0 && i + 1 < argc) {
            if (chdir(argv[++i]) != 0) {
                fprintf(stderr, "make: chdir: %s: No such file or directory\n", argv[i]);
                return 2;
            }
        } else if (argv[i][0] != '-') {
            if (!target) target = argv[i];
        }
    }

    if (!makefile_path) {
        if (access("Makefile", R_OK) == 0) makefile_path = "Makefile";
        else if (access("makefile", R_OK) == 0) makefile_path = "makefile";
        else if (access("GNUmakefile", R_OK) == 0) makefile_path = "GNUmakefile";
        else {
            fprintf(stderr, "make: *** No targets specified and no makefile found.  Stop.\n");
            return 2;
        }
    }

    if (!parse_makefile(makefile_path)) {
        fprintf(stderr, "make: %s: No such file or directory\n", makefile_path);
        return 2;
    }

    if (!target) {
        if (rule_count > 0) target = rules[0].target;
        else {
            fprintf(stderr, "make: *** No targets.  Stop.\n");
            return 2;
        }
    }

    int ret = build_target(target);
    fflush(stdout);
    fflush(stderr);
    return ret;
}

