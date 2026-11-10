/*
 * text_stats - count-chars and charfreq
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int histogram = (strstr(prog, "charfreq") != NULL);
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--hist") == 0 || strcmp(argv[i], "-H") == 0) histogram = 1;
        else if (strcmp(argv[i], "--table") == 0 || strcmp(argv[i], "-t") == 0) histogram = 0;
    }

    long counts[256] = {0};
    long total = 0;
    int c;
    while ((c = fgetc(stdin)) != EOF) {
        counts[(unsigned char)c]++;
        total++;
    }

    if (total == 0) return 0;

    long max_count = 0;
    for (int i = 0; i < 256; i++) {
        if (counts[i] > max_count) max_count = counts[i];
    }

    if (histogram) {
        printf("Character Frequency Histogram (total: %ld):\n", total);
        for (int i = 32; i < 127; i++) {
            if (counts[i] == 0) continue;
            int bar_len = (int)((counts[i] * 40) / max_count);
            if (bar_len == 0 && counts[i] > 0) bar_len = 1;
            printf(" '%c' (%4ld): ", (char)i, counts[i]);
            for (int b = 0; b < bar_len; b++) putchar('#');
            putchar('\n');
        }
    } else {
        printf("CHAR\tCOUNT\tPERCENT\n");
        for (int i = 0; i < 256; i++) {
            if (counts[i] == 0) continue;
            if (i >= 32 && i < 127) {
                printf(" '%c'\t%ld\t%.2f%%\n", (char)i, counts[i], (counts[i] * 100.0) / total);
            } else if (i == '\n') {
                printf(" '\\n'\t%ld\t%.2f%%\n", counts[i], (counts[i] * 100.0) / total);
            } else if (i == '\t') {
                printf(" '\\t'\t%ld\t%.2f%%\n", counts[i], (counts[i] * 100.0) / total);
            } else {
                printf("0x%02X\t%ld\t%.2f%%\n", i, counts[i], (counts[i] * 100.0) / total);
            }
        }
    }
    fflush(stdout);
    return 0;
}
