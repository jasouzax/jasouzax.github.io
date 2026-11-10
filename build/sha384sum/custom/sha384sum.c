/*
 * sha384sum - Compute SHA-384 message digests
 * Uses IETF RFC 6234 standard implementation
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "sha.h"

static int hash_file(FILE *f, const char *filename) {
    SHA384Context ctx;
    uint8_t digest[SHA384HashSize];
    uint8_t buf[8192];
    size_t n;

    if (SHA384Reset(&ctx) != shaSuccess) {
        fprintf(stderr, "sha384sum: context initialization failed\n");
        return 1;
    }

    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        if (SHA384Input(&ctx, buf, (unsigned int)n) != shaSuccess) {
            fprintf(stderr, "sha384sum: hash update failed for %s\n", filename);
            return 1;
        }
    }

    if (ferror(f)) {
        fprintf(stderr, "sha384sum: read error on %s\n", filename);
        return 1;
    }

    if (SHA384Result(&ctx, digest) != shaSuccess) {
        fprintf(stderr, "sha384sum: hash finalization failed for %s\n", filename);
        return 1;
    }

    for (int i = 0; i < SHA384HashSize; i++) {
        printf("%02x", digest[i]);
    }
    printf("  %s\n", filename);
    fflush(stdout);
    return 0;
}

int main(int argc, char **argv) {
    int status = 0;
    int files_given = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            fprintf(stderr, "Usage: sha384sum [FILE...]\n");
            return 0;
        }
        if (strcmp(argv[i], "--version") == 0) {
            printf("sha384sum (RFC 6234 standard) 1.0.0\n");
            fflush(stdout);
            return 0;
        }
    }

    for (int i = 1; i < argc; i++) {
        if (argv[i][0] == '-' && argv[i][1] == '\0') {
            files_given = 1;
            status |= hash_file(stdin, "-");
        } else if (argv[i][0] != '-') {
            files_given = 1;
            FILE *f = fopen(argv[i], "rb");
            if (!f) {
                fprintf(stderr, "sha384sum: %s: No such file or directory\n", argv[i]);
                status = 1;
                continue;
            }
            status |= hash_file(f, argv[i]);
            fclose(f);
        }
    }

    if (!files_given) {
        status = hash_file(stdin, "-");
    }

    return status;
}
