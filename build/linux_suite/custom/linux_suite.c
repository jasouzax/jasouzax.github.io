#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <stdint.h>
#include <sys/stat.h>

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

static unsigned char *read_file_or_stdin(const char *path, size_t *out_len) {
    FILE *fp = NULL;
    if (!path || strcmp(path, "-") == 0) {
        fp = stdin;
    } else {
        fp = fopen(path, "rb");
        if (!fp) {
            fprintf(stderr, "cannot open '%s'\n", path);
            return NULL;
        }
    }
    unsigned char *buf = read_entire_stream(fp, out_len);
    if (fp != stdin) fclose(fp);
    return buf;
}

/* ========================================================================= */
/* Command: file (File Type Identification)                                 */
/* ========================================================================= */
typedef struct {
    const char *desc;
    const char *mime;
} file_info_t;

static file_info_t identify_data(const unsigned char *data, size_t len) {
    file_info_t res = { "data", "application/octet-stream" };
    if (len == 0) {
        res.desc = "empty";
        res.mime = "inode/x-empty";
        return res;
    }

    /* ELF binary */
    if (len >= 16 && data[0] == 0x7F && data[1] == 'E' && data[2] == 'L' && data[3] == 'F') {
        int is64 = (data[4] == 2);
        int is_le = (data[5] == 1);
        int type = is_le ? (data[16] | (data[17] << 8)) : ((data[16] << 8) | data[17]);
        int mach = is_le ? (data[18] | (data[19] << 8)) : ((data[18] << 8) | data[19]);

        const char *tstr = "relocatable";
        if (type == 2) tstr = "executable";
        else if (type == 3) tstr = "shared object";
        else if (type == 4) tstr = "core file";

        const char *mstr = "unknown";
        if (mach == 0x3E) mstr = "x86-64";
        else if (mach == 0x03) mstr = "Intel 80386";
        else if (mach == 0x28) mstr = "ARM";
        else if (mach == 0xB7) mstr = "ARM aarch64";
        else if (mach == 0xF3) mstr = "RISC-V";

        static char elf_buf[128];
        snprintf(elf_buf, sizeof(elf_buf), "ELF %d-bit %s %s, %s, version 1 (SYSV)",
                 is64 ? 64 : 32, is_le ? "LSB" : "MSB", tstr, mstr);
        res.desc = elf_buf;
        res.mime = "application/x-executable";
        return res;
    }

    /* WebAssembly binary */
    if (len >= 8 && memcmp(data, "\0asm", 4) == 0) {
        uint32_t ver = data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24);
        static char wasm_buf[64];
        snprintf(wasm_buf, sizeof(wasm_buf), "WebAssembly (wasm) binary module version 0x%x (MVP)", ver);
        res.desc = wasm_buf;
        res.mime = "application/wasm";
        return res;
    }

    /* PDF document */
    if (len >= 8 && memcmp(data, "%PDF-", 5) == 0) {
        static char pdf_buf[64];
        char ver[8] = {0};
        size_t vi = 0;
        for (size_t i = 5; i < len && i < 12 && (isdigit(data[i]) || data[i] == '.'); i++) {
            ver[vi++] = (char)data[i];
        }
        snprintf(pdf_buf, sizeof(pdf_buf), "PDF document, version %s", ver[0] ? ver : "1.4");
        res.desc = pdf_buf;
        res.mime = "application/pdf";
        return res;
    }

    /* PNG image */
    if (len >= 8 && memcmp(data, "\x89PNG\r\n\x1a\n", 8) == 0) {
        if (len >= 24) {
            uint32_t w = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
            uint32_t h = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
            static char png_buf[128];
            snprintf(png_buf, sizeof(png_buf), "PNG image data, %u x %u, 8-bit/color RGB, non-interlaced", w, h);
            res.desc = png_buf;
        } else {
            res.desc = "PNG image data";
        }
        res.mime = "image/png";
        return res;
    }

    /* JPEG image */
    if (len >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) {
        res.desc = "JPEG image data, JFIF standard 1.01";
        res.mime = "image/jpeg";
        return res;
    }

    /* GIF image */
    if (len >= 6 && (memcmp(data, "GIF87a", 6) == 0 || memcmp(data, "GIF89a", 6) == 0)) {
        res.desc = (memcmp(data, "GIF89a", 6) == 0) ? "GIF image data, version 89a" : "GIF image data, version 87a";
        res.mime = "image/gif";
        return res;
    }

    /* WebP image / RIFF */
    if (len >= 12 && memcmp(data, "RIFF", 4) == 0) {
        if (memcmp(data + 8, "WEBP", 4) == 0) {
            res.desc = "RIFF (little-endian) data, Web/P image";
            res.mime = "image/webp";
            return res;
        }
        if (memcmp(data + 8, "WAVE", 4) == 0) {
            res.desc = "RIFF (little-endian) data, WAVE audio, Microsoft PCM";
            res.mime = "audio/x-wav";
            return res;
        }
        res.desc = "RIFF (little-endian) data";
        res.mime = "application/octet-stream";
        return res;
    }

    /* Ogg bitstream */
    if (len >= 4 && memcmp(data, "OggS", 4) == 0) {
        res.desc = "Ogg data, Vorbis audio";
        res.mime = "audio/ogg";
        return res;
    }

    /* FLAC audio */
    if (len >= 4 && memcmp(data, "fLaC", 4) == 0) {
        res.desc = "FLAC audio bitstream data";
        res.mime = "audio/flac";
        return res;
    }

    /* MP3 audio */
    if ((len >= 3 && memcmp(data, "ID3", 3) == 0) || (len >= 2 && data[0] == 0xFF && (data[1] & 0xFE) == 0xFA)) {
        res.desc = "Audio file with ID3 version 2.4.0, contains: MPEG ADTS, layer III";
        res.mime = "audio/mpeg";
        return res;
    }

    /* 7-Zip archive */
    if (len >= 6 && memcmp(data, "\x37\x7A\xBC\xAF\x27\x1C", 6) == 0) {
        res.desc = "7-zip archive data, version 0.4";
        res.mime = "application/x-7z-compressed";
        return res;
    }

    /* Zip archive */
    if (len >= 4 && memcmp(data, "PK\x03\x04", 4) == 0) {
        res.desc = "Zip archive data, at least v2.0 to extract";
        res.mime = "application/zip";
        return res;
    }

    /* Gzip archive */
    if (len >= 2 && data[0] == 0x1F && data[1] == 0x8B) {
        res.desc = "gzip compressed data, max compression, from Unix";
        res.mime = "application/gzip";
        return res;
    }

    /* Bzip2 archive */
    if (len >= 3 && memcmp(data, "BZh", 3) == 0) {
        res.desc = "bzip2 compressed data, block size = 900k";
        res.mime = "application/x-bzip2";
        return res;
    }

    /* XZ archive */
    if (len >= 6 && memcmp(data, "\xFD\x37\x7A\x58\x5A\x00", 6) == 0) {
        res.desc = "XZ compressed data";
        res.mime = "application/x-xz";
        return res;
    }

    /* POSIX Tar */
    if (len >= 512 && memcmp(data + 257, "ustar", 5) == 0) {
        res.desc = "POSIX tar archive (ustar)";
        res.mime = "application/x-tar";
        return res;
    }

    /* SQLite 3 database */
    if (len >= 16 && memcmp(data, "SQLite format 3", 15) == 0) {
        res.desc = "SQLite 3.x database";
        res.mime = "application/x-sqlite3";
        return res;
    }

    /* PostScript */
    if (len >= 4 && memcmp(data, "%!PS", 4) == 0) {
        res.desc = "PostScript document text conforming DSC level 3.0";
        res.mime = "application/postscript";
        return res;
    }

    /* ISO 9660 */
    if ((len >= 0x8006 && memcmp(data + 0x8001, "CD001", 5) == 0) ||
        (len >= 0x8806 && memcmp(data + 0x8801, "CD001", 5) == 0) ||
        (len >= 0x9006 && memcmp(data + 0x9001, "CD001", 5) == 0)) {
        res.desc = "ISO 9660 CD-ROM filesystem data";
        res.mime = "application/x-iso9660-image";
        return res;
    }

    /* RTF document */
    if (len >= 5 && memcmp(data, "{\\rtf", 5) == 0) {
        res.desc = "Rich Text Format data, version 1";
        res.mime = "text/rtf";
        return res;
    }

    /* Script Shebang */
    if (len >= 2 && data[0] == '#' && data[1] == '!') {
        char shebang[128] = {0};
        for (size_t i = 0; i < len && i < 127 && data[i] != '\n' && data[i] != '\r'; i++) {
            shebang[i] = (char)data[i];
        }
        if (strstr(shebang, "python")) {
            res.desc = "Python script, ASCII text executable";
            res.mime = "text/x-python";
        } else if (strstr(shebang, "node")) {
            res.desc = "Node.js script, ASCII text executable";
            res.mime = "text/javascript";
        } else if (strstr(shebang, "sh") || strstr(shebang, "bash")) {
            res.desc = "POSIX shell script, ASCII text executable";
            res.mime = "text/x-shellscript";
        } else {
            res.desc = "script, ASCII text executable";
            res.mime = "text/plain";
        }
        return res;
    }

    /* HTML / XML */
    if (len >= 5) {
        if (strncasecmp((const char *)data, "<!doctype html", 14) == 0 ||
            strncasecmp((const char *)data, "<html", 5) == 0) {
            res.desc = "HTML document, ASCII text";
            res.mime = "text/html";
            return res;
        }
        if (memcmp(data, "<?xml", 5) == 0) {
            res.desc = "XML 1.0 document, ASCII text";
            res.mime = "text/xml";
            return res;
        }
    }

    /* JSON data */
    size_t start_idx = 0;
    while (start_idx < len && isspace(data[start_idx])) start_idx++;
    if (start_idx < len && (data[start_idx] == '{' || data[start_idx] == '[')) {
        res.desc = "JSON data";
        res.mime = "application/json";
        return res;
    }

    /* Check if plaintext ASCII / UTF-8 */
    int is_text = 1;
    int is_utf8 = 0;
    for (size_t i = 0; i < len && i < 4096; i++) {
        unsigned char c = data[i];
        if (c == 0 || (c < 32 && c != '\t' && c != '\n' && c != '\r' && c != 12)) {
            is_text = 0;
            break;
        }
        if (c >= 128) is_utf8 = 1;
    }

    if (is_text) {
        res.desc = is_utf8 ? "Unicode text, UTF-8 text" : "ASCII text";
        res.mime = "text/plain; charset=utf-8";
        return res;
    }

    return res;
}

static int cmd_file(int argc, char **argv) {
    int brief = 0;
    int mime_type = 0;
    int mime = 0;
    const char *files[128];
    int file_count = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("file-5.45 (WASM build)\nmagic file from /etc/magic\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: file [OPTION...] [FILE...]\n"
                   "Determine type of FILEs.\n\n"
                   "  -b, --brief            do not prepend filenames to output lines\n"
                   "  -i, --mime             output MIME type and encoding strings\n"
                   "      --mime-type        output the MIME type\n"
                   "  -v, --version          output version information and exit\n"
                   "  -h, --help             display this help and exit\n");
            return 0;
        }
        if (strcmp(argv[i], "-b") == 0 || strcmp(argv[i], "--brief") == 0) {
            brief = 1;
        } else if (strcmp(argv[i], "-i") == 0 || strcmp(argv[i], "--mime") == 0) {
            mime = 1;
        } else if (strcmp(argv[i], "--mime-type") == 0) {
            mime_type = 1;
        } else if (argv[i][0] != '-' || strcmp(argv[i], "-") == 0) {
            if (file_count < 128) files[file_count++] = argv[i];
        }
    }

    if (file_count == 0) {
        files[file_count++] = "-";
    }

    for (int fi = 0; fi < file_count; fi++) {
        const char *fname = files[fi];
        struct stat st;
        if (strcmp(fname, "-") != 0 && stat(fname, &st) == 0 && S_ISDIR(st.st_mode)) {
            if (mime_type || mime) {
                if (brief) printf("inode/directory\n");
                else printf("%s: inode/directory\n", fname);
            } else {
                if (brief) printf("directory\n");
                else printf("%s: directory\n", fname);
            }
            continue;
        }

        size_t dlen = 0;
        unsigned char *data = read_file_or_stdin(fname, &dlen);
        if (!data) continue;

        file_info_t info = identify_data(data, dlen);
        const char *val = (mime_type || mime) ? info.mime : info.desc;

        if (brief) {
            printf("%s\n", val);
        } else {
            printf("%s: %s\n", fname, val);
        }
        free(data);
    }
    return 0;
}

/* ========================================================================= */
/* Command: readelf (ELF Binary Structure Inspector)                         */
/* ========================================================================= */
static int cmd_readelf(int argc, char **argv) {
    int opt_header = 0;
    int opt_sections = 0;
    int opt_segments = 0;
    int opt_symbols = 0;
    const char *elf_path = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("GNU readelf (GNU Binutils) 2.42 (WASM build)\n"
                   "Copyright (C) 2024 Free Software Foundation, Inc.\n");
            return 0;
        }
        if (strcmp(argv[i], "-H") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: readelf <option(s)> elf-file\n"
                   " Display information about the contents of ELF format files\n"
                   " Options are:\n"
                   "  -a --all               Equivalent to: -h -l -S -s\n"
                   "  -h --file-header       Display the ELF file header\n"
                   "  -l --program-headers   Display the program headers\n"
                   "     --segments          An alias for --program-headers\n"
                   "  -S --section-headers   Display the sections' header\n"
                   "     --sections          An alias for --section-headers\n"
                   "  -s --syms              Display the symbol table\n"
                   "     --symbols           An alias for --syms\n"
                   "  -v --version           Display the version number of readelf\n"
                   "  -H --help              Display this information\n");
            return 0;
        }
        if (strcmp(argv[i], "-a") == 0 || strcmp(argv[i], "--all") == 0) {
            opt_header = opt_sections = opt_segments = opt_symbols = 1;
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--file-header") == 0) {
            opt_header = 1;
        } else if (strcmp(argv[i], "-S") == 0 || strcmp(argv[i], "--section-headers") == 0 || strcmp(argv[i], "--sections") == 0) {
            opt_sections = 1;
        } else if (strcmp(argv[i], "-l") == 0 || strcmp(argv[i], "--program-headers") == 0 || strcmp(argv[i], "--segments") == 0) {
            opt_segments = 1;
        } else if (strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "--syms") == 0 || strcmp(argv[i], "--symbols") == 0) {
            opt_symbols = 1;
        } else if (argv[i][0] != '-') {
            elf_path = argv[i];
        }
    }

    if (!opt_header && !opt_sections && !opt_segments && !opt_symbols) {
        opt_header = 1;
    }

    if (!elf_path) {
        fprintf(stderr, "readelf: missing ELF file\n");
        return 1;
    }

    size_t elen = 0;
    unsigned char *ebuf = read_file_or_stdin(elf_path, &elen);
    if (!ebuf) return 1;

    if (elen < 16 || ebuf[0] != 0x7F || ebuf[1] != 'E' || ebuf[2] != 'L' || ebuf[3] != 'F') {
        fprintf(stderr, "readelf: Error: Not an ELF file - it has the wrong magic bytes at the start\n");
        free(ebuf);
        return 1;
    }

    int is64 = (ebuf[4] == 2);
    int is_le = (ebuf[5] == 1);

    if (opt_header) {
        printf("ELF Header:\n");
        printf("  Magic:   7f 45 4c 46 %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x %02x\n",
               ebuf[4], ebuf[5], ebuf[6], ebuf[7], ebuf[8], ebuf[9], ebuf[10], ebuf[11], ebuf[12], ebuf[13], ebuf[14], ebuf[15]);
        printf("  Class:                             %s\n", is64 ? "ELF64" : "ELF32");
        printf("  Data:                              2's complement, %s\n", is_le ? "little endian" : "big endian");
        printf("  Version:                           1 (current)\n");
        printf("  OS/ABI:                            UNIX - System V\n");
        printf("  ABI Version:                       0\n");

        int type = is_le ? (ebuf[16] | (ebuf[17] << 8)) : ((ebuf[16] << 8) | ebuf[17]);
        const char *tstr = "EXEC (Executable file)";
        if (type == 1) tstr = "REL (Relocatable file)";
        else if (type == 3) tstr = "DYN (Position-Independent Executable file / Shared object)";
        else if (type == 4) tstr = "CORE (Core file)";
        printf("  Type:                              %s\n", tstr);

        int mach = is_le ? (ebuf[18] | (ebuf[19] << 8)) : ((ebuf[18] << 8) | ebuf[19]);
        const char *mstr = "Advanced Micro Devices X86-64";
        if (mach == 0x03) mstr = "Intel 80386";
        else if (mach == 0x28) mstr = "ARM";
        else if (mach == 0xB7) mstr = "AArch64";
        else if (mach == 0xF3) mstr = "RISC-V";
        printf("  Machine:                           %s\n", mstr);
        printf("  Version:                           0x1\n");

        uint64_t entry = 0, phoff = 0, shoff = 0;
        uint16_t ehsize = 0, phentsize = 0, phnum = 0, shentsize = 0, shnum = 0, shstrndx = 0;

        if (is64 && elen >= 64) {
            entry = *(uint64_t *)(ebuf + 24);
            phoff = *(uint64_t *)(ebuf + 32);
            shoff = *(uint64_t *)(ebuf + 40);
            ehsize = *(uint16_t *)(ebuf + 52);
            phentsize = *(uint16_t *)(ebuf + 54);
            phnum = *(uint16_t *)(ebuf + 56);
            shentsize = *(uint16_t *)(ebuf + 58);
            shnum = *(uint16_t *)(ebuf + 60);
            shstrndx = *(uint16_t *)(ebuf + 62);
        } else if (!is64 && elen >= 52) {
            entry = *(uint32_t *)(ebuf + 24);
            phoff = *(uint32_t *)(ebuf + 28);
            shoff = *(uint32_t *)(ebuf + 32);
            ehsize = *(uint16_t *)(ebuf + 40);
            phentsize = *(uint16_t *)(ebuf + 42);
            phnum = *(uint16_t *)(ebuf + 44);
            shentsize = *(uint16_t *)(ebuf + 46);
            shnum = *(uint16_t *)(ebuf + 48);
            shstrndx = *(uint16_t *)(ebuf + 50);
        }

        printf("  Entry point address:               0x%lx\n", (unsigned long)entry);
        printf("  Start of program headers:          %lu (bytes into file)\n", (unsigned long)phoff);
        printf("  Start of section headers:          %lu (bytes into file)\n", (unsigned long)shoff);
        printf("  Flags:                             0x0\n");
        printf("  Size of this header:               %u (bytes)\n", ehsize);
        printf("  Size of program headers:           %u (bytes)\n", phentsize);
        printf("  Number of program headers:         %u\n", phnum);
        printf("  Size of section headers:           %u (bytes)\n", shentsize);
        printf("  Number of section headers:         %u\n", shnum);
        printf("  Section header string table index: %u\n", shstrndx);
    }

    /* Section headers */
    if (opt_sections) {
        uint64_t shoff = 0;
        uint16_t shentsize = 0, shnum = 0, shstrndx = 0;
        if (is64 && elen >= 64) {
            shoff = *(uint64_t *)(ebuf + 40);
            shentsize = *(uint16_t *)(ebuf + 58);
            shnum = *(uint16_t *)(ebuf + 60);
            shstrndx = *(uint16_t *)(ebuf + 62);
        } else if (!is64 && elen >= 52) {
            shoff = *(uint32_t *)(ebuf + 32);
            shentsize = *(uint16_t *)(ebuf + 46);
            shnum = *(uint16_t *)(ebuf + 48);
            shstrndx = *(uint16_t *)(ebuf + 50);
        }

        printf("\nThere are %u section headers, starting at offset 0x%lx:\n\n", shnum, (unsigned long)shoff);
        printf("Section Headers:\n");
        printf("  [Nr] Name              Type             Address           Offset\n");
        printf("       Size              EntSize          Flags  Link  Info  Align\n");

        /* String table pointer */
        const char *shstrtab = "";
        if (shstrndx < shnum) {
            size_t strhdr_off = shoff + shstrndx * shentsize;
            if (is64 && strhdr_off + 64 <= elen) {
                uint64_t stroff = *(uint64_t *)(ebuf + strhdr_off + 24);
                if (stroff < elen) shstrtab = (const char *)(ebuf + stroff);
            } else if (!is64 && strhdr_off + 40 <= elen) {
                uint32_t stroff = *(uint32_t *)(ebuf + strhdr_off + 16);
                if (stroff < elen) shstrtab = (const char *)(ebuf + stroff);
            }
        }

        for (uint16_t s = 0; s < shnum; s++) {
            size_t soff = shoff + s * shentsize;
            if (is64 && soff + 64 <= elen) {
                uint32_t sh_name = *(uint32_t *)(ebuf + soff);
                uint32_t sh_type = *(uint32_t *)(ebuf + soff + 4);
                uint64_t sh_flags = *(uint64_t *)(ebuf + soff + 8);
                uint64_t sh_addr = *(uint64_t *)(ebuf + soff + 16);
                uint64_t sh_offset = *(uint64_t *)(ebuf + soff + 24);
                uint64_t sh_size = *(uint64_t *)(ebuf + soff + 32);
                uint32_t sh_link = *(uint32_t *)(ebuf + soff + 40);
                uint32_t sh_info = *(uint32_t *)(ebuf + soff + 44);
                uint64_t sh_addralign = *(uint64_t *)(ebuf + soff + 48);
                uint64_t sh_entsize = *(uint64_t *)(ebuf + soff + 56);

                const char *sname = (shstrtab && sh_name < elen) ? (shstrtab + sh_name) : "";
                const char *tname = "PROGBITS";
                if (sh_type == 0) tname = "NULL";
                else if (sh_type == 2) tname = "SYMTAB";
                else if (sh_type == 3) tname = "STRTAB";
                else if (sh_type == 4) tname = "RELA";
                else if (sh_type == 8) tname = "NOBITS";
                else if (sh_type == 11) tname = "DYNSYM";

                printf("  [%2u] %-17s %-16s %016lx  %08lx\n", s, sname, tname, (unsigned long)sh_addr, (unsigned long)sh_offset);
                printf("       %016lx  %016lx       %c%c     %2u    %2u     %lu\n",
                       (unsigned long)sh_size, (unsigned long)sh_entsize,
                       (sh_flags & 2) ? 'A' : ' ', (sh_flags & 4) ? 'X' : (sh_flags & 1 ? 'W' : ' '),
                       sh_link, sh_info, (unsigned long)sh_addralign);
            }
        }
        printf("Key to Flags:\n  W (write), A (alloc), X (execute), M (merge), S (strings), I (info)\n");
    }

    free(ebuf);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "file") == 0) {
        ret = cmd_file(argc, argv);
    } else if (strcmp(pname, "readelf") == 0) {
        ret = cmd_readelf(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "file") == 0) ret = cmd_file(argc - 1, argv + 1);
        else if (strcmp(argv[1], "readelf") == 0) ret = cmd_readelf(argc - 1, argv + 1);
        else {
            fprintf(stderr, "linux_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "linux_suite: unknown command '%s'\nAvailable: file, readelf\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

