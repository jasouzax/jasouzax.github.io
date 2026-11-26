/* Image utilities over stb's real codecs. MIT, Jazu contributors. */
#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_FAILURE_USERMSG
#include "../image_suite/stb_image.h"
#include "../image_suite/stb_image_write.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <limits.h>

#define MAX_PIXELS 40000000
#define MAX_INPUT (128 * 1024 * 1024)
static int write_failed;
static void output(void *context, void *data, int size) {
    if (fwrite(data, 1, size, context) != (size_t)size) write_failed = 1;
}
static int dimensions(const char *text, int *w, int *h) {
    char end;
    return sscanf(text, "%dx%d%c", w, h, &end) == 2 && *w > 0 && *h > 0 && (long long)*w * *h <= MAX_PIXELS;
}
static unsigned char *read_input(const char *path, int *length) {
    FILE *fp = strcmp(path, "-") ? fopen(path, "rb") : stdin;
    if (!fp) return NULL;
    size_t cap = 4096, size = 0;
    unsigned char *data = malloc(cap);
    if (!data) { if (fp != stdin) fclose(fp); return NULL; }
    for (;;) {
        if (size == cap) {
            if (cap >= MAX_INPUT) { free(data); if (fp != stdin) fclose(fp); return NULL; }
            cap *= 2;
            unsigned char *next = realloc(data, cap);
            if (!next) { free(data); if (fp != stdin) fclose(fp); return NULL; }
            data = next;
        }
        size_t n = fread(data + size, 1, cap - size, fp);
        size += n;
        if (!n) break;
    }
    int failed = ferror(fp);
    if (fp != stdin) fclose(fp);
    if (failed) { free(data); return NULL; }
    *length = (int)size;
    return data;
}
static void help(void) {
    puts("Usage: imgconvert [options] INPUT OUTPUT\n"
         "       identify INPUT\n"
         "Options: --resize WxH --crop WxH+X+Y --rotate 90|180|270\n"
         "         --flip horizontal|vertical --grayscale --quality 1..100\n"
         "         --format png|jpeg|bmp|tga\n"
         "INPUT/OUTPUT may be - for pipelines. Use --format for stdout.\n"
         "Transforms apply in this order: crop, resize, rotate, flip, grayscale.\n"
         "Resize uses nearest-neighbor; JPEG composites alpha onto white.\n"
         "Limits: 128 MiB input, 40 million pixels. Animated input uses first frame.\n"
         "Aliases: png2jpg, jpg2png, bmp2png, png2bmp (same options).");
}
int main(int argc, char **argv) {
    const char *cmd = strrchr(argv[0], '/'); cmd = cmd ? cmd + 1 : argv[0];
    const char *input = NULL, *dest = NULL, *format = NULL;
    int rw = 0, rh = 0, cw = 0, ch = 0, cx = 0, cy = 0, rotate = 0, flip = 0, gray = 0, quality = 90;
    if (!strcmp(cmd, "png2jpg")) format = "jpeg";
    if (!strcmp(cmd, "jpg2png") || !strcmp(cmd, "bmp2png")) format = "png";
    if (!strcmp(cmd, "png2bmp")) format = "bmp";
    for (int i = 1; i < argc; i++) {
        const char *arg = argv[i];
        if (!strcmp(arg, "--help")) { help(); return 0; }
        if (!strcmp(arg, "--version")) { puts("Desk image tools 1.0.0 (stb codecs)"); return 0; }
        if (!strcmp(arg, "--grayscale")) { gray = 1; continue; }
        if (!strcmp(arg, "--resize") || !strcmp(arg, "--crop") || !strcmp(arg, "--rotate") || !strcmp(arg, "--quality") || !strcmp(arg, "--flip") || !strcmp(arg, "--format")) {
            if (++i == argc) goto usage;
            const char *value = argv[i]; char tail;
            if (!strcmp(arg, "--resize")) { if (!dimensions(value, &rw, &rh)) goto usage; }
            else if (!strcmp(arg, "--crop")) {
                if (sscanf(value, "%dx%d+%d+%d%c", &cw, &ch, &cx, &cy, &tail) != 4 || cw <= 0 || ch <= 0 || cx < 0 || cy < 0) goto usage;
            } else if (!strcmp(arg, "--rotate")) {
                if (sscanf(value, "%d%c", &rotate, &tail) != 1 || (rotate != 90 && rotate != 180 && rotate != 270)) goto usage;
            } else if (!strcmp(arg, "--quality")) {
                if (sscanf(value, "%d%c", &quality, &tail) != 1 || quality < 1 || quality > 100) goto usage;
            } else if (!strcmp(arg, "--flip")) {
                flip = !strcmp(value, "horizontal") ? 1 : !strcmp(value, "vertical") ? 2 : 0;
                if (!flip) goto usage;
            } else format = value;
            continue;
        }
        if (arg[0] == '-' && strcmp(arg, "-")) goto usage;
        if (!input) input = arg; else if (!dest) dest = arg; else goto usage;
    }
    int identifying = !strcmp(cmd, "identify");
    if (!input || (identifying ? dest != NULL : dest == NULL)) goto usage;
    if (!identifying && !format) { const char *dot = strrchr(dest, '.'); format = dot ? dot + 1 : ""; }
    if (!identifying && strcasecmp(format, "png") && strcasecmp(format, "jpg") && strcasecmp(format, "jpeg") && strcasecmp(format, "bmp") && strcasecmp(format, "tga")) {
        fputs("imgconvert: choose PNG, JPEG, BMP or TGA output\n", stderr); return 2;
    }
    int length = 0, w, h, channels;
    unsigned char *encoded = read_input(input, &length);
    if (!encoded) { fputs("image tools: cannot read input (limit 128 MiB)\n", stderr); return 1; }
    if (!stbi_info_from_memory(encoded, length, &w, &h, &channels) || w <= 0 || h <= 0 || (long long)w * h > MAX_PIXELS) {
        free(encoded); fputs("image tools: invalid image or exceeds 40 million pixels\n", stderr); return 1;
    }
    if (identifying) { printf("%s: %dx%d %d channels\n", input, w, h, channels); free(encoded); return 0; }
    unsigned char *pixels = stbi_load_from_memory(encoded, length, &w, &h, &channels, 4);
    free(encoded);
    if (!pixels) { fprintf(stderr, "imgconvert: %s\n", stbi_failure_reason()); return 1; }
    if (cw && (cw > w || ch > h || cx > w - cw || cy > h - ch)) {
        free(pixels); fputs("imgconvert: crop outside image\n", stderr); return 2;
    }
    int crop_w = cw ? cw : w, crop_h = ch ? ch : h;
    int sw = rw ? rw : crop_w, sh = rh ? rh : crop_h;
    int ow = rotate == 90 || rotate == 270 ? sh : sw;
    int oh = rotate == 90 || rotate == 270 ? sw : sh;
    unsigned char *result = malloc((size_t)ow * oh * 4);
    if (!result) { free(pixels); fputs("imgconvert: out of memory\n", stderr); return 1; }
    int jpeg = !strcasecmp(format, "jpg") || !strcasecmp(format, "jpeg");
    for (int y = 0; y < sh; y++) for (int x = 0; x < sw; x++) {
        int sx = cx + (int)((long long)x * crop_w / sw), sy = cy + (int)((long long)y * crop_h / sh);
        int dx = x, dy = y;
        if (rotate == 90) { dx = sh - 1 - y; dy = x; }
        if (rotate == 180) { dx = sw - 1 - x; dy = sh - 1 - y; }
        if (rotate == 270) { dx = y; dy = sw - 1 - x; }
        if (flip == 1) dx = ow - 1 - dx;
        if (flip == 2) dy = oh - 1 - dy;
        unsigned char *src = pixels + ((size_t)sy * w + sx) * 4, *out = result + ((size_t)dy * ow + dx) * 4;
        memcpy(out, src, 4);
        if (gray) out[0] = out[1] = out[2] = (77 * out[0] + 150 * out[1] + 29 * out[2] + 128) >> 8;
        if (jpeg) { for (int c = 0; c < 3; c++) out[c] = (out[c] * out[3] + 255 * (255 - out[3]) + 127) / 255; out[3] = 255; }
    }
    free(pixels);
    FILE *fp = strcmp(dest, "-") ? fopen(dest, "wb") : stdout;
    if (!fp) { free(result); perror(dest); return 1; }
    int ok = jpeg ? stbi_write_jpg_to_func(output, fp, ow, oh, 4, result, quality)
        : !strcasecmp(format, "png") ? stbi_write_png_to_func(output, fp, ow, oh, 4, result, ow * 4)
        : !strcasecmp(format, "bmp") ? stbi_write_bmp_to_func(output, fp, ow, oh, 4, result)
        : stbi_write_tga_to_func(output, fp, ow, oh, 4, result);
    free(result);
    if (fflush(fp)) write_failed = 1;
    if (fp != stdout && fclose(fp)) write_failed = 1;
    if (!ok || write_failed) { fputs("imgconvert: failed writing output\n", stderr); return 1; }
    return 0;
usage:
    fputs("image tools: invalid arguments; use --help\n", stderr); return 2;
}
