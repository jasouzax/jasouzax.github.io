/*
 * qr_main - QR code generator for terminal
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include "qrcodegen.h"

int main(int argc, char **argv) {
    const char *text = NULL;
    int ascii_mode = 0;
    int invert = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-a") == 0 || strcmp(argv[i], "--ascii") == 0) ascii_mode = 1;
        else if (strcmp(argv[i], "-i") == 0 || strcmp(argv[i], "--invert") == 0) invert = 1;
        else if (argv[i][0] != '-') text = argv[i];
    }

    char stdin_buf[4096];
    if (!text) {
        if (fgets(stdin_buf, sizeof(stdin_buf), stdin)) {
            size_t l = strlen(stdin_buf);
            while (l > 0 && (stdin_buf[l - 1] == '\n' || stdin_buf[l - 1] == '\r')) stdin_buf[--l] = '\0';
            text = stdin_buf;
        }
    }

    if (!text || !*text) {
        fprintf(stderr, "Usage: qr <text|url>\n");
        return 1;
    }

    uint8_t qrcode[qrcodegen_BUFFER_LEN_MAX];
    uint8_t tempBuffer[qrcodegen_BUFFER_LEN_MAX];
    bool ok = qrcodegen_encodeText(text, tempBuffer, qrcode,
                                   qrcodegen_Ecc_LOW,
                                   qrcodegen_VERSION_MIN,
                                   qrcodegen_VERSION_MAX,
                                   qrcodegen_Mask_AUTO, true);
    if (!ok) {
        fprintf(stderr, "Failed to encode QR code\n");
        return 1;
    }

    int size = qrcodegen_getSize(qrcode);
    int border = 2;

    /* Print top border */
    for (int y = -border; y < size + border; y++) {
        for (int x = -border; x < size + border; x++) {
            bool dark = (x >= 0 && x < size && y >= 0 && y < size) ? qrcodegen_getModule(qrcode, x, y) : false;
            if (invert) dark = !dark;

            if (ascii_mode) {
                printf(dark ? "##" : "  ");
            } else {
                /* UTF-8 full block (U+2588) is 0xE2 0x96 0x88 */
                if (dark) printf("\xe2\x96\x88\xe2\x96\x88");
                else printf("  ");
            }
        }
        putchar('\n');
    }

    fflush(stdout);
    return 0;
}
