/*
 * rot13 - ROT13 substitution cipher
 * Public Domain / MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int rot13_char(int c) {
    if (c >= 'a' && c <= 'z') return 'a' + ((c - 'a' + 13) % 26);
    if (c >= 'A' && c <= 'Z') return 'A' + ((c - 'A' + 13) % 26);
    return c;
}

int main(int argc, char **argv) {
    if (argc > 1) {
        if (strcmp(argv[1], "-h") == 0 || strcmp(argv[1], "--help") == 0) {
            fprintf(stderr, "Usage: rot13 [string ...]\n");
            return 0;
        }
        for (int i = 1; i < argc; i++) {
            for (char *p = argv[i]; *p; p++) {
                fputc(rot13_char((unsigned char)*p), stdout);
            }
            if (i + 1 < argc) fputc(' ', stdout);
        }
        fputc('\n', stdout);
        fflush(stdout);
    } else {
        int c;
        while ((c = fgetc(stdin)) != EOF) {
            fputc(rot13_char(c), stdout);
        }
        fflush(stdout);
    }
    return 0;
}

