/*
 * json2yaml - JSON to YAML converter
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"

static void print_indent(int level) {
    for (int i = 0; i < level * 2; i++) putchar(' ');
}

static void print_yaml(const cJSON *item, int level, int in_array) {
    if (!item) return;

    if (cJSON_IsObject(item)) {
        cJSON *child = item->child;
        if (!child) {
            printf("{}\n");
            return;
        }
        if (in_array) printf("\n");
        while (child) {
            print_indent(level);
            printf("%s: ", child->string ? child->string : "item");
            if (cJSON_IsObject(child) || cJSON_IsArray(child)) {
                if (cJSON_GetArraySize(child) == 0) {
                    printf("%s\n", cJSON_IsObject(child) ? "{}" : "[]");
                } else {
                    printf("\n");
                    print_yaml(child, level + 1, 0);
                }
            } else {
                print_yaml(child, level, 0);
            }
            child = child->next;
        }
    } else if (cJSON_IsArray(item)) {
        cJSON *child = item->child;
        if (!child) {
            printf("[]\n");
            return;
        }
        if (in_array) printf("\n");
        while (child) {
            print_indent(level);
            printf("- ");
            if (cJSON_IsObject(child)) {
                cJSON *field = child->child;
                if (field) {
                    printf("%s: ", field->string ? field->string : "item");
                    if (cJSON_IsObject(field) || cJSON_IsArray(field)) {
                        printf("\n");
                        print_yaml(field, level + 2, 0);
                    } else {
                        print_yaml(field, level, 0);
                    }
                    field = field->next;
                    while (field) {
                        print_indent(level + 1);
                        printf("%s: ", field->string ? field->string : "item");
                        if (cJSON_IsObject(field) || cJSON_IsArray(field)) {
                            printf("\n");
                            print_yaml(field, level + 2, 0);
                        } else {
                            print_yaml(field, level, 0);
                        }
                        field = field->next;
                    }
                } else {
                    printf("{}\n");
                }
            } else if (cJSON_IsArray(child)) {
                printf("\n");
                print_yaml(child, level + 1, 1);
            } else {
                print_yaml(child, level, 0);
            }
            child = child->next;
        }
    } else if (cJSON_IsString(item)) {
        const char *s = item->valuestring ? item->valuestring : "";
        if (strchr(s, ':') || strchr(s, '#') || strchr(s, '\n') || s[0] == '\0') {
            printf("\"%s\"\n", s);
        } else {
            printf("%s\n", s);
        }
    } else if (cJSON_IsNumber(item)) {
        if (item->valuedouble == (double)item->valueint) printf("%d\n", item->valueint);
        else printf("%f\n", item->valuedouble);
    } else if (cJSON_IsBool(item)) {
        printf("%s\n", cJSON_IsTrue(item) ? "true" : "false");
    } else if (cJSON_IsNull(item)) {
        printf("null\n");
    }
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

int main(int argc, char **argv) {
    FILE *in = stdin;
    if (argc > 1 && argv[1][0] != '-') {
        in = fopen(argv[1], "r");
        if (!in) {
            fprintf(stderr, "json2yaml: %s: No such file or directory\n", argv[1]);
            return 1;
        }
    }

    char *text = read_stream(in);
    if (in != stdin) fclose(in);
    if (!text) return 1;

    cJSON *parsed = cJSON_Parse(text);
    free(text);
    if (!parsed) {
        fprintf(stderr, "json2yaml: invalid JSON input\n");
        return 1;
    }

    print_yaml(parsed, 0, 0);
    cJSON_Delete(parsed);
    fflush(stdout);
    return 0;
}

