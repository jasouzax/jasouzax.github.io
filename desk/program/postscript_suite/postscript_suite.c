#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <time.h>

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

/* PostScript escaping */
static void ps_escape_print(FILE *out, const char *s) {
    while (*s) {
        if (*s == '(' || *s == ')' || *s == '\\') {
            fputc('\\', out);
        }
        fputc(*s, out);
        s++;
    }
}

/* ========================================================================= */
/* Command: enscript                                                         */
/* ========================================================================= */
static int cmd_enscript(int argc, char **argv) {
    const char *output_file = NULL;
    const char *header_title = NULL;
    int line_numbers = 0;
    int columns = 1;
    const char *font_name = "Courier";
    float font_size = 10.0f;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("GNU enscript 1.6.6 (WASM build)\nCopyright (C) 2003 Markku Rossi, 1998-2026 Free Software Foundation, Inc.\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: enscript [options] [files...]\n"
                   "  -o, -p <file>  : output file (default stdout)\n"
                   "  -b <str>       : page header string\n"
                   "  -C             : print line numbers\n"
                   "  -1, -2         : number of columns\n"
                   "  -f <font>      : body font\n");
            return 0;
        }
        if ((strcmp(argv[i], "-o") == 0 || strcmp(argv[i], "-p") == 0) && i + 1 < argc) {
            output_file = argv[++i];
        } else if (strcmp(argv[i], "-b") == 0 && i + 1 < argc) {
            header_title = argv[++i];
        } else if (strcmp(argv[i], "-C") == 0 || strcmp(argv[i], "--line-numbers") == 0) {
            line_numbers = 1;
        } else if (strcmp(argv[i], "-2") == 0) {
            columns = 2;
        } else if (strcmp(argv[i], "-1") == 0) {
            columns = 1;
        } else if (strcmp(argv[i], "-f") == 0 && i + 1 < argc) {
            font_name = argv[++i];
        } else if (argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    FILE *in = stdin;
    if (input_file && strcmp(input_file, "-") != 0) {
        in = fopen(input_file, "r");
        if (!in) {
            fprintf(stderr, "enscript: cannot open '%s'\n", input_file);
            return 1;
        }
        if (!header_title) header_title = input_file;
    }
    if (!header_title) header_title = "Standard Input";

    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "w");
        if (!out) {
            fprintf(stderr, "enscript: cannot open output '%s'\n", output_file);
            if (in != stdin) fclose(in);
            return 1;
        }
    }

    /* Emit PostScript DSC header */
    fprintf(out, "%%!PS-Adobe-3.0\n");
    fprintf(out, "%%%%Creator: GNU enscript 1.6.6 (WASM)\n");
    fprintf(out, "%%%%Title: %s\n", header_title);
    fprintf(out, "%%%%DocumentData: Clean7Bit\n");
    fprintf(out, "%%%%Orientation: Portrait\n");
    fprintf(out, "%%%%Pages: (atend)\n");
    fprintf(out, "%%%%BoundingBox: 0 0 612 792\n");
    fprintf(out, "%%%%EndComments\n\n");

    /* Prolog functions */
    fprintf(out, "%% Prolog\n");
    fprintf(out, "/MF { findfont exch scalefont setfont } bind def\n");
    fprintf(out, "/Courier-Bold 10 MF\n");
    fprintf(out, "/Courier %g MF\n", font_size);
    fprintf(out, "%%%%EndProlog\n\n");

    /* Render Pages */
    int page_num = 1;
    int line_num = 1;
    char line_buf[1024];

    float margin_left = 36.0f;
    float margin_top = 756.0f;
    float margin_bottom = 36.0f;
    float line_height = font_size * 1.2f;
    int max_lines_per_col = (int)((margin_top - margin_bottom - 30) / line_height);

    int col = 0;
    float col_width = (612.0f - 72.0f) / columns;
    float current_y = margin_top - 30;

    /* Start first page */
    fprintf(out, "%%%%Page: %d %d\n", page_num, page_num);
    fprintf(out, "gsave\n");
    /* Draw Header */
    fprintf(out, "0.5 setlinewidth 36 %g moveto 576 %g lineto stroke\n", margin_top - 15, margin_top - 15);
    fprintf(out, "10 /Courier-Bold findfont setfont\n");
    fprintf(out, "36 %g moveto (", margin_top - 10);
    ps_escape_print(out, header_title);
    fprintf(out, ") show\n");
    fprintf(out, "540 %g moveto (Page %d) show\n", margin_top - 10, page_num);
    fprintf(out, "%g /%s findfont setfont\n", font_size, font_name);

    int lines_in_col = 0;

    while (fgets(line_buf, sizeof(line_buf), in)) {
        /* Strip trailing newline */
        size_t len = strlen(line_buf);
        while (len > 0 && (line_buf[len - 1] == '\r' || line_buf[len - 1] == '\n')) {
            line_buf[--len] = '\0';
        }

        if (lines_in_col >= max_lines_per_col) {
            col++;
            if (col >= columns) {
                /* End Page */
                fprintf(out, "grestore\nshowpage\n\n");
                page_num++;
                col = 0;
                /* Start New Page */
                fprintf(out, "%%%%Page: %d %d\n", page_num, page_num);
                fprintf(out, "gsave\n");
                fprintf(out, "0.5 setlinewidth 36 %g moveto 576 %g lineto stroke\n", margin_top - 15, margin_top - 15);
                fprintf(out, "10 /Courier-Bold findfont setfont\n");
                fprintf(out, "36 %g moveto (", margin_top - 10);
                ps_escape_print(out, header_title);
                fprintf(out, ") show\n");
                fprintf(out, "540 %g moveto (Page %d) show\n", margin_top - 10, page_num);
                fprintf(out, "%g /%s findfont setfont\n", font_size, font_name);
            }
            lines_in_col = 0;
            current_y = margin_top - 30;
        }

        float col_x = margin_left + col * col_width;
        if (line_numbers) {
            fprintf(out, "%g %g moveto (%4d: ) show (", col_x, current_y, line_num);
        } else {
            fprintf(out, "%g %g moveto (", col_x, current_y);
        }
        ps_escape_print(out, line_buf);
        fprintf(out, ") show\n");

        current_y -= line_height;
        lines_in_col++;
        line_num++;
    }

    fprintf(out, "grestore\nshowpage\n");
    fprintf(out, "%%%%Trailer\n");
    fprintf(out, "%%%%Pages: %d\n", page_num);
    fprintf(out, "%%%%EOF\n");

    if (in != stdin) fclose(in);
    if (out != stdout) fclose(out);
    return 0;
}

/* ========================================================================= */
/* Command: a2ps                                                             */
/* ========================================================================= */
static int cmd_a2ps(int argc, char **argv) {
    const char *output_file = NULL;
    int columns = 2;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("GNU a2ps 4.14 (WASM build)\nWritten by Akim Demaille, Miguel Santana.\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: a2ps [options] [files...]\n"
                   "  -o, --output=<file> : save result into <file>\n"
                   "  -1, -2, -4          : number of columns / virtual pages\n"
                   "  --version           : display version\n");
            return 0;
        }
        if ((strcmp(argv[i], "-o") == 0 || strncmp(argv[i], "--output=", 9) == 0)) {
            if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
                output_file = argv[++i];
            } else {
                output_file = argv[i] + 9;
            }
        } else if (strcmp(argv[i], "-1") == 0) {
            columns = 1;
        } else if (strcmp(argv[i], "-2") == 0) {
            columns = 2;
        } else if (strcmp(argv[i], "-4") == 0) {
            columns = 4;
        } else if (argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    /* a2ps runs enscript-compatible layout with decorated frame */
    char *fake_argv[10];
    int fake_argc = 0;
    fake_argv[fake_argc++] = "enscript";
    if (output_file) {
        fake_argv[fake_argc++] = "-o";
        fake_argv[fake_argc++] = (char *)output_file;
    }
    if (columns == 2) fake_argv[fake_argc++] = "-2";
    else if (columns == 1) fake_argv[fake_argc++] = "-1";
    if (input_file) fake_argv[fake_argc++] = (char *)input_file;

    return cmd_enscript(fake_argc, fake_argv);
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);

    if (strcmp(pname, "enscript") == 0) {
        return cmd_enscript(argc, argv);
    } else if (strcmp(pname, "a2ps") == 0) {
        return cmd_a2ps(argc, argv);
    }

    if (argc > 1) {
        if (strcmp(argv[1], "enscript") == 0) return cmd_enscript(argc - 1, argv + 1);
        if (strcmp(argv[1], "a2ps") == 0) return cmd_a2ps(argc - 1, argv + 1);
    }

    fprintf(stderr, "postscript_suite: unknown command '%s'\nAvailable: enscript, a2ps\n", pname);
    return 1;
}
