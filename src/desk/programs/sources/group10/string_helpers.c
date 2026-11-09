/*
 * string_helpers - escape-string, unescape-string, count-tokens
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>

/* --- 1. escape-string & unescape-string --- */
typedef enum {
    TYPE_JSON,
    TYPE_JS,
    TYPE_REGEX,
    TYPE_SQL
} escape_type_t;

static void do_escape(const char *in, escape_type_t type) {
    while (*in) {
        char c = *in++;
        if (type == TYPE_SQL) {
            if (c == '\'') printf("''");
            else putchar(c);
        } else if (type == TYPE_REGEX) {
            if (strchr(".^$*+?()[{\\|", c)) {
                putchar('\\');
                putchar(c);
            } else {
                putchar(c);
            }
        } else {
            /* JSON / JS */
            switch (c) {
                case '"':  printf("\\\""); break;
                case '\\': printf("\\\\"); break;
                case '\b': printf("\\b"); break;
                case '\f': printf("\\f"); break;
                case '\n': printf("\\n"); break;
                case '\r': printf("\\r"); break;
                case '\t': printf("\\t"); break;
                default:
                    if ((unsigned char)c < 0x20) {
                        printf("\\u%04x", (unsigned char)c);
                    } else {
                        putchar(c);
                    }
                    break;
            }
        }
    }
    putchar('\n');
}

static void do_unescape(const char *in, escape_type_t type) {
    if (type == TYPE_SQL) {
        while (*in) {
            if (in[0] == '\'' && in[1] == '\'') {
                putchar('\'');
                in += 2;
            } else {
                putchar(*in++);
            }
        }
    } else {
        while (*in) {
            if (*in == '\\' && in[1]) {
                in++;
                switch (*in) {
                    case 'n': putchar('\n'); break;
                    case 'r': putchar('\r'); break;
                    case 't': putchar('\t'); break;
                    case 'b': putchar('\b'); break;
                    case 'f': putchar('\f'); break;
                    case '"': putchar('"'); break;
                    case '\'': putchar('\''); break;
                    case '\\': putchar('\\'); break;
                    case 'u':
                        if (isxdigit((unsigned char)in[1]) && isxdigit((unsigned char)in[2]) &&
                            isxdigit((unsigned char)in[3]) && isxdigit((unsigned char)in[4])) {
                            char hex[5] = {in[1], in[2], in[3], in[4], '\0'};
                            int codepoint = (int)strtol(hex, NULL, 16);
                            if (codepoint < 128) putchar((char)codepoint);
                            else putchar('?');
                            in += 4;
                        } else {
                            putchar('u');
                        }
                        break;
                    default:
                        putchar(*in);
                        break;
                }
                in++;
            } else {
                putchar(*in++);
            }
        }
    }
    putchar('\n');
}

/* --- 2. count-tokens --- */
static void do_count_tokens(FILE *f) {
    size_t chars = 0, words = 0, lines = 0;
    int in_word = 0;
    int c;
    while ((c = fgetc(f)) != EOF) {
        chars++;
        if (c == '\n') lines++;
        if (isspace(c)) {
            in_word = 0;
        } else {
            if (!in_word) {
                words++;
                in_word = 1;
            }
        }
    }

    /* Standard LLM BPE token estimation: ~4 chars per token, ~0.75 words per token */
    size_t tokens_by_chars = (chars + 3) / 4;
    size_t tokens_by_words = (size_t)(words * 1.333);
    size_t estimated_tokens = (tokens_by_chars + tokens_by_words) / 2;
    if (estimated_tokens == 0 && chars > 0) estimated_tokens = 1;

    printf("Characters:       %zu\n", chars);
    printf("Words:            %zu\n", words);
    printf("Lines:            %zu\n", lines);
    printf("Estimated Tokens: %zu (approx. 4 chars/token)\n", estimated_tokens);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "count-tokens") || strstr(prog, "count_tokens")) {
        const char *path = NULL;
        for (int i = 1; i < argc; i++) {
            if (argv[i][0] != '-') { path = argv[i]; break; }
        }
        if (path) {
            FILE *f = fopen(path, "r");
            if (!f) { perror(path); return 1; }
            do_count_tokens(f);
            fclose(f);
        } else {
            do_count_tokens(stdin);
        }
        return 0;
    }

    int is_unescape = (strstr(prog, "unescape") != NULL);
    escape_type_t type = TYPE_JSON;
    const char *input = NULL;

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "-t") == 0 || strcmp(argv[i], "--type") == 0) && i + 1 < argc) {
            const char *t = argv[++i];
            if (strcasecmp(t, "sql") == 0) type = TYPE_SQL;
            else if (strcasecmp(t, "regex") == 0) type = TYPE_REGEX;
            else if (strcasecmp(t, "js") == 0) type = TYPE_JS;
            else type = TYPE_JSON;
        } else if (argv[i][0] != '-') {
            input = argv[i];
        }
    }

    if (input) {
        if (is_unescape) do_unescape(input, type);
        else do_escape(input, type);
    } else {
        char line[4096];
        while (fgets(line, sizeof(line), stdin)) {
            size_t l = strlen(line);
            while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';
            if (is_unescape) do_unescape(line, type);
            else do_escape(line, type);
        }
    }

    fflush(stdout);
    return 0;
}
