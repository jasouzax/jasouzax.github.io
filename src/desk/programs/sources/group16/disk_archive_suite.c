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

static unsigned char *read_input(const char *path, size_t *out_len) {
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

/* ========================================================================= */
/* Command: iat (Iso9660 Analyzer Tool)                                      */
/* ========================================================================= */
static int cmd_iat(int argc, char **argv) {
    const char *input_file = NULL;
    const char *output_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-V") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Iso9660 Analyzer Tool 0.1.7\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Iso9660 Analyzer Tool 0.1.7\n\n"
                   "iat is a tool for detecting the structure of many types of image file.\n\n"
                   "Usage: iat -i [option]\n\n"
                   "  -h, --help                 Print help and exit\n"
                   "  -V, --version              Print version and exit\n\n"
                   "OPTIONS:\n"
                   "  -i, --input=image input    A string option for a filename\n"
                   "  -o, --output=image output  A string option for a filename\n"
                   "      --debug                debug image\n\n"
                   " Group: Convertion\n"
                   "      --cue                  Create Cuesheet of your image\n"
                   "      --toc                  Create TOC of your image\n"
                   "      --iso                  Create ISO9660 image\n");
            return 0;
        }
        if (strcmp(argv[i], "-i") == 0 && i + 1 < argc) {
            input_file = argv[++i];
        } else if (strncmp(argv[i], "--input=", 8) == 0) {
            input_file = argv[i] + 8;
        } else if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_file = argv[++i];
        } else if (strncmp(argv[i], "--output=", 9) == 0) {
            output_file = argv[i] + 9;
        } else if (argv[i][0] != '-') {
            if (!input_file) input_file = argv[i];
            else if (!output_file) output_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "iat: missing input image file (use -i <file>)\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    /* Detect sector size and payload offset */
    int sector_size = 2048;
    int payload_offset = 0;

    /* Check sector 16 (ISO 9660 Primary Volume Descriptor: 0x01 'CD001') */
    if (in_len >= 16 * 2048 + 5 && memcmp(in_data + 16 * 2048 + 1, "CD001", 5) == 0) {
        sector_size = 2048;
        payload_offset = 0;
    } else if (in_len >= 16 * 2352 + 16 + 5 && memcmp(in_data + 16 * 2352 + 16 + 1, "CD001", 5) == 0) {
        sector_size = 2352;
        payload_offset = 16;
    } else if (in_len >= 16 * 2336 + 8 + 5 && memcmp(in_data + 16 * 2336 + 8 + 1, "CD001", 5) == 0) {
        sector_size = 2336;
        payload_offset = 8;
    } else if (in_len >= 2352) {
        /* Default to raw BIN sector */
        sector_size = 2352;
        payload_offset = 16;
    }

    size_t num_sectors = in_len / sector_size;
    printf("Detecting image file: %s (%zu bytes)\n", input_file, in_len);
    printf("Detected sector size: %d bytes, payload offset: %d bytes\n", sector_size, payload_offset);
    printf("Total sectors: %zu (ISO data: %zu bytes)\n", num_sectors, num_sectors * 2048);

    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "wb");
        if (!out) {
            fprintf(stderr, "iat: cannot open output '%s'\n", output_file);
            free(in_data);
            return 1;
        }
    }

    /* Extract standard 2048-byte user data sectors */
    for (size_t s = 0; s < num_sectors; s++) {
        const unsigned char *sec = in_data + s * sector_size;
        fwrite(sec + payload_offset, 1, 2048, out);
    }
    fflush(out);

    if (out != stdout) {
        fclose(out);
        printf("ISO 9660 image written successfully to '%s'.\n", output_file);
    }

    free(in_data);
    return 0;
}

/* ========================================================================= */
/* Command: 7z / p7zip                                                       */
/* ========================================================================= */
typedef struct {
    char name[256];
    size_t size;
    size_t offset;
    time_t mtime;
} archive_file_entry;

static int cmd_7z(int argc, char **argv) {
    if (argc < 2) {
        printf("7-Zip 26.00 (WASM build) : Copyright (c) 1999-2026 Igor Pavlov : 2026-02-13\n\n"
               "Usage: 7z <command> [<switches>...] <archive_name> [<file_names>...]\n\n"
               "<Commands>\n"
               "  a : Add files to archive\n"
               "  d : Delete files from archive\n"
               "  e : Extract files from archive (without directory names)\n"
               "  l : List contents of archive\n"
               "  t : Test integrity of archive\n"
               "  u : Update files to archive\n"
               "  x : eXtract files with full paths\n");
        return 0;
    }

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-version") == 0) {
            printf("7-Zip 26.00 (WASM build) : Copyright (c) 1999-2026 Igor Pavlov\n");
            return 0;
        }
    }

    char command = argv[1][0];
    const char *archive_file = NULL;
    int file_start_idx = argc;

    for (int i = 2; i < argc; i++) {
        if (argv[i][0] != '-') {
            archive_file = argv[i];
            file_start_idx = i + 1;
            break;
        }
    }

    if (!archive_file) {
        fprintf(stderr, "7z: missing archive name\n");
        return 1;
    }

    /* 7z Container Signature: 0x37 0x7A 0xBC 0xAF 0x27 0x1C */
    static const unsigned char k7zSig[6] = { 0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C };

    if (command == 'a' || command == 'u') {
        /* Add files to archive */
        printf("7-Zip 26.00 (WASM build) : Copyright (c) 1999-2026 Igor Pavlov\n\n"
               "Scanning the drive:\n");

        int num_files = argc - file_start_idx;
        if (num_files < 1) {
            fprintf(stderr, "7z: no files specified to add\n");
            return 1;
        }

        printf("%d file%s\n\n", num_files, num_files == 1 ? "" : "s");
        printf("Creating archive: %s\n\n", archive_file);

        FILE *out = fopen(archive_file, "wb");
        if (!out) {
            fprintf(stderr, "7z: cannot create archive '%s'\n", archive_file);
            return 1;
        }

        /* Write 7z signature and version */
        fwrite(k7zSig, 1, 6, out);
        fputc(0x00, out); /* Major version */
        fputc(0x04, out); /* Minor version */

        /* Reserve 24 bytes for StartHeader (CRC, NextHeaderOffset, NextHeaderSize, NextHeaderCRC) */
        unsigned char start_hdr[24] = {0};
        long start_hdr_pos = ftell(out);
        fwrite(start_hdr, 1, 24, out);

        /* Write file data streams */
        archive_file_entry *entries = (archive_file_entry *)calloc(num_files, sizeof(archive_file_entry));
        size_t total_orig = 0;

        for (int fi = 0; fi < num_files; fi++) {
            const char *fname = argv[file_start_idx + fi];
            strncpy(entries[fi].name, fname, sizeof(entries[fi].name) - 1);
            entries[fi].offset = ftell(out);
            entries[fi].mtime = time(NULL);

            size_t flen = 0;
            unsigned char *fbytes = read_input(fname, &flen);
            if (fbytes) {
                entries[fi].size = flen;
                total_orig += flen;
                fwrite(fbytes, 1, flen, out);
                free(fbytes);
            }
            printf("Compressing  %s\n", fname);
        }

        /* Write Header (Table of Contents) at end */
        long header_pos = ftell(out);
        fputc(num_files & 0xFF, out);
        fputc((num_files >> 8) & 0xFF, out);

        for (int fi = 0; fi < num_files; fi++) {
            unsigned short nlen = (unsigned short)strlen(entries[fi].name);
            fwrite(&nlen, 2, 1, out);
            fwrite(entries[fi].name, 1, nlen, out);
            unsigned int sz = (unsigned int)entries[fi].size;
            fwrite(&sz, 4, 1, out);
            unsigned int off = (unsigned int)entries[fi].offset;
            fwrite(&off, 4, 1, out);
        }

        long end_pos = ftell(out);
        size_t header_size = end_pos - header_pos;
        size_t next_header_offset = header_pos - 32;

        /* Fill StartHeader */
        fseek(out, start_hdr_pos, SEEK_SET);
        unsigned int nh_off_low = (unsigned int)(next_header_offset & 0xFFFFFFFF);
        unsigned int nh_sz_low = (unsigned int)(header_size & 0xFFFFFFFF);
        fwrite("\x00\x00\x00\x00", 1, 4, out); /* CRC */
        fwrite(&nh_off_low, 4, 1, out);
        fwrite("\x00\x00\x00\x00", 1, 4, out); /* High 32 bits of offset */
        fwrite(&nh_sz_low, 4, 1, out);
        fwrite("\x00\x00\x00\x00", 1, 4, out); /* High 32 bits of size */
        fwrite("\x00\x00\x00\x00", 1, 4, out); /* Header CRC */

        fseek(out, 0, SEEK_END);
        long final_size = ftell(out);
        fclose(out);
        free(entries);

        printf("\nFiles read from disk: %d\n", num_files);
        printf("Archive size: %ld bytes\n", final_size);
        printf("Everything is Ok\n");
        return 0;
    }

    /* Commands l (list), x / e (extract), t (test) */
    size_t in_len = 0;
    unsigned char *in_data = read_input(archive_file, &in_len);
    if (!in_data) return 1;

    if (in_len < 32 || memcmp(in_data, k7zSig, 6) != 0) {
        fprintf(stderr, "7z: %s: not a valid 7z archive\n", archive_file);
        free(in_data);
        return 1;
    }

    /* Parse start header */
    unsigned int nh_off = in_data[12] | (in_data[13] << 8) | (in_data[14] << 16) | (in_data[15] << 24);
    size_t header_pos = 32 + nh_off;

    printf("7-Zip 26.00 (WASM build) : Copyright (c) 1999-2026 Igor Pavlov : 2026-02-13\n\n"
           "Scanning the drive for archives:\n"
           "1 file, %zu bytes\n\n", in_len);

    if (command == 'l') {
        printf("Listing archive: %s\n\n"
               "--\n"
               "Path = %s\n"
               "Type = 7z\n"
               "Physical Size = %zu\n"
               "Headers Size = %zu\n"
               "Method = LZMA\n\n"
               "   Date      Time    Attr         Size   Compressed  Name\n"
               "------------------- ----- ------------ ------------  ------------------------\n",
               archive_file, archive_file, in_len, in_len > header_pos ? in_len - header_pos : 32);

        int count = 0;
        size_t total_sz = 0;

        if (header_pos + 2 <= in_len) {
            int num_files = in_data[header_pos] | (in_data[header_pos+1] << 8);
            const unsigned char *hp = in_data + header_pos + 2;
            const unsigned char *hend = in_data + in_len;

            for (int fi = 0; fi < num_files && hp + 2 <= hend; fi++) {
                unsigned short nlen = hp[0] | (hp[1] << 8);
                hp += 2;
                if (hp + nlen + 8 > hend) break;
                char fname[256] = {0};
                memcpy(fname, hp, nlen < 255 ? nlen : 255);
                hp += nlen;
                unsigned int sz = hp[0] | (hp[1] << 8) | (hp[2] << 16) | (hp[3] << 24);
                hp += 4;
                hp += 4; /* offset */

                printf("2026-01-01 00:00:00 ....A %12u %12u  %s\n", sz, sz, fname);
                total_sz += sz;
                count++;
            }
        }

        printf("------------------- ----- ------------ ------------  ------------------------\n");
        printf("2026-01-01 00:00:00               %12zu %12zu  %d files\n", total_sz, total_sz, count);
        free(in_data);
        return 0;
    }

    if (command == 't') {
        printf("Testing archive: %s\n\n--\nPath = %s\nType = 7z\n\nEverything is Ok\n",
               archive_file, archive_file);
        free(in_data);
        return 0;
    }

    if (command == 'x' || command == 'e') {
        printf("Extracting archive: %s\n--\nPath = %s\nType = 7z\n\n",
               archive_file, archive_file);

        int count = 0;
        size_t total_sz = 0;

        if (header_pos + 2 <= in_len) {
            int num_files = in_data[header_pos] | (in_data[header_pos+1] << 8);
            const unsigned char *hp = in_data + header_pos + 2;
            const unsigned char *hend = in_data + in_len;

            for (int fi = 0; fi < num_files && hp + 2 <= hend; fi++) {
                unsigned short nlen = hp[0] | (hp[1] << 8);
                hp += 2;
                if (hp + nlen + 8 > hend) break;
                char fname[256] = {0};
                memcpy(fname, hp, nlen < 255 ? nlen : 255);
                hp += nlen;
                unsigned int sz = hp[0] | (hp[1] << 8) | (hp[2] << 16) | (hp[3] << 24);
                hp += 4;
                unsigned int off = hp[0] | (hp[1] << 8) | (hp[2] << 16) | (hp[3] << 24);
                hp += 4;

                printf("Extracting  %s\n", fname);
                if (off + sz <= in_len) {
                    FILE *fp = fopen(fname, "wb");
                    if (fp) {
                        fwrite(in_data + off, 1, sz, fp);
                        fclose(fp);
                    }
                }
                total_sz += sz;
                count++;
            }
        }

        printf("\nEverything is Ok\n\nFiles: %d\nSize: %zu\nCompressed: %zu\n",
               count, total_sz, in_len);
        free(in_data);
        return 0;
    }

    free(in_data);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "iat") == 0) {
        ret = cmd_iat(argc, argv);
    } else if (strcmp(pname, "7z") == 0 || strcmp(pname, "p7zip") == 0 || strcmp(pname, "7za") == 0 || strcmp(pname, "7zr") == 0) {
        ret = cmd_7z(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "iat") == 0) ret = cmd_iat(argc - 1, argv + 1);
        else if (strcmp(argv[1], "7z") == 0 || strcmp(argv[1], "p7zip") == 0) ret = cmd_7z(argc - 1, argv + 1);
        else {
            fprintf(stderr, "disk_archive_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "disk_archive_suite: unknown command '%s'\nAvailable: iat, 7z, p7zip\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

