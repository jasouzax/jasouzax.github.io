/*
 * color_tools - hex2rgb, rgb2hex, color-mix
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>

typedef struct {
    int r, g, b, a; /* a is 0..255 */
    int has_alpha;
} color_t;

static int parse_hex_digit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int parse_hex_color(const char *str, color_t *out) {
    while (*str && isspace((unsigned char)*str)) str++;
    if (*str == '#') str++;

    size_t len = 0;
    while (str[len] && !isspace((unsigned char)str[len]) && str[len] != ',') len++;

    out->a = 255;
    out->has_alpha = 0;

    if (len == 3) {
        int r = parse_hex_digit(str[0]);
        int g = parse_hex_digit(str[1]);
        int b = parse_hex_digit(str[2]);
        if (r < 0 || g < 0 || b < 0) return 0;
        out->r = (r << 4) | r;
        out->g = (g << 4) | g;
        out->b = (b << 4) | b;
        return 1;
    } else if (len == 4) {
        int r = parse_hex_digit(str[0]);
        int g = parse_hex_digit(str[1]);
        int b = parse_hex_digit(str[2]);
        int a = parse_hex_digit(str[3]);
        if (r < 0 || g < 0 || b < 0 || a < 0) return 0;
        out->r = (r << 4) | r;
        out->g = (g << 4) | g;
        out->b = (b << 4) | b;
        out->a = (a << 4) | a;
        out->has_alpha = 1;
        return 1;
    } else if (len == 6 || len == 8) {
        int r1 = parse_hex_digit(str[0]), r2 = parse_hex_digit(str[1]);
        int g1 = parse_hex_digit(str[2]), g2 = parse_hex_digit(str[3]);
        int b1 = parse_hex_digit(str[4]), b2 = parse_hex_digit(str[5]);
        if (r1 < 0 || r2 < 0 || g1 < 0 || g2 < 0 || b1 < 0 || b2 < 0) return 0;
        out->r = (r1 << 4) | r2;
        out->g = (g1 << 4) | g2;
        out->b = (b1 << 4) | b2;
        if (len == 8) {
            int a1 = parse_hex_digit(str[6]), a2 = parse_hex_digit(str[7]);
            if (a1 < 0 || a2 < 0) return 0;
            out->a = (a1 << 4) | a2;
            out->has_alpha = 1;
        }
        return 1;
    }
    return 0;
}

static int parse_rgb_string(const char *str, color_t *out) {
    while (*str && isspace((unsigned char)*str)) str++;
    if (strncasecmp(str, "rgba", 4) == 0) str += 4;
    else if (strncasecmp(str, "rgb", 3) == 0) str += 3;

    while (*str && (*str == '(' || isspace((unsigned char)*str))) str++;

    double r = 0, g = 0, b = 0, a = 1.0;
    int has_a = 0;

    char *next;
    r = strtod(str, &next); if (next == str) return 0; str = next;
    while (*str && (*str == ',' || isspace((unsigned char)*str))) str++;
    g = strtod(str, &next); if (next == str) return 0; str = next;
    while (*str && (*str == ',' || isspace((unsigned char)*str))) str++;
    b = strtod(str, &next); if (next == str) return 0; str = next;
    while (*str && (*str == ',' || isspace((unsigned char)*str))) str++;
    if (*str && *str != ')') {
        a = strtod(str, &next);
        has_a = 1;
    }

    out->r = (int)fmin(255, fmax(0, r));
    out->g = (int)fmin(255, fmax(0, g));
    out->b = (int)fmin(255, fmax(0, b));
    out->a = (int)fmin(255, fmax(0, a <= 1.0 ? a * 255.0 : a));
    out->has_alpha = has_a;
    return 1;
}

static void do_hex2rgb(int argc, char **argv) {
    const char *color_str = NULL;
    int raw = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-r") == 0 || strcmp(argv[i], "--raw") == 0) raw = 1;
        else if (argv[i][0] != '-') color_str = argv[i];
    }

    color_t c;
    if (color_str) {
        if (parse_hex_color(color_str, &c)) {
            if (raw) printf("%d %d %d\n", c.r, c.g, c.b);
            else if (c.has_alpha) printf("rgba(%d, %d, %d, %.2f)\n", c.r, c.g, c.b, c.a / 255.0);
            else printf("rgb(%d, %d, %d)\n", c.r, c.g, c.b);
        } else {
            fprintf(stderr, "Invalid hex color: %s\n", color_str);
        }
    } else {
        char line[128];
        while (fgets(line, sizeof(line), stdin)) {
            if (parse_hex_color(line, &c)) {
                if (raw) printf("%d %d %d\n", c.r, c.g, c.b);
                else if (c.has_alpha) printf("rgba(%d, %d, %d, %.2f)\n", c.r, c.g, c.b, c.a / 255.0);
                else printf("rgb(%d, %d, %d)\n", c.r, c.g, c.b);
            }
        }
    }
}

static void do_rgb2hex(int argc, char **argv) {
    int uppercase = 0;
    int with_hash = 1;
    char combined[256] = {0};

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-u") == 0 || strcmp(argv[i], "--upper") == 0) uppercase = 1;
        else if (strcmp(argv[i], "--no-hash") == 0) with_hash = 0;
        else {
            if (combined[0]) strcat(combined, " ");
            strcat(combined, argv[i]);
        }
    }

    color_t c;
    if (combined[0]) {
        if (parse_rgb_string(combined, &c)) {
            const char *prefix = with_hash ? "#" : "";
            if (uppercase) {
                if (c.has_alpha) printf("%s%02X%02X%02X%02X\n", prefix, c.r, c.g, c.b, c.a);
                else printf("%s%02X%02X%02X\n", prefix, c.r, c.g, c.b);
            } else {
                if (c.has_alpha) printf("%s%02x%02x%02x%02x\n", prefix, c.r, c.g, c.b, c.a);
                else printf("%s%02x%02x%02x\n", prefix, c.r, c.g, c.b);
            }
        } else {
            fprintf(stderr, "Invalid RGB color: %s\n", combined);
        }
    } else {
        char line[256];
        while (fgets(line, sizeof(line), stdin)) {
            if (parse_rgb_string(line, &c)) {
                const char *prefix = with_hash ? "#" : "";
                if (uppercase) printf("%s%02X%02X%02X\n", prefix, c.r, c.g, c.b);
                else printf("%s%02x%02x%02x\n", prefix, c.r, c.g, c.b);
            }
        }
    }
}

static void do_color_mix(int argc, char **argv) {
    const char *col1_str = NULL;
    const char *col2_str = NULL;
    double ratio = 0.5;

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "-r") == 0 || strcmp(argv[i], "--ratio") == 0) && i + 1 < argc) {
            ratio = atof(argv[++i]);
        } else if (argv[i][0] != '-') {
            if (!col1_str) col1_str = argv[i];
            else if (!col2_str) col2_str = argv[i];
            else ratio = atof(argv[i]);
        }
    }

    if (!col1_str || !col2_str) {
        fprintf(stderr, "Usage: color-mix <color1> <color2> [ratio]\n");
        return;
    }

    color_t c1, c2;
    int ok1 = parse_hex_color(col1_str, &c1) || parse_rgb_string(col1_str, &c1);
    int ok2 = parse_hex_color(col2_str, &c2) || parse_rgb_string(col2_str, &c2);
    if (!ok1 || !ok2) {
        fprintf(stderr, "Invalid colors for mixing\n");
        return;
    }

    if (ratio < 0.0) ratio = 0.0;
    if (ratio > 1.0) ratio = 1.0;

    int r = (int)round(c1.r * (1.0 - ratio) + c2.r * ratio);
    int g = (int)round(c1.g * (1.0 - ratio) + c2.g * ratio);
    int b = (int)round(c1.b * (1.0 - ratio) + c2.b * ratio);

    printf("#%02x%02x%02x\n", r, g, b);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "rgb2hex")) {
        do_rgb2hex(argc, argv);
    } else if (strstr(prog, "color-mix") || strstr(prog, "color_mix")) {
        do_color_mix(argc, argv);
    } else {
        do_hex2rgb(argc, argv);
    }

    fflush(stdout);
    return 0;
}
