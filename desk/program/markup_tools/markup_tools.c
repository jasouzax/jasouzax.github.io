/*
 * markup_tools - md2html, html2text
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>

/* --- 1. md2html --- */
static void print_escaped_html(const char *str, size_t len) {
    for (size_t i = 0; i < len; i++) {
        switch (str[i]) {
            case '<': fputs("&lt;", stdout); break;
            case '>': fputs("&gt;", stdout); break;
            case '&': fputs("&amp;", stdout); break;
            case '"': fputs("&quot;", stdout); break;
            default: putchar(str[i]); break;
        }
    }
}

static void print_inline_md(const char *line) {
    size_t i = 0, len = strlen(line);
    while (i < len) {
        if (line[i] == '`') {
            const char *end = strchr(line + i + 1, '`');
            if (end) {
                fputs("<code>", stdout);
                print_escaped_html(line + i + 1, end - (line + i + 1));
                fputs("</code>", stdout);
                i = end - line + 1;
                continue;
            }
        }
        if (line[i] == '*' && line[i + 1] == '*') {
            const char *end = strstr(line + i + 2, "**");
            if (end) {
                fputs("<strong>", stdout);
                print_escaped_html(line + i + 2, end - (line + i + 2));
                fputs("</strong>", stdout);
                i = end - line + 2;
                continue;
            }
        }
        if (line[i] == '[') {
            const char *cb = strchr(line + i, ']');
            if (cb && *(cb + 1) == '(') {
                const char *cp = strchr(cb + 2, ')');
                if (cp) {
                    fputs("<a href=\"", stdout);
                    print_escaped_html(cb + 2, cp - (cb + 2));
                    fputs("\">", stdout);
                    print_escaped_html(line + i + 1, cb - (line + i + 1));
                    fputs("</a>", stdout);
                    i = cp - line + 1;
                    continue;
                }
            }
        }
        if (line[i] == '<') fputs("&lt;", stdout);
        else if (line[i] == '>') fputs("&gt;", stdout);
        else if (line[i] == '&') fputs("&amp;", stdout);
        else putchar(line[i]);
        i++;
    }
}

static void do_md2html(FILE *f) {
    char line[4096];
    int in_code_block = 0;
    int in_ul = 0;

    while (fgets(line, sizeof(line), f)) {
        size_t l = strlen(line);
        while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';

        if (strncmp(line, "```", 3) == 0) {
            if (in_code_block) {
                fputs("</code></pre>\n", stdout);
                in_code_block = 0;
            } else {
                if (in_ul) { fputs("</ul>\n", stdout); in_ul = 0; }
                fputs("<pre><code>", stdout);
                in_code_block = 1;
            }
            continue;
        }

        if (in_code_block) {
            print_escaped_html(line, strlen(line));
            putchar('\n');
            continue;
        }

        if (l == 0) {
            if (in_ul) { fputs("</ul>\n", stdout); in_ul = 0; }
            continue;
        }

        /* Heading */
        if (line[0] == '#') {
            if (in_ul) { fputs("</ul>\n", stdout); in_ul = 0; }
            int level = 0;
            while (line[level] == '#') level++;
            if (level > 6) level = 6;
            const char *text = line + level;
            while (*text && isspace((unsigned char)*text)) text++;
            printf("<h%d>", level);
            print_inline_md(text);
            printf("</h%d>\n", level);
            continue;
        }

        /* List item */
        if ((line[0] == '-' || line[0] == '*') && line[1] == ' ') {
            if (!in_ul) { fputs("<ul>\n", stdout); in_ul = 1; }
            const char *text = line + 2;
            fputs("  <li>", stdout);
            print_inline_md(text);
            fputs("</li>\n", stdout);
            continue;
        }

        if (in_ul) { fputs("</ul>\n", stdout); in_ul = 0; }

        /* Paragraph */
        fputs("<p>", stdout);
        print_inline_md(line);
        fputs("</p>\n", stdout);
    }

    if (in_code_block) fputs("</code></pre>\n", stdout);
    if (in_ul) fputs("</ul>\n", stdout);
}

/* --- 2. html2text --- */
static void do_html2text(FILE *f) {
    int c;
    int in_tag = 0;
    char tag_buf[64];
    size_t tag_idx = 0;
    int last_was_nl = 0;

    while ((c = fgetc(f)) != EOF) {
        if (c == '<') {
            in_tag = 1;
            tag_idx = 0;
            tag_buf[0] = '\0';
            continue;
        }
        if (in_tag) {
            if (c == '>') {
                in_tag = 0;
                tag_buf[tag_idx] = '\0';
                if (strcasecmp(tag_buf, "br") == 0 || strcasecmp(tag_buf, "br/") == 0) {
                    putchar('\n');
                    last_was_nl = 1;
                } else if (strcasecmp(tag_buf, "/p") == 0 || strcasecmp(tag_buf, "/h1") == 0 ||
                           strcasecmp(tag_buf, "/h2") == 0 || strcasecmp(tag_buf, "/h3") == 0 ||
                           strcasecmp(tag_buf, "/h4") == 0 || strcasecmp(tag_buf, "/h5") == 0 ||
                           strcasecmp(tag_buf, "/h6") == 0 || strcasecmp(tag_buf, "/div") == 0 ||
                           strcasecmp(tag_buf, "/li") == 0) {
                    if (!last_was_nl) putchar('\n');
                    last_was_nl = 1;
                } else if (strcasecmp(tag_buf, "li") == 0) {
                    fputs("  * ", stdout);
                    last_was_nl = 0;
                }
            } else if (tag_idx + 1 < sizeof(tag_buf)) {
                tag_buf[tag_idx++] = (char)c;
            }
            continue;
        }

        if (c == '&') {
            char ent[16] = {0};
            int e_idx = 0;
            int ec;
            while ((ec = fgetc(f)) != EOF && ec != ';' && e_idx < 15) {
                ent[e_idx++] = (char)ec;
            }
            if (strcmp(ent, "amp") == 0) putchar('&');
            else if (strcmp(ent, "lt") == 0) putchar('<');
            else if (strcmp(ent, "gt") == 0) putchar('>');
            else if (strcmp(ent, "quot") == 0) putchar('"');
            else if (strcmp(ent, "apos") == 0) putchar('\'');
            else if (strcmp(ent, "nbsp") == 0) putchar(' ');
            else {
                putchar('&');
                fputs(ent, stdout);
                if (ec == ';') putchar(';');
            }
            last_was_nl = 0;
            continue;
        }

        putchar(c);
        last_was_nl = (c == '\n');
    }
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    const char *path = NULL;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') { path = argv[i]; break; }
    }

    FILE *f = path ? fopen(path, "r") : stdin;
    if (!f) {
        perror(path ? path : "stdin");
        return 1;
    }

    if (strstr(prog, "html2text") || strstr(prog, "html-to-text")) {
        do_html2text(f);
    } else {
        do_md2html(f);
    }

    if (f != stdin) fclose(f);
    fflush(stdout);
    return 0;
}
