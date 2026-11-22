/*
 * numbase - Base conversion suite (numbase, dec2bin, dec2hex, dec2oct, hex2dec)
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>

static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";

static int char_to_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'z') return c - 'a' + 10;
    if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
    return -1;
}

static void convert_and_print(const char *input, int from_base, int to_base) {
    while (*input && isspace((unsigned char)*input)) input++;
    if (!*input) return;

    /* Skip optional prefix like 0x or 0b */
    if (from_base == 16 && input[0] == '0' && (input[1] == 'x' || input[1] == 'X')) input += 2;
    else if (from_base == 2 && input[0] == '0' && (input[1] == 'b' || input[1] == 'B')) input += 2;
    else if (from_base == 8 && input[0] == '0' && (input[1] == 'o' || input[1] == 'O')) input += 2;

    int negative = 0;
    if (*input == '-') {
        negative = 1;
        input++;
    } else if (*input == '+') {
        input++;
    }

    /* Convert from from_base to __uint128_t */
    unsigned __int128 val = 0;
    int has_digits = 0;
    while (*input) {
        int d = char_to_val(*input);
        if (d < 0 || d >= from_base) break;
        val = val * from_base + d;
        has_digits = 1;
        input++;
    }

    if (!has_digits) {
        fprintf(stderr, "Invalid number for base %d\n", from_base);
        return;
    }

    if (val == 0) {
        printf("0\n");
        return;
    }

    char out[130];
    int pos = 0;
    while (val > 0) {
        out[pos++] = digits[val % to_base];
        val /= to_base;
    }

    if (negative) putchar('-');
    for (int i = pos - 1; i >= 0; i--) putchar(out[i]);
    putchar('\n');
}

static void process_stream(FILE *in, int from_base, int to_base) {
    char line[256];
    while (fgets(line, sizeof(line), in)) {
        size_t len = strlen(line);
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = '\0';
        if (len > 0) convert_and_print(line, from_base, to_base);
    }
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int from_base = 10;
    int to_base = 16;
    const char *value = NULL;

    if (strstr(prog, "dec2bin")) {
        from_base = 10; to_base = 2;
    } else if (strstr(prog, "dec2hex")) {
        from_base = 10; to_base = 16;
    } else if (strstr(prog, "dec2oct")) {
        from_base = 10; to_base = 8;
    } else if (strstr(prog, "hex2dec")) {
        from_base = 16; to_base = 10;
    }

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "-f") == 0 || strcmp(argv[i], "--from") == 0) && i + 1 < argc) {
            from_base = atoi(argv[++i]);
        } else if ((strcmp(argv[i], "-t") == 0 || strcmp(argv[i], "--to") == 0) && i + 1 < argc) {
            to_base = atoi(argv[++i]);
        } else if (argv[i][0] != '-') {
            value = argv[i];
        }
    }

    if (from_base < 2 || from_base > 36 || to_base < 2 || to_base > 36) {
        fprintf(stderr, "Bases must be between 2 and 36\n");
        return 1;
    }

    if (value) {
        convert_and_print(value, from_base, to_base);
    } else {
        process_stream(stdin, from_base, to_base);
    }
    fflush(stdout);
    return 0;
}
