/*
 * text_gen - lorem and str-repeat
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *paragraphs[] = {
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.",
    "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.",
    "Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae."
};

static void do_lorem(int n) {
    if (n <= 0) n = 1;
    for (int i = 0; i < n; i++) {
        printf("%s\n\n", paragraphs[i % 4]);
    }
}

static void do_repeat(int argc, char **argv) {
    int count = -1;
    const char *str = NULL;
    int newline = 1;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-n") == 0 && i + 1 < argc) {
            count = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--no-newline") == 0) {
            newline = 0;
        } else {
            char *endptr;
            long val = strtol(argv[i], &endptr, 10);
            if (*endptr == '\0' && count < 0) {
                count = (int)val;
            } else if (!str) {
                str = argv[i];
            } else if (count < 0) {
                count = (int)val;
            }
        }
    }

    if (count < 0) count = 1;

    if (str != NULL) {
        for (int c = 0; c < count; c++) {
            fputs(str, stdout);
        }
        if (newline) putchar('\n');
    } else {
        /* Read stdin into buffer and repeat */
        size_t cap = 4096, len = 0;
        char *buf = malloc(cap);
        if (!buf) return;
        size_t n;
        while ((n = fread(buf + len, 1, cap - len, stdin)) > 0) {
            len += n;
            if (len >= cap) {
                cap *= 2;
                char *new_buf = realloc(buf, cap);
                if (!new_buf) { free(buf); return; }
                buf = new_buf;
            }
        }
        for (int c = 0; c < count; c++) {
            fwrite(buf, 1, len, stdout);
        }
        free(buf);
    }
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "lorem")) {
        int n = 1;
        for (int i = 1; i < argc; i++) {
            if (strcmp(argv[i], "-n") == 0 && i + 1 < argc) {
                n = atoi(argv[i + 1]);
                i++;
            } else if (argv[i][0] != '-') {
                n = atoi(argv[i]);
            }
        }
        do_lorem(n);
    } else {
        do_repeat(argc, argv);
    }
    fflush(stdout);
    return 0;
}
