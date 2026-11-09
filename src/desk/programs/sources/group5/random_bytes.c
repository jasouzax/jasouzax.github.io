/*
 * random_bytes - Cryptographic random byte generator
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void print_b64(const unsigned char *data, size_t len) {
    for (size_t i = 0; i < len; i += 3) {
        unsigned int val = (data[i] << 16) |
                           ((i + 1 < len ? data[i + 1] : 0) << 8) |
                           (i + 2 < len ? data[i + 2] : 0);
        putchar(b64_table[(val >> 18) & 0x3f]);
        putchar(b64_table[(val >> 12) & 0x3f]);
        putchar((i + 1 < len) ? b64_table[(val >> 6) & 0x3f] : '=');
        putchar((i + 2 < len) ? b64_table[val & 0x3f] : '=');
    }
    putchar('\n');
}

int main(int argc, char **argv) {
    int count = 16;
    int mode = 0; /* 0 = hex, 1 = raw, 2 = base64, 3 = space-hex */

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "-n") == 0 || strcmp(argv[i], "--bytes") == 0) && i + 1 < argc) {
            count = atoi(argv[++i]);
        } else if (strcmp(argv[i], "-r") == 0 || strcmp(argv[i], "--raw") == 0) {
            mode = 1;
        } else if (strcmp(argv[i], "-b") == 0 || strcmp(argv[i], "--base64") == 0) {
            mode = 2;
        } else if (strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "--space") == 0) {
            mode = 3;
        } else if (argv[i][0] != '-') {
            count = atoi(argv[i]);
        }
    }

    if (count <= 0) count = 16;
    if (count > 1048576) count = 1048576;

    FILE *f = fopen("/dev/urandom", "rb");
    if (!f) {
        /* Fallback to rand() if /dev/urandom is unavailable */
        unsigned char *buf = malloc(count);
        if (!buf) return 1;
        for (int i = 0; i < count; i++) buf[i] = rand() & 0xff;
        if (mode == 1) {
            fwrite(buf, 1, count, stdout);
        } else if (mode == 2) {
            print_b64(buf, count);
        } else {
            for (int i = 0; i < count; i++) {
                printf(mode == 3 ? "%02x " : "%02x", buf[i]);
            }
            putchar('\n');
        }
        free(buf);
        return 0;
    }

    unsigned char *buf = malloc(count);
    if (!buf) {
        fclose(f);
        return 1;
    }

    size_t read_bytes = fread(buf, 1, count, f);
    fclose(f);

    if (read_bytes < (size_t)count) {
        /* Fill remainder with pseudo-random */
        for (size_t i = read_bytes; i < (size_t)count; i++) buf[i] = rand() & 0xff;
    }

    if (mode == 1) {
        fwrite(buf, 1, count, stdout);
    } else if (mode == 2) {
        print_b64(buf, count);
    } else {
        for (int i = 0; i < count; i++) {
            printf(mode == 3 ? "%02x " : "%02x", buf[i]);
        }
        putchar('\n');
    }

    free(buf);
    fflush(stdout);
    return 0;
}
