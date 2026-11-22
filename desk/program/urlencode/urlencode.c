/*
 * urlencode - URL percent encoder and decoder
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static void encode_stream(FILE *in, FILE *out) {
    int c;
    while ((c = fgetc(in)) != EOF) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
            fputc(c, out);
        } else if (c == '\n') {
            fputc('\n', out);
        } else {
            fprintf(out, "%%%02X", (unsigned char)c);
        }
    }
    fflush(out);
}

static void decode_stream(FILE *in, FILE *out) {
    int c;
    while ((c = fgetc(in)) != EOF) {
        if (c == '+') {
            fputc(' ', out);
        } else if (c == '%') {
            int h1 = fgetc(in);
            if (h1 == EOF) { fputc('%', out); break; }
            int h2 = fgetc(in);
            if (h2 == EOF) { fputc('%', out); fputc(h1, out); break; }
            int v1 = hex_val(h1), v2 = hex_val(h2);
            if (v1 >= 0 && v2 >= 0) {
                fputc((v1 << 4) | v2, out);
            } else {
                fputc('%', out);
                fputc(h1, out);
                fputc(h2, out);
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

    /* Check program name for urldecode */
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];
    if (strcmp(prog, "urldecode") == 0) decode = 1;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-d") == 0 || strcmp(argv[i], "--decode") == 0) {
            decode = 1;
            arg_start = i + 1;
        } else if (strcmp(argv[i], "-e") == 0 || strcmp(argv[i], "--encode") == 0) {
            decode = 0;
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

