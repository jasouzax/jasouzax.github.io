/*
 * csv_suite - csvsql, csvformat, xlsx2csv, csvjson, in2csv
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include "cJSON.h"

static void parse_csv_line(char *line, char in_delim, char *fields[], int *num_fields, int max_fields) {
    *num_fields = 0;
    char *p = line;
    while (*p && *num_fields < max_fields) {
        while (*p && isspace((unsigned char)*p) && *p != in_delim && *p != '\n') p++;
        if (!*p) break;

        if (*p == '"') {
            p++;
            char *start = p;
            char *write_p = p;
            while (*p) {
                if (*p == '"' && *(p + 1) == '"') {
                    *write_p++ = '"';
                    p += 2;
                } else if (*p == '"') {
                    p++;
                    break;
                } else {
                    *write_p++ = *p++;
                }
            }
            *write_p = '\0';
            fields[(*num_fields)++] = start;
            while (*p && *p != in_delim) p++;
            if (*p == in_delim) p++;
        } else {
            char *start = p;
            while (*p && *p != in_delim && *p != '\r' && *p != '\n') p++;
            char end_c = *p;
            *p = '\0';
            fields[(*num_fields)++] = start;
            if (end_c == in_delim) p++;
        }
    }
}

/* --- 1. csvsql --- */
static void do_csvsql(FILE *f, const char *table_name) {
    char line[4096];
    if (!fgets(line, sizeof(line), f)) return;
    size_t l = strlen(line);
    while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';

    char *headers[64];
    int num_cols = 0;
    parse_csv_line(line, ',', headers, &num_cols, 64);
    if (num_cols == 0) return;

    printf("CREATE TABLE %s (\n", table_name);
    for (int i = 0; i < num_cols; i++) {
        /* Clean column name */
        char col[64];
        int ci = 0;
        for (char *c = headers[i]; *c && ci < 60; c++) {
            if (isalnum((unsigned char)*c) || *c == '_') col[ci++] = *c;
            else col[ci++] = '_';
        }
        col[ci] = '\0';
        printf("  %s TEXT%s\n", col, (i + 1 < num_cols) ? "," : "");
    }
    printf(");\n\n");

    while (fgets(line, sizeof(line), f)) {
        l = strlen(line);
        while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';
        if (l == 0) continue;

        char *values[64];
        int num_vals = 0;
        parse_csv_line(line, ',', values, &num_vals, 64);

        printf("INSERT INTO %s VALUES (", table_name);
        for (int i = 0; i < num_cols; i++) {
            const char *val = (i < num_vals) ? values[i] : "";
            printf("'");
            for (const char *v = val; *v; v++) {
                if (*v == '\'') printf("''");
                else putchar(*v);
            }
            printf("'%s", (i + 1 < num_cols) ? ", " : ");\n");
        }
    }
}

/* --- 2. csvformat --- */
static void do_csvformat(FILE *f, char in_delim, char out_delim) {
    char line[4096];
    while (fgets(line, sizeof(line), f)) {
        size_t l = strlen(line);
        while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';
        if (l == 0) continue;

        char *fields[64];
        int num_fields = 0;
        parse_csv_line(line, in_delim, fields, &num_fields, 64);

        for (int i = 0; i < num_fields; i++) {
            int needs_quote = (strchr(fields[i], out_delim) != NULL || strchr(fields[i], '"') != NULL || strchr(fields[i], '\n') != NULL);
            if (needs_quote) putchar('"');
            for (char *c = fields[i]; *c; c++) {
                if (*c == '"') printf("\"\"");
                else putchar(*c);
            }
            if (needs_quote) putchar('"');
            if (i + 1 < num_fields) putchar(out_delim);
        }
        putchar('\n');
    }
}

/* --- 3. xlsx2csv (parses XML sheet/sharedStrings or raw XML rows) --- */
static void do_xlsx2csv(FILE *f) {
    char line[4096];
    int in_row = 0;
    int first_in_row = 1;

    while (fgets(line, sizeof(line), f)) {
        char *p = line;
        while (*p) {
            if (strncmp(p, "<row", 4) == 0) {
                in_row = 1;
                first_in_row = 1;
                p += 4;
            } else if (strncmp(p, "</row>", 6) == 0) {
                in_row = 0;
                putchar('\n');
                p += 6;
            } else if (strncmp(p, "<v>", 3) == 0 || strncmp(p, "<t>", 3) == 0) {
                p += 3;
                char *end = strstr(p, "</");
                if (end) {
                    if (!first_in_row) putchar(',');
                    first_in_row = 0;
                    *end = '\0';
                    printf("%s", p);
                    p = end + 2;
                }
            } else {
                p++;
            }
        }
    }
}

/* --- 4. csvjson / in2csv --- */
static void do_csvjson(FILE *f) {
    char line[4096];
    if (!fgets(line, sizeof(line), f)) return;
    size_t l = strlen(line);
    while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';

    char *headers[64];
    int num_cols = 0;
    parse_csv_line(line, ',', headers, &num_cols, 64);
    if (num_cols == 0) return;

    cJSON *arr = cJSON_CreateArray();

    while (fgets(line, sizeof(line), f)) {
        l = strlen(line);
        while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';
        if (l == 0) continue;

        char *vals[64];
        int num_vals = 0;
        parse_csv_line(line, ',', vals, &num_vals, 64);

        cJSON *obj = cJSON_CreateObject();
        for (int i = 0; i < num_cols; i++) {
            const char *val = (i < num_vals) ? vals[i] : "";
            char *end;
            double d = strtod(val, &end);
            if (end != val && *end == '\0') {
                cJSON_AddNumberToObject(obj, headers[i], d);
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
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    char in_delim = ',';
    char out_delim = ',';
    const char *table_name = "data";
    const char *path = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-d") == 0 && i + 1 < argc) {
            in_delim = argv[++i][0];
        } else if (strcmp(argv[i], "-D") == 0 && i + 1 < argc) {
            out_delim = (argv[i + 1][0] == 't') ? '\t' : argv[i + 1][0];
            i++;
        } else if (strcmp(argv[i], "--table") == 0 && i + 1 < argc) {
            table_name = argv[++i];
        } else if (argv[i][0] != '-') {
            path = argv[i];
        }
    }

    FILE *f = path ? fopen(path, "r") : stdin;
    if (!f) { perror(path ? path : "stdin"); return 1; }

    if (strstr(prog, "csvsql")) {
        do_csvsql(f, table_name);
    } else if (strstr(prog, "xlsx2csv")) {
        do_xlsx2csv(f);
    } else if (strstr(prog, "csvjson") || strstr(prog, "in2csv")) {
        do_csvjson(f);
    } else {
        do_csvformat(f, in_delim, out_delim);
    }

    if (f != stdin) fclose(f);
    fflush(stdout);
    return 0;
}
