/*
 * csv2json / json2csv / tsv2json / json2tsv - Bidirectional tabular ↔ JSON converter
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "cJSON.h"

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

/* Parse line into fields respecting quotes */
static int parse_fields(char *line, char delimiter, char **fields, int max_fields) {
    int count = 0;
    char *p = line;
    while (*p && count < max_fields) {
        while (*p == ' ' && delimiter != ' ') p++;
        if (*p == '"') {
            p++;
            fields[count++] = p;
            char *dst = p;
            while (*p) {
                if (*p == '"') {
                    if (*(p + 1) == '"') {
                        *dst++ = '"';
                        p += 2;
                    } else {
                        p++;
                        break;
                    }
                } else {
                    *dst++ = *p++;
                }
            }
            *dst = '\0';
            while (*p && *p != delimiter && *p != '\n' && *p != '\r') p++;
            if (*p == delimiter) p++;
        } else {
            fields[count++] = p;
            while (*p && *p != delimiter && *p != '\n' && *p != '\r') p++;
            if (*p) {
                *p++ = '\0';
            }
        }
    }
    return count;
}

static void dsv_to_json(const char *text, char delimiter) {
    char *copy = strdup(text);
    if (!copy) return;

    char *saveptr = NULL;
    char *line = strtok_r(copy, "\r\n", &saveptr);
    if (!line) { free(copy); printf("[]\n"); return; }

    char *headers[256];
    int num_headers = parse_fields(line, delimiter, headers, 256);

    cJSON *arr = cJSON_CreateArray();
    while ((line = strtok_r(NULL, "\r\n", &saveptr))) {
        char *values[256];
        int num_values = parse_fields(line, delimiter, values, 256);
        cJSON *obj = cJSON_CreateObject();
        for (int i = 0; i < num_headers; i++) {
            const char *val = (i < num_values) ? values[i] : "";
            char *endptr;
            double num = strtod(val, &endptr);
            if (*endptr == '\0' && val[0] != '\0') {
                cJSON_AddNumberToObject(obj, headers[i], num);
            } else if (strcmp(val, "true") == 0) {
                cJSON_AddBoolToObject(obj, headers[i], 1);
            } else if (strcmp(val, "false") == 0) {
                cJSON_AddBoolToObject(obj, headers[i], 0);
            } else {
                cJSON_AddStringToObject(obj, headers[i], val);
            }
        }
        cJSON_AddItemToArray(arr, obj);
    }
    char *out = cJSON_Print(arr);
    if (out) {
        printf("%s\n", out);
        free(out);
    }
    cJSON_Delete(arr);
    free(copy);
}

static void json_to_dsv(const char *text, char delimiter) {
    cJSON *root = cJSON_Parse(text);
    if (!root || !cJSON_IsArray(root)) {
        if (root) cJSON_Delete(root);
        fprintf(stderr, "json2csv: expected JSON array of objects\n");
        return;
    }

    /* Collect headers from first object */
    cJSON *first = cJSON_GetArrayItem(root, 0);
    if (!first || !cJSON_IsObject(first)) {
        cJSON_Delete(root);
        return;
    }

    char *headers[256];
    int num_headers = 0;
    cJSON *field = first->child;
    while (field && num_headers < 256) {
        if (field->string) headers[num_headers++] = field->string;
        field = field->next;
    }

    for (int i = 0; i < num_headers; i++) {
        printf("%s%c", headers[i], (i + 1 < num_headers) ? delimiter : '\n');
    }

    int n = cJSON_GetArraySize(root);
    for (int i = 0; i < n; i++) {
        cJSON *item = cJSON_GetArrayItem(root, i);
        if (!cJSON_IsObject(item)) continue;
        for (int h = 0; h < num_headers; h++) {
            cJSON *v = cJSON_GetObjectItem(item, headers[h]);
            if (!v) {
                /* empty */
            } else if (cJSON_IsString(v)) {
                if (strchr(v->valuestring, delimiter) || strchr(v->valuestring, '"') || strchr(v->valuestring, '\n')) {
                    printf("\"");
                    for (char *c = v->valuestring; *c; c++) {
                        if (*c == '"') printf("\"\"");
                        else putchar(*c);
                    }
                    printf("\"");
                } else {
                    printf("%s", v->valuestring);
                }
            } else if (cJSON_IsNumber(v)) {
                if (v->valuedouble == (double)v->valueint) printf("%d", v->valueint);
                else printf("%f", v->valuedouble);
            } else if (cJSON_IsBool(v)) {
                printf("%s", cJSON_IsTrue(v) ? "true" : "false");
            }
            putchar((h + 1 < num_headers) ? delimiter : '\n');
        }
    }
    cJSON_Delete(root);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int to_json = 0;
    char delimiter = ',';
    if (strstr(prog, "csv2json")) { to_json = 1; delimiter = ','; }
    else if (strstr(prog, "tsv2json")) { to_json = 1; delimiter = '\t'; }
    else if (strstr(prog, "json2tsv")) { to_json = 0; delimiter = '\t'; }
    else { to_json = 0; delimiter = ','; }

    FILE *in = stdin;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--tsv") == 0) delimiter = '\t';
        else if (strcmp(argv[i], "--csv") == 0) delimiter = ',';
        else if (strcmp(argv[i], "--to-json") == 0) to_json = 1;
        else if (strcmp(argv[i], "--to-csv") == 0) to_json = 0;
        else if (argv[i][0] != '-') {
            in = fopen(argv[i], "r");
            if (!in) {
                fprintf(stderr, "%s: %s: No such file\n", prog, argv[i]);
                return 1;
            }
        }
    }

    char *content = read_stream(in);
    if (in != stdin) fclose(in);
    if (!content) return 1;

    if (to_json) dsv_to_json(content, delimiter);
    else json_to_dsv(content, delimiter);

    free(content);
    fflush(stdout);
    return 0;
}

