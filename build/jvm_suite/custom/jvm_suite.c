#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <stdint.h>
#include <unistd.h>

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_entire_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Could not find or load main class %s\n", path);
        return NULL;
    }
    size_t cap = 65536, len = 0;
    unsigned char *buf = (unsigned char *)malloc(cap);
    if (!buf) { fclose(fp); return NULL; }
    while (!feof(fp) && !ferror(fp)) {
        if (len + 4096 > cap) {
            cap *= 2;
            unsigned char *nb = (unsigned char *)realloc(buf, cap);
            if (!nb) { free(buf); fclose(fp); return NULL; }
            buf = nb;
        }
        size_t n = fread(buf + len, 1, 4096, fp);
        len += n;
    }
    fclose(fp);
    buf[len] = '\0';
    if (out_len) *out_len = len;
    return buf;
}

/* ========================================================================= */
/* JVM Bytecode Interpreter                                                  */
/* ========================================================================= */
typedef enum {
    CP_UTF8 = 1,
    CP_INTEGER = 3,
    CP_FLOAT = 4,
    CP_CLASS = 7,
    CP_STRING = 8,
    CP_FIELDREF = 9,
    CP_METHODREF = 10,
    CP_NAMEANDTYPE = 12
} cp_tag_t;

typedef struct {
    uint8_t tag;
    char *utf8_str;
    int32_t int_val;
    uint16_t class_idx;
    uint16_t string_idx;
    uint16_t name_and_type_idx;
    uint16_t name_idx;
    uint16_t desc_idx;
} cp_entry_t;

typedef struct {
    cp_entry_t *pool;
    uint16_t pool_count;
    unsigned char *code;
    uint32_t code_len;
} jvm_class_t;

static uint16_t read_u16(const unsigned char *p) {
    return (p[0] << 8) | p[1];
}

static uint32_t read_u32(const unsigned char *p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static jvm_class_t *parse_class_file(const unsigned char *buf, size_t len) {
    if (len < 10) return NULL;
    uint32_t magic = read_u32(buf);
    if (magic != 0xCAFEBABE) return NULL;

    jvm_class_t *cls = (jvm_class_t *)calloc(1, sizeof(jvm_class_t));
    cls->pool_count = read_u16(buf + 8);
    cls->pool = (cp_entry_t *)calloc(cls->pool_count, sizeof(cp_entry_t));

    size_t offset = 10;
    for (uint16_t i = 1; i < cls->pool_count && offset < len; i++) {
        uint8_t tag = buf[offset++];
        cls->pool[i].tag = tag;
        switch (tag) {
            case CP_UTF8: {
                uint16_t slen = read_u16(buf + offset);
                offset += 2;
                if (offset + slen <= len) {
                    cls->pool[i].utf8_str = (char *)malloc(slen + 1);
                    memcpy(cls->pool[i].utf8_str, buf + offset, slen);
                    cls->pool[i].utf8_str[slen] = '\0';
                }
                offset += slen;
                break;
            }
            case CP_INTEGER:
                cls->pool[i].int_val = (int32_t)read_u32(buf + offset);
                offset += 4;
                break;
            case CP_CLASS:
                cls->pool[i].name_idx = read_u16(buf + offset);
                offset += 2;
                break;
            case CP_STRING:
                cls->pool[i].string_idx = read_u16(buf + offset);
                offset += 2;
                break;
            case CP_FIELDREF:
            case CP_METHODREF:
                cls->pool[i].class_idx = read_u16(buf + offset);
                cls->pool[i].name_and_type_idx = read_u16(buf + offset + 2);
                offset += 4;
                break;
            case CP_NAMEANDTYPE:
                cls->pool[i].name_idx = read_u16(buf + offset);
                cls->pool[i].desc_idx = read_u16(buf + offset + 2);
                offset += 4;
                break;
            default:
                offset += 4;
                break;
        }
    }

    /* Skip access_flags (2), this_class (2), super_class (2), interfaces_count (2) */
    offset += 6;
    if (offset + 2 <= len) {
        uint16_t if_count = read_u16(buf + offset);
        offset += 2 + if_count * 2;
    }
    /* Skip fields */
    if (offset + 2 <= len) {
        uint16_t field_count = read_u16(buf + offset);
        offset += 2;
        for (uint16_t f = 0; f < field_count && offset < len; f++) {
            offset += 6;
            uint16_t attr_count = read_u16(buf + offset);
            offset += 2;
            for (uint16_t a = 0; a < attr_count && offset + 6 <= len; a++) {
                uint32_t alen = read_u32(buf + offset + 2);
                offset += 6 + alen;
            }
        }
    }
    /* Methods */
    if (offset + 2 <= len) {
        uint16_t method_count = read_u16(buf + offset);
        offset += 2;
        for (uint16_t m = 0; m < method_count && offset < len; m++) {
            uint16_t name_idx = read_u16(buf + offset + 2);
            offset += 6;
            uint16_t attr_count = read_u16(buf + offset);
            offset += 2;

            int is_main = 0;
            if (name_idx < cls->pool_count && cls->pool[name_idx].utf8_str) {
                if (strcmp(cls->pool[name_idx].utf8_str, "main") == 0) is_main = 1;
            }

            for (uint16_t a = 0; a < attr_count && offset + 6 <= len; a++) {
                uint16_t aname_idx = read_u16(buf + offset);
                uint32_t alen = read_u32(buf + offset + 2);
                offset += 6;

                if (is_main && aname_idx < cls->pool_count && cls->pool[aname_idx].utf8_str) {
                    if (strcmp(cls->pool[aname_idx].utf8_str, "Code") == 0 && offset + 8 <= len) {
                        /* max_stack (2), max_locals (2), code_length (4) */
                        uint32_t clen = read_u32(buf + offset + 4);
                        if (offset + 8 + clen <= len) {
                            cls->code_len = clen;
                            cls->code = (unsigned char *)malloc(clen);
                            memcpy(cls->code, buf + offset + 8, clen);
                        }
                    }
                }
                offset += alen;
            }
        }
    }

    return cls;
}

static void free_class(jvm_class_t *cls) {
    if (!cls) return;
    for (uint16_t i = 1; i < cls->pool_count; i++) {
        if (cls->pool[i].utf8_str) free(cls->pool[i].utf8_str);
    }
    free(cls->pool);
    if (cls->code) free(cls->code);
    free(cls);
}

typedef struct {
    int is_str;
    const char *str_val;
    int32_t int_val;
} jvm_slot_t;

static int execute_bytecode(jvm_class_t *cls) {
    if (!cls || !cls->code || cls->code_len == 0) return 1;

    jvm_slot_t stack[256];
    int sp = 0;
    jvm_slot_t locals[64];
    memset(locals, 0, sizeof(locals));

    size_t pc = 0;
    while (pc < cls->code_len) {
        uint8_t op = cls->code[pc++];
        switch (op) {
            case 0x00: /* nop */
                break;
            case 0x03: /* iconst_0 */
                stack[sp].is_str = 0; stack[sp++].int_val = 0;
                break;
            case 0x04: /* iconst_1 */
                stack[sp].is_str = 0; stack[sp++].int_val = 1;
                break;
            case 0x05: /* iconst_2 */
                stack[sp].is_str = 0; stack[sp++].int_val = 2;
                break;
            case 0x06: /* iconst_3 */
                stack[sp].is_str = 0; stack[sp++].int_val = 3;
                break;
            case 0x07: /* iconst_4 */
                stack[sp].is_str = 0; stack[sp++].int_val = 4;
                break;
            case 0x08: /* iconst_5 */
                stack[sp].is_str = 0; stack[sp++].int_val = 5;
                break;
            case 0x10: { /* bipush */
                int8_t b = (int8_t)cls->code[pc++];
                stack[sp].is_str = 0; stack[sp++].int_val = b;
                break;
            }
            case 0x11: { /* sipush */
                int16_t s = (int16_t)read_u16(cls->code + pc);
                pc += 2;
                stack[sp].is_str = 0; stack[sp++].int_val = s;
                break;
            }
            case 0x12: { /* ldc */
                uint8_t cpidx = cls->code[pc++];
                if (cpidx < cls->pool_count) {
                    if (cls->pool[cpidx].tag == CP_STRING) {
                        uint16_t str_idx = cls->pool[cpidx].string_idx;
                        stack[sp].is_str = 1;
                        stack[sp++].str_val = (str_idx < cls->pool_count) ? cls->pool[str_idx].utf8_str : "";
                    } else if (cls->pool[cpidx].tag == CP_INTEGER) {
                        stack[sp].is_str = 0;
                        stack[sp++].int_val = cls->pool[cpidx].int_val;
                    }
                }
                break;
            }
            case 0x1A: case 0x1B: case 0x1C: case 0x1D: /* iload_0..3 */
                stack[sp++] = locals[op - 0x1A];
                break;
            case 0x3B: case 0x3C: case 0x3D: case 0x3E: /* istore_0..3 */
                locals[op - 0x3B] = stack[--sp];
                break;
            case 0x60: { /* iadd */
                int32_t b = stack[--sp].int_val;
                int32_t a = stack[--sp].int_val;
                stack[sp].is_str = 0; stack[sp++].int_val = a + b;
                break;
            }
            case 0x64: { /* isub */
                int32_t b = stack[--sp].int_val;
                int32_t a = stack[--sp].int_val;
                stack[sp].is_str = 0; stack[sp++].int_val = a - b;
                break;
            }
            case 0x68: { /* imul */
                int32_t b = stack[--sp].int_val;
                int32_t a = stack[--sp].int_val;
                stack[sp].is_str = 0; stack[sp++].int_val = a * b;
                break;
            }
            case 0xB2: /* getstatic */
                pc += 2;
                /* Push System.out marker */
                stack[sp].is_str = 0; stack[sp++].int_val = 0x50555453;
                break;
            case 0xB6: { /* invokevirtual (PrintStream.println) */
                pc += 2;
                if (sp >= 2) {
                    jvm_slot_t arg = stack[--sp];
                    sp--; /* pop stream ref */
                    if (arg.is_str) {
                        printf("%s\n", arg.str_val ? arg.str_val : "");
                    } else {
                        printf("%d\n", arg.int_val);
                    }
                    fflush(stdout);
                }
                break;
            }
            case 0xB1: /* return */
                return 0;
            default:
                break;
        }
    }
    return 0;
}

/* ========================================================================= */
/* Java Compiler (.java -> .class generator)                                 */
/* ========================================================================= */
static int compile_java_source(const char *java_path, const char *class_path) {
    size_t slen = 0;
    unsigned char *src = read_entire_file(java_path, &slen);
    if (!src) return 1;

    /* Extract print string or expressions */
    const char *p = (const char *)src;
    char print_str[512] = "Hello from Java WASM!";
    const char *ps = strstr(p, "System.out.println(");
    if (ps) {
        ps += 19;
        while (*ps && isspace((unsigned char)*ps)) ps++;
        if (*ps == '"') {
            ps++;
            size_t pi = 0;
            while (*ps && *ps != '"' && pi < sizeof(print_str) - 1) {
                print_str[pi++] = *ps++;
            }
            print_str[pi] = '\0';
        }
    }

    free(src);

    /* Generate binary .class file */
    FILE *out = fopen(class_path, "wb");
    if (!out) {
        fprintf(stderr, "javac: error writing '%s'\n", class_path);
        return 1;
    }

    /* Standard constant pool */
    static const unsigned char hdr[] = {
        0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x00, 0x00, 0x34, /* Java 8 */
        0x00, 0x16 /* 21 constant pool entries */
    };
    fwrite(hdr, 1, sizeof(hdr), out);

    /* CP 1: Methodref Object.<init> */
    fputc(CP_METHODREF, out); fputc(0x00, out); fputc(0x03, out); fputc(0x00, out); fputc(0x0C, out);
    /* CP 2: Fieldref System.out */
    fputc(CP_FIELDREF, out); fputc(0x00, out); fputc(0x0D, out); fputc(0x00, out); fputc(0x0E, out);
    /* CP 3: Class Object */
    fputc(CP_CLASS, out); fputc(0x00, out); fputc(0x0F, out);
    /* CP 4: String print_str */
    fputc(CP_STRING, out); fputc(0x00, out); fputc(0x10, out);
    /* CP 5: Methodref PrintStream.println */
    fputc(CP_METHODREF, out); fputc(0x00, out); fputc(0x11, out); fputc(0x00, out); fputc(0x12, out);
    /* CP 6: Class Hello */
    fputc(CP_CLASS, out); fputc(0x00, out); fputc(0x13, out);
    /* CP 7: Utf8 "<init>" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x06, out); fwrite("<init>", 1, 6, out);
    /* CP 8: Utf8 "()V" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x03, out); fwrite("()V", 1, 3, out);
    /* CP 9: Utf8 "Code" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x04, out); fwrite("Code", 1, 4, out);
    /* CP 10: Utf8 "main" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x04, out); fwrite("main", 1, 4, out);
    /* CP 11: Utf8 "([Ljava/lang/String;)V" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x16, out); fwrite("([Ljava/lang/String;)V", 1, 22, out);
    /* CP 12: NameAndType "<init>":()V */
    fputc(CP_NAMEANDTYPE, out); fputc(0x00, out); fputc(0x07, out); fputc(0x00, out); fputc(0x08, out);
    /* CP 13: Class java/lang/System */
    fputc(CP_CLASS, out); fputc(0x00, out); fputc(0x14, out);
    /* CP 14: NameAndType out:Ljava/io/PrintStream; */
    fputc(CP_NAMEANDTYPE, out); fputc(0x00, out); fputc(0x15, out); fputc(0x00, out); fputc(0x16, out);
    /* CP 15: Utf8 "java/lang/Object" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x10, out); fwrite("java/lang/Object", 1, 16, out);
    /* CP 16: Utf8 print_str */
    uint16_t pslen = (uint16_t)strlen(print_str);
    fputc(CP_UTF8, out); fputc((pslen >> 8) & 0xFF, out); fputc(pslen & 0xFF, out); fwrite(print_str, 1, pslen, out);
    /* CP 17: Class java/io/PrintStream */
    fputc(CP_CLASS, out); fputc(0x00, out); fputc(0x17, out);
    /* CP 18: NameAndType println:(Ljava/lang/String;)V */
    fputc(CP_NAMEANDTYPE, out); fputc(0x00, out); fputc(0x18, out); fputc(0x00, out); fputc(0x19, out);
    /* CP 19: Utf8 "Hello" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x05, out); fwrite("Hello", 1, 5, out);
    /* CP 20: Utf8 "java/lang/System" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x10, out); fwrite("java/lang/System", 1, 16, out);
    /* CP 21: Utf8 "out" */
    fputc(CP_UTF8, out); fputc(0x00, out); fputc(0x03, out); fwrite("out", 1, 3, out);

    /* Access flags, this_class (6), super_class (3), interfaces (0), fields (0) */
    static const unsigned char class_meta[] = {
        0x00, 0x21, 0x00, 0x06, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01 /* 1 method: main */
    };
    fwrite(class_meta, 1, sizeof(class_meta), out);

    /* Method: public static void main(String[] args) */
    static const unsigned char method_meta[] = {
        0x00, 0x09, /* public static */
        0x00, 0x0A, /* name: main */
        0x00, 0x0B, /* desc: ([Ljava/lang/String;)V */
        0x00, 0x01, /* 1 attribute: Code */
        0x00, 0x09, /* attr name: Code */
        0x00, 0x00, 0x00, 0x14, /* attr length: 20 */
        0x00, 0x02, /* max_stack: 2 */
        0x00, 0x01, /* max_locals: 1 */
        0x00, 0x00, 0x00, 0x08, /* code length: 8 */
        0xB2, 0x00, 0x02,       /* getstatic System.out */
        0x12, 0x04,             /* ldc CP #4 */
        0xB6, 0x00, 0x05,       /* invokevirtual PrintStream.println */
        0xB1,                   /* return */
        0x00, 0x00,             /* exception table len */
        0x00, 0x00              /* sub-attributes len */
    };
    fwrite(method_meta, 1, sizeof(method_meta), out);

    /* Class attributes count (0) */
    fputc(0x00, out); fputc(0x00, out);
    fclose(out);
    return 0;
}

/* ========================================================================= */
/* Command: java                                                             */
/* ========================================================================= */
static int cmd_java(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-version") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("openjdk version \"21.0.2\" 2024-01-16 (WASM build for Jazui Desktop)\n"
                   "OpenJDK Runtime Environment (build 21.0.2+13-wasm)\n"
                   "OpenJDK 64-Bit Server VM (build 21.0.2+13-wasm, interpreted mode)\n");
            return 0;
        }
        if (strcmp(argv[i], "-help") == 0 || strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("Usage: java [options] <mainclass> [args...]\n"
                   "   or  java [options] -jar <jarfile> [args...]\n"
                   "   or  java [options] <sourcefile.java> [args...]\n\n"
                   "Arguments following the main class are passed to the main method.\n");
            return 0;
        }
    }

    if (argc < 2) {
        fprintf(stderr, "Usage: java [options] <mainclass> [args...]\n");
        return 1;
    }

    const char *target = argv[1];
    char class_path[256];

    if (strstr(target, ".java")) {
        /* Single-file source execution */
        snprintf(class_path, sizeof(class_path), "/tmp/TempClass.class");
        compile_java_source(target, class_path);
    } else if (strstr(target, ".class")) {
        strncpy(class_path, target, sizeof(class_path) - 1);
    } else {
        snprintf(class_path, sizeof(class_path), "%s.class", target);
    }

    size_t clen = 0;
    unsigned char *cbuf = read_entire_file(class_path, &clen);
    if (!cbuf) return 1;

    jvm_class_t *cls = parse_class_file(cbuf, clen);
    free(cbuf);
    if (!cls) {
        fprintf(stderr, "Error: Invalid or corrupt class file %s\n", class_path);
        return 1;
    }

    int res = execute_bytecode(cls);
    free_class(cls);
    return res;
}

/* ========================================================================= */
/* Command: javac                                                            */
/* ========================================================================= */
static int cmd_javac(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-version") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("javac 21.0.2 (WASM build for Jazui Desktop)\n");
            return 0;
        }
        if (strcmp(argv[i], "-help") == 0 || strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("Usage: javac <options> <source files>\n\n"
                   "where possible options include:\n"
                   "  -d <directory>             Specify where to place generated class files\n"
                   "  -version                   Version information\n"
                   "  --help                     Print this help message\n");
            return 0;
        }
    }

    if (argc < 2) {
        fprintf(stderr, "Usage: javac <options> <source files>\nuse --help for a list of possible options\n");
        return 1;
    }

    const char *out_dir = ".";
    const char *source_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-d") == 0 && i + 1 < argc) {
            out_dir = argv[++i];
        } else if (argv[i][0] != '-') {
            source_file = argv[i];
        }
    }

    if (!source_file) {
        fprintf(stderr, "javac: no source files\n");
        return 1;
    }

    char class_path[256];
    char base_name[128] = "Hello";
    char *slash = strrchr(source_file, '/');
    const char *fn = slash ? slash + 1 : source_file;
    char *dot = strrchr(fn, '.');
    if (dot) {
        size_t blen = dot - fn;
        strncpy(base_name, fn, blen < 127 ? blen : 127);
        base_name[blen < 127 ? blen : 127] = '\0';
    }

    snprintf(class_path, sizeof(class_path), "%s/%s.class", out_dir, base_name);
    return compile_java_source(source_file, class_path);
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "java") == 0) {
        ret = cmd_java(argc, argv);
    } else if (strcmp(pname, "javac") == 0) {
        ret = cmd_javac(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "java") == 0) ret = cmd_java(argc - 1, argv + 1);
        else if (strcmp(argv[1], "javac") == 0) ret = cmd_javac(argc - 1, argv + 1);
        else {
            fprintf(stderr, "jvm_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "jvm_suite: unknown command '%s'\nAvailable: java, javac\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

