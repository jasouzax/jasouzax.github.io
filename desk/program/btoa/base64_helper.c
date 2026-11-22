/*
 * atob / btoa - Base64 binary and text conversion helper
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static int b64_index(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

static void encode_b64(FILE *in, FILE *out) {
    unsigned char buf[3];
    size_t n;
    while ((n = fread(buf, 1, 3, in)) > 0) {
        unsigned char b0 = buf[0];
        unsigned char b1 = n > 1 ? buf[1] : 0;
        unsigned char b2 = n > 2 ? buf[2] : 0;

        fputc(b64_table[b0 >> 2], out);
        fputc(b64_table[((b0 & 0x03) << 4) | (b1 >> 4)], out);
        fputc(n > 1 ? b64_table[((b1 & 0x0F) << 2) | (b2 >> 6)] : '=', out);
        fputc(n > 2 ? b64_table[b2 & 0x3F] : '=', out);
    }
    fputc('\n', out);
    fflush(out);
}

static void decode_b64(FILE *in, FILE *out) {
    int c;
    int sextet[4];
    int count = 0;

    while ((c = fgetc(in)) != EOF) {
        if (c == '=' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '+' || c == '/') {
            sextet[count++] = c;
            if (count == 4) {
                int s0 = b64_index(sextet[0]);
                int s1 = b64_index(sextet[1]);
                int s2 = sextet[2] == '=' ? 0 : b64_index(sextet[2]);
                int s3 = sextet[3] == '=' ? 0 : b64_index(sextet[3]);

                if (s0 >= 0 && s1 >= 0) {
                    fputc((s0 << 2) | (s1 >> 4), out);
                    if (sextet[2] != '=') fputc(((s1 & 0x0F) << 4) | (s2 >> 2), out);
                    if (sextet[3] != '=') fputc(((s2 & 0x03) << 6) | s3, out);
                }
                count = 0;
            }
        }
    }
    fflush(out);
}

int main(int argc, char **argv) {
    int decode = 0;
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];
    if (strcmp(prog, "atob") == 0) decode = 1;

    int arg_start = 1;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-d") == 0) {
            decode = 1;
            arg_start = i + 1;
        } else if (strcmp(argv[i], "-e") == 0) {
            decode = 0;
            arg_start = i + 1;
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            fprintf(stderr, "Usage: %s [string ...]\n", prog);
            return 0;
        } else {
            break;
        }
    }

    if (arg_start < argc) {
        for (int i = arg_start; i < argc; i++) {
            FILE *mem = fmemopen(argv[i], strlen(argv[i]), "r");
            if (mem) {
                if (decode) decode_b64(mem, stdout);
                else encode_b64(mem, stdout);
                fclose(mem);
            }
        }
    } else {
        if (decode) decode_b64(stdin, stdout);
        else encode_b64(stdin, stdout);
    }
    return 0;
}

