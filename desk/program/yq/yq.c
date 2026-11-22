/*
 * yq - YAML / JSON query and conversion tool
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include "cJSON.h"

/* Simple YAML line-by-line parser to cJSON */
static cJSON *parse_yaml_to_json(const char *yaml) {
    cJSON *root = cJSON_CreateObject();
    char line[1024];
    const char *p = yaml;

    while (*p) {
        size_t l = 0;
        while (p[l] && p[l] != '\n' && p[l] != '\r' && l < sizeof(line) - 1) {
            line[l] = p[l];
            l++;
        }
        line[l] = '\0';
        while (*p && (*p == '\n' || *p == '\r')) p++;
        p += l;
        while (*p && (*p == '\n' || *p == '\r')) p++;

        char *trim = line;
        while (*trim && isspace((unsigned char)*trim)) trim++;
        if (!*trim || *trim == '#' || *trim == '-') continue;

        char *colon = strchr(trim, ':');
        if (colon) {
            *colon = '\0';
            char *key = trim;
            char *val = colon + 1;
            while (*val && isspace((unsigned char)*val)) val++;
            size_t klen = strlen(key);
            while (klen > 0 && isspace((unsigned char)key[klen - 1])) key[--klen] = '\0';
            size_t vlen = strlen(val);
            while (vlen > 0 && isspace((unsigned char)val[vlen - 1])) val[--vlen] = '\0';

            /* Strip quotes if present */
            if ((val[0] == '"' && val[vlen - 1] == '"') || (val[0] == '\'' && val[vlen - 1] == '\'')) {
                val[vlen - 1] = '\0';
                val++;
            }

            if (strcmp(val, "true") == 0) {
                cJSON_AddBoolToObject(root, key, 1);
            } else if (strcmp(val, "false") == 0) {
                cJSON_AddBoolToObject(root, key, 0);
            } else if (strcmp(val, "null") == 0 || strcmp(val, "~") == 0) {
                cJSON_AddNullToObject(root, key);
            } else {
                char *end;
                double d = strtod(val, &end);
                if (end != val && *end == '\0') {
                    cJSON_AddNumberToObject(root, key, d);
                } else {
                    cJSON_AddStringToObject(root, key, val);
                }
            }
        }
    }
    return root;
}

static void print_json_as_yaml(const cJSON *item, int indent) {
    if (!item) return;

    if (cJSON_IsObject(item)) {
        cJSON *child = item->child;
        while (child) {
            for (int i = 0; i < indent * 2; i++) putchar(' ');
            printf("%s:", child->string ? child->string : "item");
            if (cJSON_IsObject(child) || cJSON_IsArray(child)) {
                putchar('\n');
                print_json_as_yaml(child, indent + 1);
            } else {
                putchar(' ');
                print_json_as_yaml(child, 0);
            }
            child = child->next;
        }
    } else if (cJSON_IsArray(item)) {
        cJSON *child = item->child;
        while (child) {
            for (int i = 0; i < indent * 2; i++) putchar(' ');
            printf("- ");
            if (cJSON_IsObject(child) || cJSON_IsArray(child)) {
                putchar('\n');
                print_json_as_yaml(child, indent + 1);
            } else {
                print_json_as_yaml(child, 0);
            }
            child = child->next;
        }
    } else if (cJSON_IsString(item)) {
        printf("%s\n", item->valuestring);
    } else if (cJSON_IsNumber(item)) {
        printf("%g\n", item->valuedouble);
    } else if (cJSON_IsBool(item)) {
        printf("%s\n", cJSON_IsTrue(item) ? "true" : "false");
    } else if (cJSON_IsNull(item)) {
        printf("null\n");
    }
}

static cJSON *query_json(cJSON *root, const char *query) {
    if (!query || *query != '.') return root;
    query++;
    if (!*query) return root;

    char qbuf[256];
    strncpy(qbuf, query, sizeof(qbuf) - 1);
    qbuf[sizeof(qbuf) - 1] = '\0';

    cJSON *cur = root;
    char *tok = strtok(qbuf, ".");
    while (tok && cur) {
        if (cJSON_IsObject(cur)) {
            cur = cJSON_GetObjectItemCaseSensitive(cur, tok);
        } else {
            return NULL;
        }
        tok = strtok(NULL, ".");
    }
    return cur;
}

static char *read_all(FILE *f) {
    size_t cap = 8192, len = 0;
    char *buf = malloc(cap);
    if (!buf) return NULL;
    size_t n;
    while ((n = fread(buf + len, 1, cap - len - 1, f)) > 0) {
        len += n;
        if (len + 1024 >= cap) {
            cap *= 2;
            buf = realloc(buf, cap);
        }
    }
    buf[len] = '\0';
    return buf;
}

int main(int argc, char **argv) {
    const char *query = NULL;
    const char *path = NULL;
    int out_json = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            if (strcasecmp(argv[i + 1], "json") == 0) out_json = 1;
            i++;
        } else if (strcmp(argv[i], "-j") == 0 || strcmp(argv[i], "--json") == 0) {
            out_json = 1;
        } else if (strcmp(argv[i], "-y") == 0 || strcmp(argv[i], "--yaml") == 0) {
            out_json = 0;
        } else if (argv[i][0] == '.') {
            query = argv[i];
        } else if (argv[i][0] != '-') {
            path = argv[i];
        }
    }

    FILE *f = path ? fopen(path, "r") : stdin;
    if (!f) { perror(path ? path : "stdin"); return 1; }

    char *data = read_all(f);
    if (f != stdin) fclose(f);
    if (!data) return 1;

    /* Detect if JSON or YAML */
    cJSON *root = NULL;
    char *p = data;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p == '{' || *p == '[') {
        root = cJSON_Parse(data);
    }
    if (!root) {
        root = parse_yaml_to_json(data);
    }

    if (!root) {
        fprintf(stderr, "Failed to parse input\n");
        free(data);
        return 1;
    }

    cJSON *selected = query ? query_json(root, query) : root;
    if (!selected) {
        /* null */
        printf("null\n");
    } else if (out_json) {
        char *json_out = cJSON_Print(selected);
        if (json_out) {
            printf("%s\n", json_out);
            free(json_out);
        }
    } else {
        print_json_as_yaml(selected, 0);
    }

    cJSON_Delete(root);
    free(data);
    fflush(stdout);
    return 0;
}
