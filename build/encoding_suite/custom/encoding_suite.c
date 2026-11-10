/*
 * encoding_suite - iconv and recode
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <stdint.h>

/* Windows-1252 mapping for 0x80 - 0x9F to Unicode codepoints */
static const uint32_t win1252_table[32] = {
    0x20AC, 0x0000, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x0000, 0x017D, 0x0000,
    0x0000, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x0000, 0x017E, 0x0178
};

typedef enum {
    ENC_UTF8,
    ENC_LATIN1,
    ENC_WIN1252,
    ENC_ASCII,
    ENC_UTF16LE,
    ENC_UTF16BE,
    ENC_HEX,
    ENC_BASE64,
    ENC_HTML
} enc_type_t;

static enc_type_t parse_encoding(const char *name) {
    if (!name) return ENC_UTF8;
    if (strcasecmp(name, "utf-8") == 0 || strcasecmp(name, "utf8") == 0) return ENC_UTF8;
    if (strcasecmp(name, "iso-8859-1") == 0 || strcasecmp(name, "latin1") == 0 || strcasecmp(name, "iso8859-1") == 0) return ENC_LATIN1;
    if (strcasecmp(name, "windows-1252") == 0 || strcasecmp(name, "cp1252") == 0 || strcasecmp(name, "win1252") == 0) return ENC_WIN1252;
    if (strcasecmp(name, "ascii") == 0 || strcasecmp(name, "us-ascii") == 0) return ENC_ASCII;
    if (strcasecmp(name, "utf-16le") == 0 || strcasecmp(name, "utf16le") == 0) return ENC_UTF16LE;
    if (strcasecmp(name, "utf-16be") == 0 || strcasecmp(name, "utf16be") == 0 || strcasecmp(name, "utf-16") == 0 || strcasecmp(name, "utf16") == 0) return ENC_UTF16BE;
    if (strcasecmp(name, "hex") == 0) return ENC_HEX;
    if (strcasecmp(name, "base64") == 0 || strcasecmp(name, "b64") == 0) return ENC_BASE64;
    if (strcasecmp(name, "html") == 0) return ENC_HTML;
    return ENC_UTF8;
}

static void emit_utf8_char(uint32_t cp, FILE *out) {
    if (cp <= 0x7F) {
        fputc((int)cp, out);
    } else if (cp <= 0x7FF) {
        fputc((int)(0xC0 | (cp >> 6)), out);
        fputc((int)(0x80 | (cp & 0x3F)), out);
    } else if (cp <= 0xFFFF) {
        fputc((int)(0xE0 | (cp >> 12)), out);
        fputc((int)(0x80 | ((cp >> 6) & 0x3F)), out);
        fputc((int)(0x80 | (cp & 0x3F)), out);
    } else if (cp <= 0x10FFFF) {
        fputc((int)(0xF0 | (cp >> 18)), out);
        fputc((int)(0x80 | ((cp >> 12) & 0x3F)), out);
        fputc((int)(0x80 | ((cp >> 6) & 0x3F)), out);
        fputc((int)(0x80 | (cp & 0x3F)), out);
    }
}

static void emit_codepoint(uint32_t cp, enc_type_t to_enc, FILE *out) {
    switch (to_enc) {
        case ENC_UTF8:
            emit_utf8_char(cp, out);
            break;
        case ENC_LATIN1:
            if (cp <= 0xFF) fputc((int)cp, out);
            else fputc('?', out);
            break;
        case ENC_WIN1252:
            if (cp <= 0x7F || (cp >= 0xA0 && cp <= 0xFF)) {
                fputc((int)cp, out);
            } else {
                int found = 0;
                for (int i = 0; i < 32; i++) {
                    if (win1252_table[i] == cp) {
                        fputc(0x80 + i, out);
                        found = 1;
                        break;
                    }
                }
                if (!found) fputc('?', out);
            }
            break;
        case ENC_ASCII:
            if (cp <= 0x7F) fputc((int)cp, out);
            else fputc('?', out);
            break;
        case ENC_UTF16LE:
            if (cp <= 0xFFFF) {
                fputc((int)(cp & 0xFF), out);
                fputc((int)((cp >> 8) & 0xFF), out);
            } else if (cp <= 0x10FFFF) {
                uint32_t v = cp - 0x10000;
                uint16_t high = (uint16_t)(0xD800 + (v >> 10));
                uint16_t low = (uint16_t)(0xDC00 + (v & 0x3FF));
                fputc((int)(high & 0xFF), out);
                fputc((int)((high >> 8) & 0xFF), out);
                fputc((int)(low & 0xFF), out);
                fputc((int)((low >> 8) & 0xFF), out);
            }
            break;
        case ENC_UTF16BE:
            if (cp <= 0xFFFF) {
                fputc((int)((cp >> 8) & 0xFF), out);
                fputc((int)(cp & 0xFF), out);
            } else if (cp <= 0x10FFFF) {
                uint32_t v = cp - 0x10000;
                uint16_t high = (uint16_t)(0xD800 + (v >> 10));
                uint16_t low = (uint16_t)(0xDC00 + (v & 0x3FF));
                fputc((int)((high >> 8) & 0xFF), out);
                fputc((int)(high & 0xFF), out);
                fputc((int)((low >> 8) & 0xFF), out);
                fputc((int)(low & 0xFF), out);
            }
            break;
        default:
            emit_utf8_char(cp, out);
            break;
    }
}

static void convert_stream(FILE *in, FILE *out, enc_type_t from, enc_type_t to) {
    if (from == ENC_UTF16LE || from == ENC_UTF16BE) {
        int b1, b2;
        while ((b1 = fgetc(in)) != EOF && (b2 = fgetc(in)) != EOF) {
            uint16_t u = (from == ENC_UTF16LE) ? (uint16_t)(b1 | (b2 << 8)) : (uint16_t)((b1 << 8) | b2);
            /* Skip BOM */
            if (u == 0xFEFF) continue;
            emit_codepoint(u, to, out);
        }
        return;
    }

    if (from == ENC_LATIN1 || from == ENC_ASCII) {
        int c;
        while ((c = fgetc(in)) != EOF) {
            emit_codepoint((uint32_t)(unsigned char)c, to, out);
        }
        return;
    }

    if (from == ENC_WIN1252) {
        int c;
        while ((c = fgetc(in)) != EOF) {
            unsigned char uc = (unsigned char)c;
            uint32_t cp = uc;
            if (uc >= 0x80 && uc <= 0x9F) {
                uint32_t mapped = win1252_table[uc - 0x80];
                if (mapped != 0) cp = mapped;
            }
            emit_codepoint(cp, to, out);
        }
        return;
    }

    /* Default from UTF-8 */
    int c;
    while ((c = fgetc(in)) != EOF) {
        unsigned char uc = (unsigned char)c;
        uint32_t cp = 0;
        if (uc < 0x80) {
            cp = uc;
        } else if ((uc & 0xE0) == 0xC0) {
            int c2 = fgetc(in);
            if (c2 == EOF) break;
            cp = ((uc & 0x1F) << 6) | (c2 & 0x3F);
        } else if ((uc & 0xF0) == 0xE0) {
            int c2 = fgetc(in), c3 = fgetc(in);
            if (c2 == EOF || c3 == EOF) break;
            cp = ((uc & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
        } else if ((uc & 0xF8) == 0xF0) {
            int c2 = fgetc(in), c3 = fgetc(in), c4 = fgetc(in);
            if (c2 == EOF || c3 == EOF || c4 == EOF) break;
            cp = ((uc & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F);
        }
        /* Skip UTF-8 BOM if present */
        if (cp == 0xFEFF) continue;
        emit_codepoint(cp, to, out);
    }
}

static void do_iconv(int argc, char **argv) {
    enc_type_t from = ENC_UTF8, to = ENC_UTF8;
    const char *infile = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-l") == 0 || strcmp(argv[i], "--list") == 0) {
            printf("Supported encodings:\n");
            printf("  UTF-8, ISO-8859-1 (Latin1), Windows-1252 (CP1252), ASCII, UTF-16LE, UTF-16BE\n");
            return;
        }
        if ((strcmp(argv[i], "-f") == 0 || strcmp(argv[i], "--from-code") == 0) && i + 1 < argc) {
            from = parse_encoding(argv[++i]);
        } else if ((strcmp(argv[i], "-t") == 0 || strcmp(argv[i], "--to-code") == 0) && i + 1 < argc) {
            to = parse_encoding(argv[++i]);
        } else if (argv[i][0] != '-') {
            infile = argv[i];
        }
    }

    FILE *in = infile ? fopen(infile, "rb") : stdin;
    if (!in) { perror(infile ? infile : "stdin"); return; }
    convert_stream(in, stdout, from, to);
    if (in != stdin) fclose(in);
}

static void do_recode(int argc, char **argv) {
    if (argc < 2 || strcmp(argv[1], "-l") == 0 || strcmp(argv[1], "--list") == 0) {
        printf("Supported charsets for recode (<from>..<to>):\n");
        printf("  utf8, latin1, win1252, ascii, utf16le, utf16be\n");
        return;
    }

    char spec[64];
    strncpy(spec, argv[1], sizeof(spec) - 1);
    spec[sizeof(spec) - 1] = '\0';

    char *dots = strstr(spec, "..");
    if (!dots) {
        fprintf(stderr, "Usage: recode <from>..<to> [file]\n");
        return;
    }
    *dots = '\0';
    const char *from_str = spec;
    const char *to_str = dots + 2;

    enc_type_t from = parse_encoding(from_str);
    enc_type_t to = parse_encoding(to_str);

    const char *infile = (argc > 2) ? argv[2] : NULL;
    FILE *in = infile ? fopen(infile, "rb") : stdin;
    if (!in) { perror(infile ? infile : "stdin"); return; }
    convert_stream(in, stdout, from, to);
    if (in != stdin) fclose(in);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "recode")) {
        do_recode(argc, argv);
    } else {
        do_iconv(argc, argv);
    }

    fflush(stdout);
    return 0;
}
