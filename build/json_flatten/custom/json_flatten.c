/*
 * json-flatten - Flattens nested JSON structures into dot-notation paths
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"

static void flatten_helper(const cJSON *item, const char *prefix, cJSON *root) {
    if (!item) return;

    if (cJSON_IsObject(item)) {
        cJSON *child = item->child;
        if (!child && prefix[0] != '\0') {
            cJSON_AddItemToObject(root, prefix, cJSON_CreateObject());
        }
        while (child) {
            char new_prefix[1024];
            if (prefix[0] == '\0') {
                snprintf(new_prefix, sizeof(new_prefix), "%s", child->string ? child->string : "");
            } else {
                snprintf(new_prefix, sizeof(new_prefix), "%s.%s", prefix, child->string ? child->string : "");
            }
            flatten_helper(child, new_prefix, root);
            child = child->next;
        }
    } else {
        cJSON *dup = cJSON_Duplicate(item, 1);
        cJSON_AddItemToObject(root, prefix, dup);
    }
}

static char *read_stream(FILE *f) {
    size_t cap = 4096, len = 0;
    char *buf = malloc(cap);
    if (!buf) return NULL;
    size_t n;
    while ((n = fread(buf + len, 1, cap - len - 1, f)) > 0) {
        len += n;
        if (len + 1 >= cap) {
            cap *= 2;
            char *new_buf = realloc(buf, cap);
            if (!new_buf) { free(buf); return NULL; }
            buf = new_buf;
        }
    }
    buf[len] = '\0';
    return buf;
}

int main(int argc, char **argv) {
    FILE *in = stdin;
    if (argc > 1 && strcmp(argv[1], "-h") != 0 && strcmp(argv[1], "--help") != 0) {
        in = fopen(argv[1], "r");
        if (!in) {
            fprintf(stderr, "json-flatten: %s: No such file or directory\n", argv[1]);
            return 1;
        }
    }

    char *text = read_stream(in);
    if (in != stdin) fclose(in);
    if (!text) return 1;

    cJSON *parsed = cJSON_Parse(text);
    free(text);
    if (!parsed) {
        fprintf(stderr, "json-flatten: invalid JSON input\n");
        return 1;
    }

    cJSON *flat = cJSON_CreateObject();
    flatten_helper(parsed, "", flat);
    char *out = cJSON_Print(flat);
    if (out) {
        printf("%s\n", out);
        free(out);
    }
    cJSON_Delete(flat);
    cJSON_Delete(parsed);
    fflush(stdout);
    return 0;
}

