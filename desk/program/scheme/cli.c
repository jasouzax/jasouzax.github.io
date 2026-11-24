/* TinyScheme CLI for Desk. MIT, Jazu contributors; interpreter is BSD licensed. */
#include "scheme-private.h"
#include "desk_scheme_init.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "--version")) { puts("TinyScheme 1.42 (Desk CLI)"); return 0; }
    if (argc > 1 && !strcmp(argv[1], "--help")) {
        puts("Usage: scheme [-e code | file | -]\nTinyScheme with its standard init.scm library. Files share the Desk filesystem.");
        return 0;
    }
    int eval = argc > 1 && !strcmp(argv[1], "-e");
    if ((eval && argc != 3) || (!eval && argc > 2) || (!eval && argc == 2 && argv[1][0] == '-' && strcmp(argv[1], "-"))) {
        fputs("scheme: invalid arguments; use --help\n", stderr); return 2;
    }
    FILE *fp = stdin;
    if (!eval && argc == 2 && strcmp(argv[1], "-")) {
        fp = fopen(argv[1], "rb");
        if (!fp) { perror(argv[1]); return 1; }
    } else if (!eval && !isatty(STDIN_FILENO)) {
        // TinyScheme enables prompts by FILE pointer identity, even for pipes.
        int fd = dup(STDIN_FILENO);
        if (fd < 0) return 1;
        fp = fdopen(fd, "rb");
        if (!fp) { close(fd); return 1; }
    }
    scheme *sc = scheme_init_new();
    if (!sc) { if (fp != stdin) fclose(fp); return 1; }
    scheme_set_input_port_file(sc, stdin);
    scheme_set_output_port_file(sc, stdout);
    scheme_load_string(sc, desk_scheme_init);
    if (!sc->retcode) {
        if (eval) scheme_load_string(sc, argv[2]);
        else scheme_load_named_file(sc, fp, argc == 2 ? argv[1] : "<stdin>");
    }
    int status = sc->retcode ? 1 : 0;
    if (fp != stdin) fclose(fp);
    scheme_deinit(sc);
    free(sc);
    return status;
}
