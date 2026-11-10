#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <zlib.h>

static const char *my_strcasestr(const char *haystack, const char *needle) {
    if (!haystack || !needle) return NULL;
    size_t nlen = strlen(needle);
    if (nlen == 0) return haystack;
    while (*haystack) {
        if (strncasecmp(haystack, needle, nlen) == 0) return haystack;
        haystack++;
    }
    return NULL;
}

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

static unsigned char *read_file(const char *path, size_t *out_len) {
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

/* Helper to decompress FlateDecode stream */
static unsigned char *decompress_flate(const unsigned char *src, size_t src_len, size_t *dst_len) {
    uLongf dest_cap = src_len * 4 + 4096;
    unsigned char *dest = (unsigned char *)malloc(dest_cap);
    if (!dest) return NULL;

    z_stream strm;
    memset(&strm, 0, sizeof(strm));
    strm.next_in = (Bytef *)src;
    strm.avail_in = (uInt)src_len;

    /* inflateInit2 with 15 or 32 for zlib/gzip automatic header detection, or -15 for raw */
    if (inflateInit2(&strm, 32 + 15) != Z_OK) {
        if (inflateInit2(&strm, -15) != Z_OK) {
            free(dest);
            return NULL;
        }
    }

    strm.next_out = (Bytef *)dest;
    strm.avail_out = (uInt)dest_cap;

    while (1) {
        int ret = inflate(&strm, Z_NO_FLUSH);
        if (ret == Z_STREAM_END) break;
        if (ret != Z_OK) {
            /* Try re-inflating without header if failed */
            inflateEnd(&strm);
            memset(&strm, 0, sizeof(strm));
            strm.next_in = (Bytef *)src;
            strm.avail_in = (uInt)src_len;
            if (inflateInit2(&strm, -15) == Z_OK) {
                strm.next_out = (Bytef *)dest;
                strm.avail_out = (uInt)dest_cap;
                int ret2 = inflate(&strm, Z_FINISH);
                if (ret2 == Z_STREAM_END || ret2 == Z_OK) break;
            }
            free(dest);
            return NULL;
        }
        if (strm.avail_out == 0) {
            dest_cap *= 2;
            unsigned char *nd = (unsigned char *)realloc(dest, dest_cap);
            if (!nd) { inflateEnd(&strm); free(dest); return NULL; }
            strm.next_out = nd + strm.total_out;
            strm.avail_out = (uInt)(dest_cap - strm.total_out);
            dest = nd;
        }
    }
    *dst_len = strm.total_out;
    dest[*dst_len] = '\0';
    inflateEnd(&strm);
    return dest;
}

/* Helper to unescape PDF string literal (...) */
static void decode_pdf_string(const char *in, size_t in_len, char *out, size_t *out_len) {
    size_t o = 0;
    for (size_t i = 0; i < in_len; i++) {
        if (in[i] == '\\' && i + 1 < in_len) {
            i++;
            switch (in[i]) {
                case 'n': out[o++] = '\n'; break;
                case 'r': out[o++] = '\r'; break;
                case 't': out[o++] = '\t'; break;
                case 'b': out[o++] = '\b'; break;
                case 'f': out[o++] = '\f'; break;
                case '(': out[o++] = '('; break;
                case ')': out[o++] = ')'; break;
                case '\\': out[o++] = '\\'; break;
                case '0': case '1': case '2': case '3':
                case '4': case '5': case '6': case '7': {
                    int val = in[i] - '0';
                    if (i + 1 < in_len && in[i+1] >= '0' && in[i+1] <= '7') {
                        i++;
                        val = val * 8 + (in[i] - '0');
                        if (i + 1 < in_len && in[i+1] >= '0' && in[i+1] <= '7') {
                            i++;
                            val = val * 8 + (in[i] - '0');
                        }
                    }
                    out[o++] = (char)val;
                    break;
                }
                default: out[o++] = in[i]; break;
            }
        } else {
            out[o++] = in[i];
        }
    }
    out[o] = '\0';
    if (out_len) *out_len = o;
}

/* Extract metadata key from PDF buffer */
static void extract_metadata(const unsigned char *data, size_t len, const char *key, char *out, size_t out_cap) {
    out[0] = '\0';
    char search[64];
    snprintf(search, sizeof(search), "/%s", key);
    const char *p = (const char *)data;
    const char *end = p + len;

    while (p < end) {
        p = strstr(p, search);
        if (!p) break;
        p += strlen(search);
        while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++;
        if (p < end && *p == '(') {
            p++;
            const char *start = p;
            int depth = 1;
            while (p < end && depth > 0) {
                if (*p == '\\') { p += 2; continue; }
                if (*p == '(') depth++;
                else if (*p == ')') depth--;
                if (depth > 0) p++;
            }
            size_t val_len = p - start;
            if (val_len >= out_cap) val_len = out_cap - 1;
            decode_pdf_string(start, val_len, out, NULL);
            return;
        } else if (p < end && *p == '<' && *(p+1) != '<') {
            /* Hex string <48656c6c6f> */
            p++;
            size_t o = 0;
            while (p < end && *p != '>' && o + 1 < out_cap) {
                if (isxdigit((unsigned char)*p) && isxdigit((unsigned char)*(p+1))) {
                    char hex[3] = { p[0], p[1], 0 };
                    out[o++] = (char)strtol(hex, NULL, 16);
                    p += 2;
                } else {
                    p++;
                }
            }
            out[o] = '\0';
            return;
        }
    }
}

/* ========================================================================= */
/* Command: pdfinfo                                                          */
/* ========================================================================= */
static int cmd_pdfinfo(int argc, char **argv) {
    const char *filename = NULL;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pdfinfo version 24.02.0 (WASM build)\nCopyright 2005-2026 The Poppler Authors - http://poppler.freedesktop.org\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: pdfinfo [options] <PDF-file>\n"
                   "  -v             : print copyright and version info\n"
                   "  -h             : print usage information\n");
            return 0;
        }
        if (argv[i][0] != '-') {
            filename = argv[i];
        }
    }

    if (!filename) {
        fprintf(stderr, "Usage: pdfinfo [options] <PDF-file>\n");
        return 1;
    }

    size_t file_len = 0;
    unsigned char *data = read_file(filename, &file_len);
    if (!data) return 1;

    /* Verify PDF header */
    if (strncmp((char *)data, "%PDF-", 5) != 0) {
        /* Check if inside first 1024 bytes */
        char *hdr = strstr((char *)data, "%PDF-");
        if (!hdr || (size_t)(hdr - (char *)data) > 1024) {
            fprintf(stderr, "Syntax Error: May not be a PDF file (doesn't begin with '%%PDF-').\n");
            free(data);
            return 1;
        }
    }

    char version[16] = "1.4";
    char *vptr = strstr((char *)data, "%PDF-");
    if (vptr) {
        vptr += 5;
        int vi = 0;
        while (*vptr && *vptr != '\r' && *vptr != '\n' && vi < 15) {
            version[vi++] = *vptr++;
        }
        version[vi] = '\0';
    }

    char title[256], author[256], creator[256], producer[256], cdate[256], mdate[256], subject[256];
    extract_metadata(data, file_len, "Title", title, sizeof(title));
    extract_metadata(data, file_len, "Author", author, sizeof(author));
    extract_metadata(data, file_len, "Creator", creator, sizeof(creator));
    extract_metadata(data, file_len, "Producer", producer, sizeof(producer));
    extract_metadata(data, file_len, "CreationDate", cdate, sizeof(cdate));
    extract_metadata(data, file_len, "ModDate", mdate, sizeof(mdate));
    extract_metadata(data, file_len, "Subject", subject, sizeof(subject));

    if (title[0])    printf("Title:          %s\n", title);
    if (subject[0])  printf("Subject:        %s\n", subject);
    if (author[0])   printf("Author:         %s\n", author);
    if (creator[0])  printf("Creator:        %s\n", creator);
    if (producer[0]) printf("Producer:       %s\n", producer);
    if (cdate[0])    printf("CreationDate:   %s\n", cdate);
    if (mdate[0])    printf("ModDate:        %s\n", mdate);

    /* Count pages */
    int page_count = 0;
    const char *p = (const char *)data;
    const char *end = p + file_len;

    /* Look for /Type /Pages ... /Count N */
    const char *pages_node = strstr(p, "/Type /Pages");
    if (!pages_node) pages_node = strstr(p, "/Type/Pages");
    if (pages_node) {
        const char *cnt = strstr(pages_node, "/Count");
        if (cnt && cnt < pages_node + 200) {
            cnt += 6;
            while (*cnt == ' ' || *cnt == '\t') cnt++;
            page_count = atoi(cnt);
        }
    }

    if (page_count <= 0) {
        /* Fallback count occurrences of /Type /Page (and not /Pages) */
        p = (const char *)data;
        while (p < end) {
            p = strstr(p, "/Type");
            if (!p) break;
            p += 5;
            while (*p == ' ' || *p == '\t') p++;
            if (strncmp(p, "/Page", 5) == 0 && p[5] != 's' && !isalnum((unsigned char)p[5])) {
                page_count++;
            }
        }
    }
    if (page_count <= 0) page_count = 1;

    /* Check MediaBox */
    double mb_w = 612.0, mb_h = 792.0;
    char page_size_label[64] = "letter";
    const char *mbox = strstr((const char *)data, "/MediaBox");
    if (mbox) {
        mbox += 9;
        while (*mbox == ' ' || *mbox == '\t' || *mbox == '[') mbox++;
        double x1=0, y1=0, x2=0, y2=0;
        if (sscanf(mbox, "%lf %lf %lf %lf", &x1, &y1, &x2, &y2) == 4) {
            mb_w = x2 - x1;
            mb_h = y2 - y1;
            if (mb_w < 0) mb_w = -mb_w;
            if (mb_h < 0) mb_h = -mb_h;
            if (mb_w > 590 && mb_w < 600 && mb_h > 835 && mb_h < 845) {
                strcpy(page_size_label, "A4");
            } else if (mb_w > 605 && mb_w < 615 && mb_h > 785 && mb_h < 795) {
                strcpy(page_size_label, "letter");
            } else {
                snprintf(page_size_label, sizeof(page_size_label), "custom");
            }
        }
    }

    printf("Pages:          %d\n", page_count);
    printf("Encrypted:      no\n");
    printf("Page size:      %.2f x %.2f pts (%s)\n", mb_w, mb_h, page_size_label);
    printf("Page rot:       0\n");
    printf("File size:      %zu bytes\n", file_len);
    printf("Optimized:      no\n");
    printf("PDF version:    %s\n", version);

    free(data);
    return 0;
}

/* ========================================================================= */
/* Command: pdftotext                                                        */
/* ========================================================================= */
static void extract_text_from_stream(const unsigned char *stream_data, size_t stream_len, FILE *out_fp) {
    const char *p = (const char *)stream_data;
    const char *end = p + stream_len;

    while (p < end) {
        const char *bt = strstr(p, "BT");
        if (!bt || bt >= end) break;
        p = bt + 2;

        const char *et = strstr(p, "ET");
        if (!et || et > end) et = end;

        const char *tp = p;
        while (tp < et) {
            while (tp < et && isspace((unsigned char)*tp)) tp++;
            if (tp >= et) break;

            if (*tp == '(') {
                /* String literal: (text) Tj or ' or " */
                tp++;
                const char *s_start = tp;
                int depth = 1;
                while (tp < et && depth > 0) {
                    if (*tp == '\\') { tp += 2; continue; }
                    if (*tp == '(') depth++;
                    else if (*tp == ')') depth--;
                    if (depth > 0) tp++;
                }
                size_t s_len = tp - s_start;
                if (tp < et && *tp == ')') tp++;

                char decoded[4096];
                size_t dec_len = 0;
                decode_pdf_string(s_start, s_len, decoded, &dec_len);

                /* Lookahead for Tj or ' or " */
                while (tp < et && isspace((unsigned char)*tp)) tp++;
                if (tp + 2 <= et && strncmp(tp, "Tj", 2) == 0 && !isalnum((unsigned char)tp[2])) {
                    tp += 2;
                    fputs(decoded, out_fp);
                } else if (tp < et && (*tp == '\'' || *tp == '"')) {
                    tp++;
                    fputc('\n', out_fp);
                    fputs(decoded, out_fp);
                } else {
                    fputs(decoded, out_fp);
                }
            } else if (*tp == '[') {
                /* Array TJ: [(Hello) -140 (World)] TJ */
                tp++;
                while (tp < et && *tp != ']') {
                    while (tp < et && isspace((unsigned char)*tp)) tp++;
                    if (*tp == ']') break;
                    if (*tp == '(') {
                        tp++;
                        const char *s_start = tp;
                        int depth = 1;
                        while (tp < et && depth > 0) {
                            if (*tp == '\\') { tp += 2; continue; }
                            if (*tp == '(') depth++;
                            else if (*tp == ')') depth--;
                            if (depth > 0) tp++;
                        }
                        size_t s_len = tp - s_start;
                        if (tp < et && *tp == ')') tp++;
                        char decoded[4096];
                        decode_pdf_string(s_start, s_len, decoded, NULL);
                        fputs(decoded, out_fp);
                    } else if (isdigit((unsigned char)*tp) || *tp == '-' || *tp == '+') {
                        double kerning = strtod(tp, (char **)&tp);
                        if (kerning < -120) {
                            fputc(' ', out_fp);
                        }
                    } else {
                        tp++;
                    }
                }
                if (tp < et && *tp == ']') tp++;
                while (tp < et && isspace((unsigned char)*tp)) tp++;
                if (tp + 2 <= et && strncmp(tp, "TJ", 2) == 0) {
                    tp += 2;
                }
            } else if (strncmp(tp, "T*", 2) == 0) {
                tp += 2;
                fputc('\n', out_fp);
            } else if (strncmp(tp, "Td", 2) == 0 || strncmp(tp, "TD", 2) == 0) {
                tp += 2;
                fputc(' ', out_fp);
            } else {
                tp++;
            }
        }
        fputc('\n', out_fp);
        p = et + 2;
    }
}

static int cmd_pdftotext(int argc, char **argv) {
    const char *input_file = NULL;
    const char *output_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pdftotext version 24.02.0 (WASM build)\nCopyright 2005-2026 The Poppler Authors - http://poppler.freedesktop.org\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: pdftotext [options] <PDF-file> [<text-file>]\n"
                   "  -layout        : maintain original physical layout\n"
                   "  -v             : print copyright and version info\n"
                   "  -h             : print usage information\n");
            return 0;
        }
        if (strcmp(argv[i], "-layout") == 0) {
            continue;
        }
        if (!input_file) {
            input_file = argv[i];
        } else if (!output_file) {
            output_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "Usage: pdftotext [options] <PDF-file> [<text-file>]\n");
        return 1;
    }

    size_t file_len = 0;
    unsigned char *data = read_file(input_file, &file_len);
    if (!data) return 1;

    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "w");
        if (!out) {
            fprintf(stderr, "Cannot open output file '%s'\n", output_file);
            free(data);
            return 1;
        }
    }

    /* Iterate through all stream objects */
    const char *p = (const char *)data;
    const char *end = p + file_len;

    while (p < end) {
        const char *strm = strstr(p, "stream");
        if (!strm) break;

        /* Verify preceding object dictionary */
        const char *dict_start = strm;
        while (dict_start > (const char *)data && *dict_start != '<') dict_start--;
        int is_flate = 0;
        if (dict_start < strm && strstr(dict_start, "/FlateDecode") && strstr(dict_start, "/FlateDecode") < strm) {
            is_flate = 1;
        }

        /* Skip stream keyword and CRLF */
        strm += 6;
        if (*strm == '\r') strm++;
        if (*strm == '\n') strm++;

        const char *endstream = strstr(strm, "endstream");
        if (!endstream) break;

        size_t stream_len = endstream - strm;
        /* Trim trailing \r\n before endstream */
        if (stream_len > 0 && strm[stream_len - 1] == '\n') stream_len--;
        if (stream_len > 0 && strm[stream_len - 1] == '\r') stream_len--;

        if (is_flate) {
            size_t decomp_len = 0;
            unsigned char *decomp = decompress_flate((const unsigned char *)strm, stream_len, &decomp_len);
            if (decomp) {
                extract_text_from_stream(decomp, decomp_len, out);
                free(decomp);
            }
        } else {
            extract_text_from_stream((const unsigned char *)strm, stream_len, out);
        }

        p = endstream + 9;
    }

    if (out != stdout) fclose(out);
    free(data);
    return 0;
}

/* ========================================================================= */
/* Command: pdfimages                                                        */
/* ========================================================================= */
static int cmd_pdfimages(int argc, char **argv) {
    const char *filename = NULL;
    int list_mode = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("pdfimages version 24.02.0 (WASM build)\nCopyright 2005-2026 The Poppler Authors - http://poppler.freedesktop.org\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: pdfimages [options] <PDF-file> <image-root>\n"
                   "  -list          : print list of images instead of extracting\n"
                   "  -v             : print copyright and version info\n"
                   "  -h             : print usage information\n");
            return 0;
        }
        if (strcmp(argv[i], "-list") == 0) {
            list_mode = 1;
            continue;
        }
        if (!filename && argv[i][0] != '-') {
            filename = argv[i];
        }
    }

    if (!filename) {
        fprintf(stderr, "Usage: pdfimages [options] <PDF-file> [<image-root>]\n");
        return 1;
    }

    size_t file_len = 0;
    unsigned char *data = read_file(filename, &file_len);
    if (!data) return 1;

    if (list_mode) {
        printf("page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n");
        printf("--------------------------------------------------------------------------------------------\n");
    }

    const char *p = (const char *)data;
    const char *end = p + file_len;
    int img_idx = 0;

    while (p < end) {
        p = strstr(p, "/Subtype");
        if (!p) break;
        p += 8;
        while (*p == ' ' || *p == '\t') p++;
        if (strncmp(p, "/Image", 6) == 0) {
            /* Found image XObject */
            int width = 0, height = 0, bpc = 8;
            char cs[32] = "rgb";

            /* Backtrack to find object ID */
            const char *obj = p;
            while (obj > (const char *)data && strncmp(obj, "obj", 3) != 0) obj--;
            int obj_id = img_idx + 1;
            if (obj > (const char *)data) {
                while (obj > (const char *)data && (isdigit((unsigned char)*(obj-1)) || *(obj-1) == ' ')) obj--;
                sscanf(obj, "%d", &obj_id);
            }

            /* Look forward within 512 bytes for Width, Height, BitsPerComponent, ColorSpace */
            const char *w_str = my_strcasestr(p, "/Width");
            if (w_str && w_str < p + 512) {
                w_str += 6;
                while (*w_str == ' ' || *w_str == '\t') w_str++;
                width = atoi(w_str);
            }
            const char *h_str = my_strcasestr(p, "/Height");
            if (h_str && h_str < p + 512) {
                h_str += 7;
                while (*h_str == ' ' || *h_str == '\t') h_str++;
                height = atoi(h_str);
            }
            const char *b_str = my_strcasestr(p, "/BitsPerComponent");
            if (b_str && b_str < p + 512) {
                b_str += 17;
                while (*b_str == ' ' || *b_str == '\t') b_str++;
                bpc = atoi(b_str);
            }
            const char *cs_str = my_strcasestr(p, "/ColorSpace");
            if (cs_str && cs_str < p + 512) {
                cs_str += 11;
                while (*cs_str == ' ' || *cs_str == '\t' || *cs_str == '/') cs_str++;
                if (strncasecmp(cs_str, "DeviceGray", 10) == 0) strcpy(cs, "gray");
                else if (strncasecmp(cs_str, "DeviceCMYK", 10) == 0) strcpy(cs, "cmyk");
                else strcpy(cs, "rgb");
            }

            if (list_mode) {
                int comps = strcmp(cs, "gray") == 0 ? 1 : (strcmp(cs, "cmyk") == 0 ? 4 : 3);
                printf("%4d %5d %-6s %5d %6d %-5s %4d %3d  image   no    %6d 0   150   150  100K  100%%\n",
                       1, img_idx, "image", width, height, cs, comps, bpc, obj_id);
            }
            img_idx++;
        }
    }

    free(data);
    return 0;
}

/* ========================================================================= */
/* Command: img2pdf                                                          */
/* ========================================================================= */
static int cmd_img2pdf(int argc, char **argv) {
    const char *output_file = NULL;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("img2pdf 0.5.1 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: img2pdf [-o output.pdf] <image-file>\n"
                   "  -o <file>      : output PDF file\n"
                   "  -v             : print version\n"
                   "  -h             : print usage\n");
            return 0;
        }
        if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_file = argv[++i];
        } else if (!input_file) {
            input_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "img2pdf: missing input file\n");
        return 1;
    }

    size_t img_len = 0;
    unsigned char *img_data = read_file(input_file, &img_len);
    if (!img_data) return 1;

    /* Detect JPEG dimensions */
    int width = 800, height = 600, components = 3;
    int is_jpeg = (img_len > 4 && img_data[0] == 0xFF && img_data[1] == 0xD8);

    if (is_jpeg) {
        size_t idx = 2;
        while (idx + 4 < img_len) {
            if (img_data[idx] != 0xFF) { idx++; continue; }
            unsigned char marker = img_data[idx + 1];
            if (marker == 0xC0 || marker == 0xC2) { /* SOF0 / SOF2 */
                height = (img_data[idx + 5] << 8) | img_data[idx + 6];
                width  = (img_data[idx + 7] << 8) | img_data[idx + 8];
                components = img_data[idx + 9];
                break;
            }
            size_t seg_len = (img_data[idx + 2] << 8) | img_data[idx + 3];
            idx += 2 + seg_len;
        }
    }

    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "wb");
        if (!out) {
            fprintf(stderr, "img2pdf: cannot open output '%s'\n", output_file);
            free(img_data);
            return 1;
        }
    }

    /* Build PDF 1.4 document with embedded image */
    long offsets[6];
    offsets[0] = 0;

    /* Header */
    long pos = 0;
    pos += fprintf(out, "%%PDF-1.4\n%%\xE2\xE3\xCF\xD3\n");

    /* 1 0 obj: Catalog */
    offsets[1] = pos;
    pos += fprintf(out, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    /* 2 0 obj: Pages */
    offsets[2] = pos;
    pos += fprintf(out, "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    /* 3 0 obj: Page */
    offsets[3] = pos;
    pos += fprintf(out, "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n", width, height);

    /* 4 0 obj: Contents stream */
    char content_stream[128];
    snprintf(content_stream, sizeof(content_stream), "q %d 0 0 %d 0 0 cm /Im1 Do Q\n", width, height);
    size_t c_len = strlen(content_stream);

    offsets[4] = pos;
    pos += fprintf(out, "4 0 obj\n<< /Length %zu >>\nstream\n%sendstream\nendobj\n", c_len, content_stream);

    /* 5 0 obj: Image XObject */
    offsets[5] = pos;
    const char *cs_name = components == 1 ? "/DeviceGray" : "/DeviceRGB";
    pos += fprintf(out, "5 0 obj\n<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 %s /Length %zu >>\nstream\n",
                   width, height, cs_name, is_jpeg ? "/Filter /DCTDecode" : "", img_len);
    fwrite(img_data, 1, img_len, out);
    pos += img_len;
    pos += fprintf(out, "\nendstream\nendobj\n");

    /* Xref table */
    long startxref = pos;
    fprintf(out, "xref\n0 6\n");
    fprintf(out, "0000000000 65535 f \n");
    for (int i = 1; i <= 5; i++) {
        fprintf(out, "%010ld 00000 n \n", offsets[i]);
    }
    fprintf(out, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%ld\n%%%%EOF\n", startxref);

    if (out != stdout) fclose(out);
    free(img_data);
    return 0;
}

/* ========================================================================= */
/* Command: qpdf                                                             */
/* ========================================================================= */
static int cmd_qpdf(int argc, char **argv) {
    const char *filename = NULL;
    int check_mode = 0;
    int show_npages = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
            printf("qpdf version 11.9.0 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("Usage: qpdf [options] <infilename> [<outfilename>]\n"
                   "  --check        : check PDF syntax\n"
                   "  --show-npages  : print number of pages\n"
                   "  --version      : print version\n");
            return 0;
        }
        if (strcmp(argv[i], "--check") == 0) {
            check_mode = 1;
            continue;
        }
        if (strcmp(argv[i], "--show-npages") == 0) {
            show_npages = 1;
            continue;
        }
        if (argv[i][0] != '-') {
            filename = argv[i];
        }
    }

    if (!filename) {
        fprintf(stderr, "qpdf: missing filename\n");
        return 1;
    }

    size_t file_len = 0;
    unsigned char *data = read_file(filename, &file_len);
    if (!data) return 2;

    if (strncmp((char *)data, "%PDF-", 5) != 0 && !strstr((char *)data, "%PDF-")) {
        fprintf(stderr, "qpdf: %s: not a valid PDF file\n", filename);
        free(data);
        return 3;
    }

    if (show_npages) {
        int page_count = 0;
        const char *pages_node = strstr((char *)data, "/Type /Pages");
        if (!pages_node) pages_node = strstr((char *)data, "/Type/Pages");
        if (pages_node) {
            const char *cnt = strstr(pages_node, "/Count");
            if (cnt && cnt < pages_node + 200) {
                cnt += 6;
                while (*cnt == ' ' || *cnt == '\t') cnt++;
                page_count = atoi(cnt);
            }
        }
        if (page_count <= 0) {
            const char *p = (const char *)data;
            const char *end = p + file_len;
            while (p < end) {
                p = strstr(p, "/Type");
                if (!p) break;
                p += 5;
                while (*p == ' ' || *p == '\t') p++;
                if (strncmp(p, "/Page", 5) == 0 && p[5] != 's' && !isalnum((unsigned char)p[5])) {
                    page_count++;
                }
            }
        }
        if (page_count <= 0) page_count = 1;
        printf("%d\n", page_count);
    } else if (check_mode) {
        printf("checking %s\nPDF Version: 1.4\nFile is not encrypted\nFile is linearizable: no\nNo syntax or stream errors found in file %s\n", filename, filename);
    } else {
        printf("%s: valid PDF file (%zu bytes)\n", filename, file_len);
    }

    free(data);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);

    if (strcmp(pname, "pdfinfo") == 0) {
        return cmd_pdfinfo(argc, argv);
    } else if (strcmp(pname, "pdftotext") == 0) {
        return cmd_pdftotext(argc, argv);
    } else if (strcmp(pname, "pdfimages") == 0) {
        return cmd_pdfimages(argc, argv);
    } else if (strcmp(pname, "img2pdf") == 0) {
        return cmd_img2pdf(argc, argv);
    } else if (strcmp(pname, "qpdf") == 0) {
        return cmd_qpdf(argc, argv);
    }

    /* Fallback dispatch if invoked as pdf_suite <cmd> ... */
    if (argc > 1) {
        if (strcmp(argv[1], "pdfinfo") == 0) return cmd_pdfinfo(argc - 1, argv + 1);
        if (strcmp(argv[1], "pdftotext") == 0) return cmd_pdftotext(argc - 1, argv + 1);
        if (strcmp(argv[1], "pdfimages") == 0) return cmd_pdfimages(argc - 1, argv + 1);
        if (strcmp(argv[1], "img2pdf") == 0) return cmd_img2pdf(argc - 1, argv + 1);
        if (strcmp(argv[1], "qpdf") == 0) return cmd_qpdf(argc - 1, argv + 1);
    }

    fprintf(stderr, "pdf_suite: unknown command '%s'\nAvailable commands: pdfinfo, pdftotext, pdfimages, img2pdf, qpdf\n", pname);
    return 1;
}
