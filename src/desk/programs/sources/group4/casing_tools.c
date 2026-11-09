/*
 * casing_tools - titlecase, camelcase, snakecase, kebabcase, slugify
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

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

static void do_title(const char *s) {
    int new_word = 1;
    for (; *s; s++) {
        if (isspace((unsigned char)*s)) {
            putchar(*s);
            new_word = 1;
        } else if (new_word) {
            putchar(toupper((unsigned char)*s));
            new_word = 0;
        } else {
            putchar(tolower((unsigned char)*s));
        }
    }
    putchar('\n');
}

static void do_camel(const char *s) {
    int cap_next = 0;
    int first = 1;
    for (; *s; s++) {
        if (!isalnum((unsigned char)*s)) {
            if (!first) cap_next = 1;
        } else {
            if (cap_next) {
                putchar(toupper((unsigned char)*s));
                cap_next = 0;
            } else if (first) {
                putchar(tolower((unsigned char)*s));
                first = 0;
            } else {
                putchar(*s);
            }
        }
    }
    putchar('\n');
}

static void do_delimiter(const char *s, char delim) {
    int prev_alnum = 0;
    for (; *s; s++) {
        if (isalnum((unsigned char)*s)) {
            if (isupper((unsigned char)*s) && prev_alnum && islower((unsigned char)*(s - 1))) {
                putchar(delim);
            }
            putchar(tolower((unsigned char)*s));
            prev_alnum = 1;
        } else {
            if (prev_alnum) {
                putchar(delim);
                prev_alnum = 0;
            }
        }
    }
    putchar('\n');
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int mode = 0; /* 0: title, 1: camel, 2: snake, 3: kebab/slugify */
    if (strstr(prog, "title")) mode = 0;
    else if (strstr(prog, "camel")) mode = 1;
    else if (strstr(prog, "snake")) mode = 2;
    else mode = 3;

    char *input = NULL;
    if (argc > 1) {
        size_t total = 0;
        for (int i = 1; i < argc; i++) total += strlen(argv[i]) + 1;
        input = malloc(total + 1);
        input[0] = '\0';
        for (int i = 1; i < argc; i++) {
            strcat(input, argv[i]);
            if (i + 1 < argc) strcat(input, " ");
        }
    } else {
        input = read_stream(stdin);
    }

    if (!input) return 0;

    char *saveptr = NULL;
    char *line = strtok_r(input, "\r\n", &saveptr);
    while (line) {
        if (mode == 0) do_title(line);
        else if (mode == 1) do_camel(line);
        else if (mode == 2) do_delimiter(line, '_');
        else do_delimiter(line, '-');
        line = strtok_r(NULL, "\r\n", &saveptr);
    }

    free(input);
    fflush(stdout);
    return 0;
}
