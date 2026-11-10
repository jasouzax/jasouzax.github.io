/*
 * htmlencode - HTML entity encoder and decoder
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static void encode_stream(FILE *in, FILE *out) {
    int c;
    while ((c = fgetc(in)) != EOF) {
        switch (c) {
            case '&': fputs("&amp;", out); break;
            case '<': fputs("&lt;", out); break;
            case '>': fputs("&gt;", out); break;
            case '"': fputs("&quot;", out); break;
            case '\'': fputs("&#39;", out); break;
            default: fputc(c, out); break;
        }
    }
    fflush(out);
}

static void decode_stream(FILE *in, FILE *out) {
    int c;
    char entity[32];
    int elen = 0;

    while ((c = fgetc(in)) != EOF) {
        if (c == '&') {
            elen = 0;
            entity[elen++] = '&';
            int match = 0;
            while (elen < 31 && (c = fgetc(in)) != EOF) {
                entity[elen++] = c;
                if (c == ';') { match = 1; break; }
                if (!isalnum(c) && c != '#') break;
            }
            entity[elen] = '\0';
            if (match) {
                if (strcmp(entity, "&amp;") == 0) fputc('&', out);
                else if (strcmp(entity, "&lt;") == 0) fputc('<', out);
                else if (strcmp(entity, "&gt;") == 0) fputc('>', out);
                else if (strcmp(entity, "&quot;") == 0) fputc('"', out);
                else if (strcmp(entity, "&apos;") == 0 || strcmp(entity, "&#39;") == 0) fputc('\'', out);
                else if (entity[1] == '#') {
                    int code = 0;
                    if (entity[2] == 'x' || entity[2] == 'X') {
                        code = (int)strtol(entity + 3, NULL, 16);
                    } else {
                        code = atoi(entity + 2);
                    }
                    if (code > 0 && code <= 255) fputc(code, out);
                    else fputs(entity, out);
                } else {
                    fputs(entity, out);
                }
            } else {
                fputs(entity, out);
            }
        } else {
            fputc(c, out);
        }
    }
    fflush(out);
}

int main(int argc, char **argv) {
    int decode = 0;
    int arg_start = 1;

    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];
    if (strcmp(prog, "htmldecode") == 0) decode = 1;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-d") == 0 || strcmp(argv[i], "--decode") == 0) {
            decode = 1;
            arg_start = i + 1;
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            fprintf(stderr, "Usage: %s [-d|--decode] [string ...]\n", prog);
            return 0;
        } else {
            break;
        }
    }

    if (arg_start < argc) {
        for (int i = arg_start; i < argc; i++) {
            FILE *mem = fmemopen(argv[i], strlen(argv[i]), "r");
            if (mem) {
                if (decode) decode_stream(mem, stdout);
                else encode_stream(mem, stdout);
                fclose(mem);
            }
            if (i + 1 < argc) fputc(' ', stdout);
        }
        fputc('\n', stdout);
        fflush(stdout);
    } else {
        if (decode) decode_stream(stdin, stdout);
        else encode_stream(stdin, stdout);
    }
    return 0;
}

