/*
 * file_analysis - entropy, detect-encoding, file-info
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <sys/stat.h>
#include <time.h>
#include <ctype.h>

/* --- 1. entropy --- */
static void do_entropy(int argc, char **argv) {
    FILE *f = stdin;
    const char *path = NULL;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') {
            path = argv[i];
            break;
        }
    }
    if (path) {
        f = fopen(path, "rb");
        if (!f) {
            perror(path);
            return;
        }
    }

    unsigned long counts[256] = {0};
    unsigned long total = 0;
    unsigned char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        for (size_t i = 0; i < n; i++) {
            counts[buf[i]]++;
        }
        total += n;
    }
    if (f != stdin) fclose(f);

    if (total == 0) {
        printf("Entropy: 0.000000 bits per byte (empty input)\n");
        return;
    }

    double entropy = 0.0;
    int unique = 0;
    for (int i = 0; i < 256; i++) {
        if (counts[i] > 0) {
            unique++;
            double p = (double)counts[i] / total;
            entropy -= p * (log(p) / log(2.0));
        }
    }

    const char *interp = "Low entropy (likely plain text or highly repetitive)";
    if (entropy > 7.5) interp = "Very high entropy (likely encrypted or compressed data)";
    else if (entropy > 6.0) interp = "Moderate-high entropy (mixed binary or structured data)";
    else if (entropy > 4.5) interp = "Moderate entropy (typical formatted text, markup, code)";

    printf("Bytes:       %lu\n", total);
    printf("Unique:      %d / 256\n", unique);
    printf("Entropy:     %.6f bits/byte (max 8.0)\n", entropy);
    printf("Assessment:  %s\n", interp);
}

/* --- 2. detect-encoding --- */
static void do_detect_encoding(int argc, char **argv) {
    FILE *f = stdin;
    const char *path = NULL;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') {
            path = argv[i];
            break;
        }
    }
    if (path) {
        f = fopen(path, "rb");
        if (!f) {
            perror(path);
            return;
        }
    }

    unsigned char buf[8192];
    size_t len = fread(buf, 1, sizeof(buf), f);
    if (f != stdin) fclose(f);

    if (len == 0) {
        printf("Encoding: Empty\n");
        return;
    }

    /* Check BOMs */
    if (len >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf) {
        printf("Encoding: UTF-8 with BOM\n");
        return;
    }
    if (len >= 4 && buf[0] == 0xff && buf[1] == 0xfe && buf[2] == 0x00 && buf[3] == 0x00) {
        printf("Encoding: UTF-32LE with BOM\n");
        return;
    }
    if (len >= 4 && buf[0] == 0x00 && buf[1] == 0x00 && buf[2] == 0xfe && buf[3] == 0xff) {
        printf("Encoding: UTF-32BE with BOM\n");
        return;
    }
    if (len >= 2 && buf[0] == 0xff && buf[1] == 0xfe) {
        printf("Encoding: UTF-16LE with BOM\n");
        return;
    }
    if (len >= 2 && buf[0] == 0xfe && buf[1] == 0xff) {
        printf("Encoding: UTF-16BE with BOM\n");
        return;
    }

    /* Check ASCII */
    int is_ascii = 1;
    int has_null = 0;
    for (size_t i = 0; i < len; i++) {
        if (buf[i] == 0) has_null = 1;
        if (buf[i] >= 128) is_ascii = 0;
    }
    if (is_ascii && !has_null) {
        printf("Encoding: US-ASCII (7-bit)\n");
        return;
    }

    if (has_null) {
        printf("Encoding: Binary / Unknown\n");
        return;
    }

    /* Validate UTF-8 */
    int is_utf8 = 1;
    size_t i = 0;
    while (i < len) {
        if (buf[i] < 0x80) {
            i++;
        } else if ((buf[i] & 0xe0) == 0xc0) {
            if (i + 1 >= len || (buf[i + 1] & 0xc0) != 0x80) { is_utf8 = 0; break; }
            i += 2;
        } else if ((buf[i] & 0xf0) == 0xe0) {
            if (i + 2 >= len || (buf[i + 1] & 0xc0) != 0x80 || (buf[i + 2] & 0xc0) != 0x80) { is_utf8 = 0; break; }
            i += 3;
        } else if ((buf[i] & 0xf8) == 0xf0) {
            if (i + 3 >= len || (buf[i + 1] & 0xc0) != 0x80 || (buf[i + 2] & 0xc0) != 0x80 || (buf[i + 3] & 0xc0) != 0x80) { is_utf8 = 0; break; }
            i += 4;
        } else {
            is_utf8 = 0;
            break;
        }
    }

    if (is_utf8) {
        printf("Encoding: UTF-8\n");
    } else {
        printf("Encoding: ISO-8859-1 / Windows-1252 (8-bit)\n");
    }
}

/* --- 3. file-info --- */
static void do_file_info(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: file-info <file>\n");
        return;
    }

    for (int i = 1; i < argc; i++) {
        if (argv[i][0] == '-') continue;
        const char *path = argv[i];
        struct stat st;
        if (stat(path, &st) != 0) {
            perror(path);
            continue;
        }

        const char *type = "Regular file";
        if (S_ISDIR(st.st_mode)) type = "Directory";
        else if (S_ISCHR(st.st_mode)) type = "Character device";
        else if (S_ISBLK(st.st_mode)) type = "Block device";
        else if (S_ISFIFO(st.st_mode)) type = "FIFO / Named pipe";
        else if (S_ISLNK(st.st_mode)) type = "Symbolic link";

        char time_buf[64];
        struct tm *tm = localtime(&st.st_mtime);
        if (tm) strftime(time_buf, sizeof(time_buf), "%Y-%m-%d %H:%M:%S", tm);
        else strcpy(time_buf, "unknown");

        printf("File:        %s\n", path);
        printf("Type:        %s\n", type);
        printf("Size:        %lld bytes\n", (long long)st.st_size);
        printf("Permissions: 0%o\n", (unsigned int)(st.st_mode & 0777));
        printf("Modified:    %s\n", time_buf);

        if (S_ISREG(st.st_mode) && st.st_size > 0) {
            FILE *f = fopen(path, "rb");
            if (f) {
                unsigned char magic[8];
                size_t mlen = fread(magic, 1, sizeof(magic), f);
                fclose(f);
                printf("Header:      ");
                for (size_t b = 0; b < mlen; b++) printf("%02x ", magic[b]);
                printf("\n");
            }
        }
    }
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "detect-encoding") || strstr(prog, "detect_encoding")) {
        do_detect_encoding(argc, argv);
    } else if (strstr(prog, "file-info") || strstr(prog, "file_info")) {
        do_file_info(argc, argv);
    } else {
        do_entropy(argc, argv);
    }

    fflush(stdout);
    return 0;
}
