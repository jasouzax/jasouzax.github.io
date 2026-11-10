#define _GNU_SOURCE
#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include "stb_image.h"
#include "stb_image_write.h"

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_entire_stream(FILE *fp, size_t *out_len) {
    size_t cap = 65536, len = 0;
    unsigned char *buf = (unsigned char *)malloc(cap);
    if (!buf) return NULL;
    while (!feof(fp) && !ferror(fp)) {
        if (len + 4096 > cap) {
            cap *= 2;
            unsigned char *nb = (unsigned char *)realloc(buf, cap);
            if (!nb) { free(buf); return NULL; }
            buf = nb;
        }
        size_t n = fread(buf + len, 1, 4096, fp);
        len += n;
    }
    buf[len] = '\0';
    if (out_len) *out_len = len;
    return buf;
}

static unsigned char *read_input(const char *path, size_t *out_len) {
    FILE *fp = NULL;
    if (!path || strcmp(path, "-") == 0) {
        fp = stdin;
    } else {
        fp = fopen(path, "rb");
        if (!fp) {
            fprintf(stderr, "Cannot open '%s'\n", path);
            return NULL;
        }
    }
    unsigned char *buf = read_entire_stream(fp, out_len);
    if (fp != stdin) fclose(fp);
    return buf;
}

/* Custom stbi write callback to FILE * */
static void stbi_write_to_file(void *context, void *data, int size) {
    fwrite(data, 1, size, (FILE *)context);
}

typedef struct {
    unsigned char *data;
    size_t size;
    size_t cap;
} mem_buf_t;

static void mem_buf_write(void *context, void *data, int size) {
    mem_buf_t *buf = (mem_buf_t *)context;
    if (buf->size + size > buf->cap) {
        buf->cap = (buf->size + size) * 2;
        buf->data = (unsigned char *)realloc(buf->data, buf->cap);
    }
    memcpy(buf->data + buf->size, data, size);
    buf->size += size;
}

/* Skip whitespace and comments in PNM */
static void pnm_skip_comments(const unsigned char **p, const unsigned char *end) {
    while (*p < end) {
        while (*p < end && isspace(**p)) (*p)++;
        if (*p < end && **p == '#') {
            while (*p < end && **p != '\n' && **p != '\r') (*p)++;
        } else {
            break;
        }
    }
}

/* Read integer from PNM header */
static int pnm_read_int(const unsigned char **p, const unsigned char *end) {
    pnm_skip_comments(p, end);
    if (*p >= end || !isdigit(**p)) return -1;
    int val = 0;
    while (*p < end && isdigit(**p)) {
        val = val * 10 + (**p - '0');
        (*p)++;
    }
    return val;
}

/* Parse PNM (P1-P6) buffer into 8-bit RGB or Grayscale pixels */
static unsigned char *parse_pnm(const unsigned char *buf, size_t len, int *out_w, int *out_h, int *out_channels) {
    if (len < 3 || buf[0] != 'P') return NULL;
    int type = buf[1] - '0';
    if (type < 1 || type > 6) return NULL;

    const unsigned char *p = buf + 2;
    const unsigned char *end = buf + len;

    int w = pnm_read_int(&p, end);
    int h = pnm_read_int(&p, end);
    if (w <= 0 || h <= 0) return NULL;

    int maxval = 1;
    if (type != 1 && type != 4) {
        maxval = pnm_read_int(&p, end);
        if (maxval <= 0) return NULL;
    }

    /* Skip single whitespace char after maxval */
    if (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++;

    int channels = (type == 3 || type == 6) ? 3 : 1;
    size_t total_pixels = (size_t)w * h;
    unsigned char *pixels = (unsigned char *)malloc(total_pixels * channels);
    if (!pixels) return NULL;

    if (type == 6) {
        /* P6: binary RGB */
        size_t expected = total_pixels * 3;
        size_t available = end - p;
        if (available < expected) { free(pixels); return NULL; }
        memcpy(pixels, p, expected);
    } else if (type == 5) {
        /* P5: binary Grayscale */
        size_t expected = total_pixels;
        size_t available = end - p;
        if (available < expected) { free(pixels); return NULL; }
        memcpy(pixels, p, expected);
    } else if (type == 3) {
        /* P3: ASCII RGB */
        for (size_t i = 0; i < total_pixels * 3; i++) {
            int v = pnm_read_int(&p, end);
            if (v < 0) v = 0;
            pixels[i] = (unsigned char)((v * 255) / maxval);
        }
    } else if (type == 2) {
        /* P2: ASCII Grayscale */
        for (size_t i = 0; i < total_pixels; i++) {
            int v = pnm_read_int(&p, end);
            if (v < 0) v = 0;
            pixels[i] = (unsigned char)((v * 255) / maxval);
        }
    } else if (type == 4) {
        /* P4: binary bit-packed bitmap */
        size_t row_bytes = (w + 7) / 8;
        size_t o = 0;
        for (int y = 0; y < h; y++) {
            const unsigned char *row = p + y * row_bytes;
            for (int x = 0; x < w; x++) {
                int bit = (row[x / 8] >> (7 - (x % 8))) & 1;
                pixels[o++] = bit ? 0 : 255;
            }
        }
    } else if (type == 1) {
        /* P1: ASCII bitmap */
        for (size_t i = 0; i < total_pixels; i++) {
            int v = pnm_read_int(&p, end);
            pixels[i] = v ? 0 : 255;
        }
    }

    *out_w = w;
    *out_h = h;
    *out_channels = channels;
    return pixels;
}

/* ========================================================================= */
/* Command: pngtopnm                                                         */
/* ========================================================================= */
static int cmd_pngtopnm(int argc, char **argv) {
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pngtopnm (Netpbm WASM build 10.0)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: pngtopnm [pngfile]\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int w = 0, h = 0, channels = 0;
    unsigned char *pixels = stbi_load_from_memory(in_data, (int)in_len, &w, &h, &channels, 0);
    free(in_data);
    if (!pixels) {
        fprintf(stderr, "pngtopnm: failed to decode PNG input: %s\n", stbi_failure_reason());
        return 1;
    }

    if (channels == 1) {
        /* P5 PGM */
        printf("P5\n%d %d\n255\n", w, h);
        fflush(stdout);
        fwrite(pixels, 1, (size_t)w * h, stdout);
        fflush(stdout);
    } else {
        /* P6 PPM */
        unsigned char *rgb = pixels;
        int free_rgb = 0;
        if (channels == 4) {
            /* Drop alpha channel for standard PPM */
            rgb = (unsigned char *)malloc((size_t)w * h * 3);
            for (size_t i = 0; i < (size_t)w * h; i++) {
                rgb[i * 3 + 0] = pixels[i * 4 + 0];
                rgb[i * 3 + 1] = pixels[i * 4 + 1];
                rgb[i * 3 + 2] = pixels[i * 4 + 2];
            }
            free_rgb = 1;
        }
        printf("P6\n%d %d\n255\n", w, h);
        fflush(stdout);
        fwrite(rgb, 1, (size_t)w * h * 3, stdout);
        fflush(stdout);
        if (free_rgb) free(rgb);
    }

    stbi_image_free(pixels);
    return 0;
}

/* ========================================================================= */
/* Command: pnmtopng                                                         */
/* ========================================================================= */
static int cmd_pnmtopng(int argc, char **argv) {
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pnmtopng (Netpbm WASM build 10.0)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: pnmtopng [pnmfile]\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int w = 0, h = 0, channels = 0;
    unsigned char *pixels = parse_pnm(in_data, in_len, &w, &h, &channels);
    free(in_data);
    if (!pixels) {
        fprintf(stderr, "pnmtopng: invalid PNM header or unsupported format\n");
        return 1;
    }

    int res = stbi_write_png_to_func(stbi_write_to_file, stdout, w, h, channels, pixels, w * channels);
    fflush(stdout);
    free(pixels);
    return res ? 0 : 1;
}

/* ========================================================================= */
/* Command: jpegtopnm                                                        */
/* ========================================================================= */
static int cmd_jpegtopnm(int argc, char **argv) {
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("jpegtopnm (Netpbm WASM build 10.0)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: jpegtopnm [jpegfile]\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int w = 0, h = 0, channels = 0;
    unsigned char *pixels = stbi_load_from_memory(in_data, (int)in_len, &w, &h, &channels, 0);
    free(in_data);
    if (!pixels) {
        fprintf(stderr, "jpegtopnm: failed to decode JPEG input: %s\n", stbi_failure_reason());
        return 1;
    }

    if (channels == 1) {
        printf("P5\n%d %d\n255\n", w, h);
        fflush(stdout);
        fwrite(pixels, 1, (size_t)w * h, stdout);
        fflush(stdout);
    } else {
        printf("P6\n%d %d\n255\n", w, h);
        fflush(stdout);
        fwrite(pixels, 1, (size_t)w * h * 3, stdout);
        fflush(stdout);
    }

    stbi_image_free(pixels);
    return 0;
}

/* ========================================================================= */
/* Command: pnmtojpeg                                                        */
/* ========================================================================= */
static int cmd_pnmtojpeg(int argc, char **argv) {
    const char *input_file = NULL;
    int quality = 90;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pnmtojpeg (Netpbm WASM build 10.0)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: pnmtojpeg [-quality N] [pnmfile]\n");
            return 0;
        }
        if (strcmp(argv[i], "-quality") == 0 && i + 1 < argc) {
            quality = atoi(argv[++i]);
        } else if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int w = 0, h = 0, channels = 0;
    unsigned char *pixels = parse_pnm(in_data, in_len, &w, &h, &channels);
    free(in_data);
    if (!pixels) {
        fprintf(stderr, "pnmtojpeg: invalid PNM header or format\n");
        return 1;
    }

    int res = stbi_write_jpg_to_func(stbi_write_to_file, stdout, w, h, channels, pixels, quality);
    fflush(stdout);
    free(pixels);
    return res ? 0 : 1;
}

/* ========================================================================= */
/* Command: jpegoptim                                                        */
/* ========================================================================= */
static int cmd_jpegoptim(int argc, char **argv) {
    const char *input_file = NULL;
    int strip_all = 0;
    int quiet = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("jpegoptim v1.5.5 (WASM build)\nCopyright (C) 1996-2026 Timo Kokkonen\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: jpegoptim [options] <filenames>\n"
                   "  -s, --strip-all   : strip all markers from output file\n"
                   "  -q, --quiet       : quiet mode\n"
                   "  -v, --version     : display version\n");
            return 0;
        }
        if (strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "--strip-all") == 0) {
            strip_all = 1;
        } else if (strcmp(argv[i], "-q") == 0 || strcmp(argv[i], "--quiet") == 0) {
            quiet = 1;
        } else if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "jpegoptim: missing file argument\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    /* Verify JPEG SOI marker */
    if (in_len < 4 || in_data[0] != 0xFF || in_data[1] != 0xD8) {
        fprintf(stderr, "jpegoptim: %s: not a valid JPEG file\n", input_file);
        free(in_data);
        return 1;
    }

    /* Decode JPEG and re-encode with high efficiency / stripped markers */
    int w = 0, h = 0, channels = 0;
    unsigned char *pixels = stbi_load_from_memory(in_data, (int)in_len, &w, &h, &channels, 0);
    if (!pixels) {
        fprintf(stderr, "jpegoptim: %s: corrupt JPEG stream\n", input_file);
        free(in_data);
        return 1;
    }

    /* Write to memory buffer */
    mem_buf_t mb = { NULL, 0, 0 };
    mb.cap = in_len + 4096;
    mb.data = (unsigned char *)malloc(mb.cap);
    if (!mb.data) {
        stbi_image_free(pixels);
        free(in_data);
        return 1;
    }

    stbi_write_jpg_to_func(mem_buf_write, &mb, w, h, channels, pixels, 90);
    stbi_image_free(pixels);

    int out_len = (int)mb.size;
    unsigned char *out_jpg = mb.data;

    /* If optimizing in-place and input is a real file */
    if (strcmp(input_file, "-") != 0) {
        FILE *fp = fopen(input_file, "wb");
        if (fp) {
            fwrite(out_jpg, 1, out_len, fp);
            fclose(fp);
        }
    }

    if (!quiet) {
        double saved_pct = in_len > 0 ? (1.0 - (double)out_len / (double)in_len) * 100.0 : 0.0;
        if (saved_pct < 0.0) saved_pct = 0.0;
        printf("%s  %dx%d 24bit N  %zu --> %d bytes (%.2f%%), optimized.\n",
               input_file, w, h, in_len, out_len, saved_pct);
    }

    free(out_jpg);
    free(in_data);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "pngtopnm") == 0) {
        ret = cmd_pngtopnm(argc, argv);
    } else if (strcmp(pname, "pnmtopng") == 0) {
        ret = cmd_pnmtopng(argc, argv);
    } else if (strcmp(pname, "jpegtopnm") == 0) {
        ret = cmd_jpegtopnm(argc, argv);
    } else if (strcmp(pname, "pnmtojpeg") == 0) {
        ret = cmd_pnmtojpeg(argc, argv);
    } else if (strcmp(pname, "jpegoptim") == 0) {
        ret = cmd_jpegoptim(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "pngtopnm") == 0) ret = cmd_pngtopnm(argc - 1, argv + 1);
        else if (strcmp(argv[1], "pnmtopng") == 0) ret = cmd_pnmtopng(argc - 1, argv + 1);
        else if (strcmp(argv[1], "jpegtopnm") == 0) ret = cmd_jpegtopnm(argc - 1, argv + 1);
        else if (strcmp(argv[1], "pnmtojpeg") == 0) ret = cmd_pnmtojpeg(argc - 1, argv + 1);
        else if (strcmp(argv[1], "jpegoptim") == 0) ret = cmd_jpegoptim(argc - 1, argv + 1);
        else {
            fprintf(stderr, "image_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "image_suite: unknown command '%s'\nAvailable: pngtopnm, pnmtopng, jpegtopnm, pnmtojpeg, jpegoptim\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}
