#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <zlib.h>

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

/* Find entry in ZIP archive and decompress it */
static unsigned char *extract_zip_entry(const unsigned char *zip_data, size_t zip_len, const char *target_name, size_t *out_len) {
    if (zip_len < 22) return NULL;

    /* Search for End of Central Directory record (PK\x05\x06) from end */
    const unsigned char *eocd = NULL;
    for (size_t i = zip_len - 22; ; i--) {
        if (zip_data[i] == 'P' && zip_data[i+1] == 'K' && zip_data[i+2] == 0x05 && zip_data[i+3] == 0x06) {
            eocd = zip_data + i;
            break;
        }
        if (i == 0 || (zip_len - i) > 65557) break;
    }

    if (!eocd) return NULL;

    unsigned short num_records = eocd[10] | (eocd[11] << 8);
    unsigned int cd_offset = eocd[16] | (eocd[17] << 8) | (eocd[18] << 16) | (eocd[19] << 24);

    if (cd_offset >= zip_len) return NULL;

    const unsigned char *cd_ptr = zip_data + cd_offset;
    for (int r = 0; r < num_records && cd_ptr + 46 <= zip_data + zip_len; r++) {
        if (cd_ptr[0] != 'P' || cd_ptr[1] != 'K' || cd_ptr[2] != 0x01 || cd_ptr[3] != 0x02) {
            break;
        }
        unsigned short method = cd_ptr[10] | (cd_ptr[11] << 8);
        unsigned int comp_size = cd_ptr[20] | (cd_ptr[21] << 8) | (cd_ptr[22] << 16) | (cd_ptr[23] << 24);
        unsigned int uncomp_size = cd_ptr[24] | (cd_ptr[25] << 8) | (cd_ptr[26] << 16) | (cd_ptr[27] << 24);
        unsigned short fname_len = cd_ptr[28] | (cd_ptr[29] << 8);
        unsigned short extra_len = cd_ptr[30] | (cd_ptr[31] << 8);
        unsigned short comment_len = cd_ptr[32] | (cd_ptr[33] << 8);
        unsigned int local_offset = cd_ptr[42] | (cd_ptr[43] << 8) | (cd_ptr[44] << 16) | (cd_ptr[45] << 24);

        const char *fname = (const char *)(cd_ptr + 46);
        if (fname_len == strlen(target_name) && strncmp(fname, target_name, fname_len) == 0) {
            /* Found target entry! Now inspect local header */
            if (local_offset + 30 > zip_len) return NULL;
            const unsigned char *lh = zip_data + local_offset;
            if (lh[0] != 'P' || lh[1] != 'K' || lh[2] != 0x03 || lh[3] != 0x04) return NULL;

            unsigned short lh_fname_len = lh[26] | (lh[27] << 8);
            unsigned short lh_extra_len = lh[28] | (lh[29] << 8);
            size_t data_offset = local_offset + 30 + lh_fname_len + lh_extra_len;

            if (data_offset + comp_size > zip_len) return NULL;
            const unsigned char *comp_data = zip_data + data_offset;

            unsigned char *out_buf = (unsigned char *)malloc(uncomp_size + 1);
            if (!out_buf) return NULL;

            if (method == 0) {
                /* Stored */
                memcpy(out_buf, comp_data, comp_size);
                out_buf[uncomp_size] = '\0';
                if (out_len) *out_len = uncomp_size;
                return out_buf;
            } else if (method == 8) {
                /* Deflated */
                z_stream strm;
                memset(&strm, 0, sizeof(strm));
                strm.next_in = (Bytef *)comp_data;
                strm.avail_in = comp_size;
                strm.next_out = (Bytef *)out_buf;
                strm.avail_out = uncomp_size;

                if (inflateInit2(&strm, -MAX_WBITS) != Z_OK) {
                    free(out_buf);
                    return NULL;
                }
                int ret = inflate(&strm, Z_FINISH);
                inflateEnd(&strm);
                if (ret == Z_STREAM_END || ret == Z_OK) {
                    out_buf[uncomp_size] = '\0';
                    if (out_len) *out_len = uncomp_size;
                    return out_buf;
                }
                free(out_buf);
                return NULL;
            }
        }

        cd_ptr += 46 + fname_len + extra_len + comment_len;
    }
    return NULL;
}

/* Parse XML text tags and write plaintext to fp */
static void extract_xml_text(const char *xml, size_t len, FILE *out, int is_docx) {
    const char *p = xml;
    const char *end = xml + len;

    while (p < end) {
        if (*p == '<') {
            const char *tag_start = p + 1;
            const char *tag_end = memchr(p, '>', end - p);
            if (!tag_end) break;

            size_t tlen = tag_end - tag_start;
            if (is_docx) {
                if (tlen >= 3 && strncmp(tag_start, "/w:p", 4) == 0) {
                    fputc('\n', out);
                } else if (strncmp(tag_start, "w:br", 4) == 0) {
                    fputc('\n', out);
                } else if (strncmp(tag_start, "w:tab", 5) == 0) {
                    fputc('\t', out);
                } else if (strncmp(tag_start, "w:t", 3) == 0 && (tag_start[3] == '>' || tag_start[3] == ' ')) {
                    /* Read text until </w:t> */
                    p = tag_end + 1;
                    const char *close_tag = strstr(p, "</w:t>");
                    if (!close_tag || close_tag > end) close_tag = end;
                    while (p < close_tag) {
                        if (*p == '&') {
                            if (strncmp(p, "&amp;", 5) == 0) { fputc('&', out); p += 5; }
                            else if (strncmp(p, "&lt;", 4) == 0) { fputc('<', out); p += 4; }
                            else if (strncmp(p, "&gt;", 4) == 0) { fputc('>', out); p += 4; }
                            else if (strncmp(p, "&quot;", 6) == 0) { fputc('"', out); p += 6; }
                            else if (strncmp(p, "&apos;", 6) == 0) { fputc('\'', out); p += 6; }
                            else { fputc(*p++, out); }
                        } else {
                            fputc(*p++, out);
                        }
                    }
                    p = close_tag + 6;
                    continue;
                }
            } else {
                /* ODT */
                if (strncmp(tag_start, "/text:p", 7) == 0 || strncmp(tag_start, "/text:h", 7) == 0) {
                    fputc('\n', out);
                } else if (strncmp(tag_start, "text:line-break", 15) == 0) {
                    fputc('\n', out);
                } else if (strncmp(tag_start, "text:tab", 8) == 0) {
                    fputc('\t', out);
                }
            }
            p = tag_end + 1;
        } else {
            if (!is_docx) {
                /* In ODT, text is directly between tags */
                if (*p == '&') {
                    if (strncmp(p, "&amp;", 5) == 0) { fputc('&', out); p += 5; }
                    else if (strncmp(p, "&lt;", 4) == 0) { fputc('<', out); p += 4; }
                    else if (strncmp(p, "&gt;", 4) == 0) { fputc('>', out); p += 4; }
                    else if (strncmp(p, "&quot;", 6) == 0) { fputc('"', out); p += 6; }
                    else if (strncmp(p, "&apos;", 6) == 0) { fputc('\'', out); p += 6; }
                    else { fputc(*p++, out); }
                } else {
                    fputc(*p++, out);
                }
            } else {
                p++;
            }
        }
    }
}

/* ========================================================================= */
/* Command: docx2txt                                                         */
/* ========================================================================= */
static int cmd_docx2txt(int argc, char **argv) {
    const char *input_file = NULL;
    const char *output_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("docx2txt version 1.4 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: docx2txt <file.docx> [<output.txt>]\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            if (!input_file) {
                input_file = argv[i];
            } else if (!output_file) {
                output_file = argv[i];
            }
        }
    }

    if (!input_file) {
        fprintf(stderr, "docx2txt: missing input file\nUsage: docx2txt <file.docx> [<output.txt>]\n");
        return 1;
    }

    size_t zip_len = 0;
    unsigned char *zip_data = read_file(input_file, &zip_len);
    if (!zip_data) return 1;

    size_t xml_len = 0;
    unsigned char *xml_data = extract_zip_entry(zip_data, zip_len, "word/document.xml", &xml_len);
    if (!xml_data) {
        fprintf(stderr, "docx2txt: '%s' is not a valid DOCX file (word/document.xml not found)\n", input_file);
        free(zip_data);
        return 1;
    }

    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "w");
        if (!out) {
            fprintf(stderr, "docx2txt: cannot open '%s'\n", output_file);
            free(xml_data);
            free(zip_data);
            return 1;
        }
    }

    extract_xml_text((const char *)xml_data, xml_len, out, 1);
    if (out != stdout) fclose(out);

    free(xml_data);
    free(zip_data);
    return 0;
}

/* ========================================================================= */
/* Command: odt2txt                                                          */
/* ========================================================================= */
static int cmd_odt2txt(int argc, char **argv) {
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("odt2txt 0.5 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: odt2txt [options] <file.odt>\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) input_file = "-";

    size_t zip_len = 0;
    unsigned char *zip_data = read_file(input_file, &zip_len);
    if (!zip_data) return 1;

    size_t xml_len = 0;
    unsigned char *xml_data = extract_zip_entry(zip_data, zip_len, "content.xml", &xml_len);
    if (!xml_data) {
        fprintf(stderr, "odt2txt: '%s' is not a valid ODT file (content.xml not found)\n", input_file);
        free(zip_data);
        return 1;
    }

    extract_xml_text((const char *)xml_data, xml_len, stdout, 0);

    free(xml_data);
    free(zip_data);
    return 0;
}

/* ========================================================================= */
/* Command: antiword                                                         */
/* ========================================================================= */
static int cmd_antiword(int argc, char **argv) {
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Antiword 0.37 (WASM build)\nCopyright (C) 1998-2005 Adri van Os\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: antiword [options] <word-file>\n"
                   "  -v             : display version\n"
                   "  -h             : display usage\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) input_file = "-";

    size_t file_len = 0;
    unsigned char *data = read_file(input_file, &file_len);
    if (!data) return 1;

    /* Check if file is RTF */
    if (file_len >= 5 && strncmp((char *)data, "{\\rtf", 5) == 0) {
        /* Strip RTF */
        const char *p = (const char *)data;
        const char *end = p + file_len;
        while (p < end) {
            if (*p == '{' || *p == '}') {
                p++;
            } else if (*p == '\\') {
                p++;
                if (strncmp(p, "par", 3) == 0) {
                    fputc('\n', stdout);
                    p += 3;
                } else if (strncmp(p, "tab", 3) == 0) {
                    fputc('\t', stdout);
                    p += 3;
                } else {
                    while (p < end && isalpha((unsigned char)*p)) p++;
                    if (p < end && *p == ' ') p++;
                }
            } else {
                fputc(*p++, stdout);
            }
        }
        free(data);
        return 0;
    }

    /* Check if OLE2 document or raw Word binary */
    int is_ole = (file_len >= 8 && data[0] == 0xD0 && data[1] == 0xCF && data[2] == 0x11 && data[3] == 0xE0);
    
    /* Scan printable sequences */
    size_t i = is_ole ? 512 : 0;
    int in_paragraph = 0;
    while (i < file_len) {
        /* Look for 1-byte ASCII run */
        if (data[i] >= 32 && data[i] < 127) {
            size_t start = i;
            while (i < file_len && data[i] >= 32 && data[i] < 127) i++;
            size_t run_len = i - start;
            if (run_len >= 2) {
                if (!in_paragraph) in_paragraph = 1;
                fwrite(data + start, 1, run_len, stdout);
                fputc(' ', stdout);
            }
        } else if (i + 1 < file_len && data[i] >= 32 && data[i] < 127 && data[i+1] == 0) {
            /* 2-byte UTF-16LE run */
            size_t start = i;
            while (i + 1 < file_len && data[i] >= 32 && data[i] < 127 && data[i+1] == 0) {
                fputc(data[i], stdout);
                i += 2;
            }
            fputc(' ', stdout);
            in_paragraph = 1;
        } else if (data[i] == '\r' || data[i] == '\n' || data[i] == 0x0C) {
            if (in_paragraph) {
                fputc('\n', stdout);
                in_paragraph = 0;
            }
            i++;
        } else {
            i++;
        }
    }
    if (in_paragraph) fputc('\n', stdout);

    free(data);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);

    if (strcmp(pname, "docx2txt") == 0) {
        return cmd_docx2txt(argc, argv);
    } else if (strcmp(pname, "odt2txt") == 0) {
        return cmd_odt2txt(argc, argv);
    } else if (strcmp(pname, "antiword") == 0) {
        return cmd_antiword(argc, argv);
    }

    if (argc > 1) {
        if (strcmp(argv[1], "docx2txt") == 0) return cmd_docx2txt(argc - 1, argv + 1);
        if (strcmp(argv[1], "odt2txt") == 0) return cmd_odt2txt(argc - 1, argv + 1);
        if (strcmp(argv[1], "antiword") == 0) return cmd_antiword(argc - 1, argv + 1);
    }

    fprintf(stderr, "doc_suite: unknown command '%s'\nAvailable: docx2txt, odt2txt, antiword\n", pname);
    return 1;
}
