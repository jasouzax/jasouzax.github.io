/*
 * ini2json / env2json / json2env - Configuration and environment ↔ JSON converter
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "cJSON.h"

static char *trim(char *s) {
    while (isspace((unsigned char)*s)) s++;
    if (*s == 0) return s;
    char *end = s + strlen(s) - 1;
    while (end > s && isspace((unsigned char)*end)) end--;
    end[1] = '\0';
    return s;
}

static char *read_stream(FILE *f) {
    size_t cap = 8192, len = 0;
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

static void ini_to_json(const char *text) {
    char *copy = strdup(text);
    if (!copy) return;

    cJSON *root = cJSON_CreateObject();
    cJSON *current_sec = root;

    char *saveptr = NULL;
    char *line = strtok_r(copy, "\r\n", &saveptr);
    while (line) {
        char *s = trim(line);
        if (*s == ';' || *s == '#' || *s == '\0') {
            /* comment or empty */
        } else if (*s == '[' && s[strlen(s) - 1] == ']') {
            s[strlen(s) - 1] = '\0';
            char *sec_name = s + 1;
            current_sec = cJSON_CreateObject();
            cJSON_AddItemToObject(root, sec_name, current_sec);
        } else {
            char *eq = strchr(s, '=');
            if (eq) {
                *eq = '\0';
                char *k = trim(s);
                char *v = trim(eq + 1);
                /* Strip surrounding quotes if present */
                if ((v[0] == '"' || v[0] == '\'') && v[strlen(v) - 1] == v[0]) {
                    v[strlen(v) - 1] = '\0';
                    v++;
                }
                cJSON_AddStringToObject(current_sec, k, v);
            }
        }
        line = strtok_r(NULL, "\r\n", &saveptr);
    }

    char *out = cJSON_Print(root);
    if (out) {
        printf("%s\n", out);
        free(out);
    }
    cJSON_Delete(root);
    free(copy);
}

static void env_to_json(const char *text) {
    char *copy = strdup(text);
    if (!copy) return;

    cJSON *root = cJSON_CreateObject();
    char *saveptr = NULL;
    char *line = strtok_r(copy, "\r\n", &saveptr);
    while (line) {
        char *s = trim(line);
        if (*s == '#' || *s == '\0') {
            /* comment */
        } else {
            char *eq = strchr(s, '=');
            if (eq) {
                *eq = '\0';
                char *k = trim(s);
                char *v = trim(eq + 1);
                if ((v[0] == '"' || v[0] == '\'') && v[strlen(v) - 1] == v[0]) {
                    v[strlen(v) - 1] = '\0';
                    v++;
                }
                cJSON_AddStringToObject(root, k, v);
            }
        }
        line = strtok_r(NULL, "\r\n", &saveptr);
    }

    char *out = cJSON_Print(root);
    if (out) {
        printf("%s\n", out);
        free(out);
    }
    cJSON_Delete(root);
    free(copy);
}

static void json_to_env(const char *text) {
    cJSON *root = cJSON_Parse(text);
    if (!root || !cJSON_IsObject(root)) {
        if (root) cJSON_Delete(root);
        fprintf(stderr, "json2env: expected JSON object\n");
        return;
    }

    cJSON *child = root->child;
    while (child) {
        if (child->string) {
            if (cJSON_IsString(child)) {
                printf("%s=\"%s\"\n", child->string, child->valuestring);
            } else if (cJSON_IsNumber(child)) {
                if (child->valuedouble == (double)child->valueint) printf("%s=%d\n", child->string, child->valueint);
                else printf("%s=%f\n", child->string, child->valuedouble);
            } else if (cJSON_IsBool(child)) {
                printf("%s=%s\n", child->string, cJSON_IsTrue(child) ? "true" : "false");
            }
        }
        child = child->next;
    }
    cJSON_Delete(root);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int mode = 0; /* 0: ini2json, 1: env2json, 2: json2env */
    if (strstr(prog, "ini2json")) mode = 0;
    else if (strstr(prog, "json2env")) mode = 2;
    else mode = 1;

    FILE *in = stdin;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--ini") == 0) mode = 0;
        else if (strcmp(argv[i], "--env") == 0) mode = 1;
        else if (strcmp(argv[i], "--to-env") == 0) mode = 2;
        else if (argv[i][0] != '-') {
            in = fopen(argv[i], "r");
            if (!in) {
                fprintf(stderr, "%s: %s: No such file\n", prog, argv[i]);
                return 1;
            }
        }
    }

    char *text = read_stream(in);
    if (in != stdin) fclose(in);
    if (!text) return 1;

    if (mode == 0) ini_to_json(text);
    else if (mode == 1) env_to_json(text);
    else json_to_env(text);

    free(text);
    fflush(stdout);
    return 0;
}

