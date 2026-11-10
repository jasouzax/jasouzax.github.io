/*
 * uuid_token - UUID v4 (uuidgen, uuidgen-js) and nanoid token generator
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static void get_random_bytes(unsigned char *buf, size_t len) {
    FILE *f = fopen("/dev/urandom", "rb");
    if (f) {
        size_t n = fread(buf, 1, len, f);
        fclose(f);
        if (n == len) return;
        for (size_t i = n; i < len; i++) buf[i] = (unsigned char)(rand() & 0xff);
    } else {
        for (size_t i = 0; i < len; i++) buf[i] = (unsigned char)(rand() & 0xff);
    }
}

static void gen_uuid(int uppercase) {
    unsigned char b[16];
    get_random_bytes(b, 16);

    /* Set version to 4 (0100) */
    b[6] = (b[6] & 0x0f) | 0x40;
    /* Set variant to RFC 4122 (10xx) */
    b[8] = (b[8] & 0x3f) | 0x80;

    const char *fmt = uppercase
        ? "%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X\n"
        : "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x\n";

    printf(fmt,
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]);
}

static const char default_nanoid_alphabet[] = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

static void gen_nanoid(int size, const char *alphabet) {
    if (size <= 0) size = 21;
    size_t alpha_len = strlen(alphabet);
    if (alpha_len == 0) return;

    unsigned char *bytes = malloc(size);
    if (!bytes) return;
    get_random_bytes(bytes, size);

    for (int i = 0; i < size; i++) {
        putchar(alphabet[bytes[i] % alpha_len]);
    }
    putchar('\n');
    free(bytes);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int is_nanoid = (strstr(prog, "nanoid") != NULL);
    int count = 1;
    int size = 21;
    int uppercase = 0;
    const char *alphabet = default_nanoid_alphabet;

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "-n") == 0 || strcmp(argv[i], "--count") == 0) && i + 1 < argc) {
            count = atoi(argv[++i]);
        } else if ((strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "-l") == 0 || strcmp(argv[i], "--size") == 0 || strcmp(argv[i], "--length") == 0) && i + 1 < argc) {
            size = atoi(argv[++i]);
        } else if ((strcmp(argv[i], "-a") == 0 || strcmp(argv[i], "--alphabet") == 0) && i + 1 < argc) {
            alphabet = argv[++i];
        } else if (strcmp(argv[i], "-u") == 0 || strcmp(argv[i], "--upper") == 0) {
            uppercase = 1;
        } else if (argv[i][0] != '-') {
            int val = atoi(argv[i]);
            if (val > 0) {
                if (is_nanoid) size = val;
                else count = val;
            }
        }
    }

    if (count <= 0) count = 1;
    if (count > 100000) count = 100000;

    for (int i = 0; i < count; i++) {
        if (is_nanoid) {
            gen_nanoid(size, alphabet);
        } else {
            gen_uuid(uppercase);
        }
    }

    fflush(stdout);
    return 0;
}
