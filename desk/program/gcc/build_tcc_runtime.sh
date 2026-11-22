#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="/home/jazo/tcc_build"
mkdir -p "$WORK"
cd "$WORK"

if [ ! -f "$WORK/i386-tcc" ]; then
    tar -xjf "$SCRIPT_DIR/../../artifacts/tcc-source.tar.bz2" -C "$WORK"
    cd "$WORK/tcc-0.9.27"
    ./configure --enable-cross
    make i386-tcc
    make i386-libtcc1.a
    cp i386-tcc "$WORK/"
    cp i386-libtcc1.a "$WORK/libtcc1.a"
fi

cd "$WORK"
cat << 'EOF' > crti.S
.section .init
.global _init
_init:
    push %ebp
    mov %esp, %ebp

.section .fini
.global _fini
_fini:
    push %ebp
    mov %esp, %ebp
EOF
./i386-tcc -c crti.S -o crti.o

cat << 'EOF' > crtn.S
.section .init
    leave
    ret

.section .fini
    leave
    ret
EOF
./i386-tcc -c crtn.S -o crtn.o

cat << 'EOF' > crt1.S
.section .text
.global _start
_start:
    xor %ebp, %ebp
    pop %esi
    mov %esp, %ecx
    lea 4(%ecx,%esi,4), %eax
    push %eax
    push %ecx
    push %esi
    call main
    push %eax
    call exit
    hlt
EOF
./i386-tcc -c crt1.S -o crt1.o

cat << 'EOF' > libc.c
typedef unsigned int size_t;
typedef int ssize_t;
typedef int intptr_t;
typedef unsigned int uintptr_t;
typedef long off_t;

#define STDIN_FILENO 0
#define STDOUT_FILENO 1
#define STDERR_FILENO 2

typedef struct FILE FILE;
struct FILE {
    int fd;
    int unget;
    unsigned char r_buf[256];
    int r_pos;
    int r_len;
};

static FILE _stdin_file = { STDIN_FILENO, -1, {0}, 0, 0 };
static FILE _stdout_file = { STDOUT_FILENO, -1, {0}, 0, 0 };
static FILE _stderr_file = { STDERR_FILENO, -1, {0}, 0, 0 };

FILE *stdin = &_stdin_file;
FILE *stdout = &_stdout_file;
FILE *stderr = &_stderr_file;

int errno = 0;

static inline int syscall1(int num, int arg1) {
    int ret;
    __asm__ volatile ("int $0x80" : "=a"(ret) : "a"(num), "b"(arg1) : "memory");
    return ret;
}

static inline int syscall2(int num, int arg1, int arg2) {
    int ret;
    __asm__ volatile ("int $0x80" : "=a"(ret) : "a"(num), "b"(arg1), "c"(arg2) : "memory");
    return ret;
}

static inline int syscall3(int num, int arg1, int arg2, int arg3) {
    int ret;
    __asm__ volatile ("int $0x80" : "=a"(ret) : "a"(num), "b"(arg1), "c"(arg2), "d"(arg3) : "memory");
    return ret;
}

void _exit(int status) {
    syscall1(1, status);
    for (;;);
}

void exit(int status) {
    _exit(status);
}

void abort(void) {
    _exit(134);
}

ssize_t write(int fd, const void *buf, size_t count) {
    return syscall3(4, fd, (int)buf, (int)count);
}

ssize_t read(int fd, void *buf, size_t count) {
    return syscall3(3, fd, (int)buf, (int)count);
}

int open(const char *pathname, int flags, int mode) {
    return syscall3(5, (int)pathname, flags, mode);
}

int close(int fd) {
    return syscall1(6, fd);
}

off_t lseek(int fd, off_t offset, int whence) {
    return syscall3(19, fd, offset, whence);
}

int fflush(FILE *stream) {
    (void)stream;
    return 0;
}

/* Character types */
int isdigit(int c) { return c >= '0' && c <= '9'; }
int isalpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
int isalnum(int c) { return isdigit(c) || isalpha(c); }
int isspace(int c) { return c == ' ' || (c >= 9 && c <= 13); }
int isupper(int c) { return c >= 'A' && c <= 'Z'; }
int islower(int c) { return c >= 'a' && c <= 'z'; }
int isprint(int c) { return c >= 32 && c <= 126; }
int ispunct(int c) { return isprint(c) && !isalnum(c) && c != ' '; }
int isxdigit(int c) { return isdigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
int toupper(int c) { return islower(c) ? c - 'a' + 'A' : c; }
int tolower(int c) { return isupper(c) ? c - 'A' + 'a' : c; }
int abs(int j) { return j < 0 ? -j : j; }
long labs(long j) { return j < 0 ? -j : j; }

/* String & Memory */
size_t strlen(const char *s) {
    size_t len = 0;
    while (*s++) len++;
    return len;
}

int strcmp(const char *s1, const char *s2) {
    while (*s1 && (*s1 == *s2)) { s1++; s2++; }
    return *(const unsigned char *)s1 - *(const unsigned char *)s2;
}

int strncmp(const char *s1, const char *s2, size_t n) {
    while (n && *s1 && (*s1 == *s2)) { s1++; s2++; n--; }
    if (n == 0) return 0;
    return *(const unsigned char *)s1 - *(const unsigned char *)s2;
}

char *strcpy(char *dest, const char *src) {
    char *ret = dest;
    while ((*dest++ = *src++));
    return ret;
}

char *strncpy(char *dest, const char *src, size_t n) {
    char *ret = dest;
    while (n && (*dest++ = *src++)) n--;
    while (n--) *dest++ = 0;
    return ret;
}

char *strcat(char *dest, const char *src) {
    char *ret = dest;
    while (*dest) dest++;
    while ((*dest++ = *src++));
    return ret;
}

char *strncat(char *dest, const char *src, size_t n) {
    char *ret = dest;
    while (*dest) dest++;
    while (n && (*dest++ = *src++)) n--;
    *dest = 0;
    return ret;
}

char *strchr(const char *s, int c) {
    while (*s) {
        if (*s == (char)c) return (char *)s;
        s++;
    }
    return (c == 0) ? (char *)s : 0;
}

char *strrchr(const char *s, int c) {
    const char *last = 0;
    while (*s) {
        if (*s == (char)c) last = s;
        s++;
    }
    if (c == 0) return (char *)s;
    return (char *)last;
}

char *strstr(const char *haystack, const char *needle) {
    if (!*needle) return (char *)haystack;
    size_t nlen = strlen(needle);
    while (*haystack) {
        if (strncmp(haystack, needle, nlen) == 0) return (char *)haystack;
        haystack++;
    }
    return 0;
}

size_t strspn(const char *s, const char *accept) {
    size_t count = 0;
    while (*s && strchr(accept, *s)) { count++; s++; }
    return count;
}

size_t strcspn(const char *s, const char *reject) {
    size_t count = 0;
    while (*s && !strchr(reject, *s)) { count++; s++; }
    return count;
}

char *strpbrk(const char *s, const char *accept) {
    while (*s) {
        if (strchr(accept, *s)) return (char *)s;
        s++;
    }
    return 0;
}

void *memcpy(void *dest, const void *src, size_t n) {
    char *d = (char *)dest;
    const char *s = (const char *)src;
    while (n--) *d++ = *s++;
    return dest;
}

void *memmove(void *dest, const void *src, size_t n) {
    char *d = (char *)dest;
    const char *s = (const char *)src;
    if (d < s) {
        while (n--) *d++ = *s++;
    } else {
        d += n; s += n;
        while (n--) *--d = *--s;
    }
    return dest;
}

void *memset(void *s, int c, size_t n) {
    unsigned char *p = (unsigned char *)s;
    while (n--) *p++ = (unsigned char)c;
    return s;
}

int memcmp(const void *s1, const void *s2, size_t n) {
    const unsigned char *p1 = (const unsigned char *)s1;
    const unsigned char *p2 = (const unsigned char *)s2;
    while (n--) {
        if (*p1 != *p2) return *p1 - *p2;
        p1++; p2++;
    }
    return 0;
}

void *memchr(const void *s, int c, size_t n) {
    const unsigned char *p = (const unsigned char *)s;
    while (n--) {
        if (*p == (unsigned char)c) return (void *)p;
        p++;
    }
    return 0;
}

/* Heap allocator */
static char heap_arena[512 * 1024];
static size_t heap_offset = 0;

void *malloc(size_t size) {
    size = (size + 7) & ~7;
    if (heap_offset + size > sizeof(heap_arena)) return 0;
    void *ptr = &heap_arena[heap_offset];
    heap_offset += size;
    return ptr;
}

void free(void *ptr) {
    (void)ptr;
}

void *calloc(size_t nmemb, size_t size) {
    size_t total = nmemb * size;
    void *p = malloc(total);
    if (p) memset(p, 0, total);
    return p;
}

void *realloc(void *ptr, size_t size) {
    if (!ptr) return malloc(size);
    void *new_p = malloc(size);
    if (new_p) memcpy(new_p, ptr, size);
    return new_p;
}

char *strdup(const char *s) {
    size_t len = strlen(s) + 1;
    char *p = (char *)malloc(len);
    if (p) memcpy(p, s, len);
    return p;
}

/* Standard I/O core */
int ungetc(int c, FILE *stream) {
    if (!stream) stream = stdin;
    if (c == -1) return -1;
    stream->unget = (unsigned char)c;
    return c;
}

int fgetc(FILE *stream) {
    if (!stream) stream = stdin;
    if (stream->unget != -1) {
        int c = stream->unget;
        stream->unget = -1;
        return c;
    }
    if (stream->r_pos < stream->r_len) {
        return stream->r_buf[stream->r_pos++];
    }
    ssize_t n = read(stream->fd, stream->r_buf, sizeof(stream->r_buf));
    if (n <= 0) return -1;
    stream->r_len = (int)n;
    stream->r_pos = 1;
    return stream->r_buf[0];
}

int getc(FILE *stream) {
    return fgetc(stream);
}

int getchar(void) {
    return fgetc(stdin);
}

int fputc(int c, FILE *stream) {
    char ch = (char)c;
    write(stream ? stream->fd : STDOUT_FILENO, &ch, 1);
    return c;
}

int putc(int c, FILE *stream) {
    return fputc(c, stream);
}

int putchar(int c) {
    return fputc(c, stdout);
}

int fputs(const char *s, FILE *stream) {
    int fd = stream ? stream->fd : STDOUT_FILENO;
    size_t len = strlen(s);
    return write(fd, s, len) == (ssize_t)len ? 0 : -1;
}

int puts(const char *s) {
    write(STDOUT_FILENO, s, strlen(s));
    write(STDOUT_FILENO, "\n", 1);
    return 0;
}

char *fgets(char *s, int size, FILE *stream) {
    if (size <= 0) return 0;
    int i = 0;
    while (i < size - 1) {
        int c = fgetc(stream);
        if (c == -1) { if (i == 0) return 0; break; }
        s[i++] = (char)c;
        if (c == '\n') break;
    }
    s[i] = 0;
    return s;
}

FILE *fopen(const char *pathname, const char *mode) {
    int flags = 0;
    if (strchr(mode, '+')) flags = 2;
    else if (strchr(mode, 'w') || strchr(mode, 'a')) flags = 1;
    else flags = 0;
    if (strchr(mode, 'w')) flags |= 0100 | 01000;
    if (strchr(mode, 'a')) flags |= 0100 | 02000;
    int fd = open(pathname, flags, 0666);
    if (fd < 0) return 0;
    FILE *fp = (FILE *)malloc(sizeof(FILE));
    if (!fp) { close(fd); return 0; }
    fp->fd = fd;
    fp->unget = -1;
    fp->r_pos = 0;
    fp->r_len = 0;
    return fp;
}

int fclose(FILE *stream) {
    if (!stream || stream == stdin || stream == stdout || stream == stderr) return 0;
    int ret = close(stream->fd);
    free(stream);
    return ret;
}

size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream) {
    size_t total = size * nmemb;
    char *p = (char *)ptr;
    size_t done = 0;
    while (done < total) {
        int c = fgetc(stream);
        if (c == -1) break;
        p[done++] = (char)c;
    }
    return size ? (done / size) : 0;
}

size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream) {
    size_t total = size * nmemb;
    int fd = stream ? stream->fd : STDOUT_FILENO;
    ssize_t n = write(fd, ptr, total);
    return (n > 0 && size > 0) ? ((size_t)n / size) : 0;
}

/* Number conversions */
long strtol(const char *nptr, char **endptr, int base) {
    const char *s = nptr;
    while (isspace((unsigned char)*s)) s++;
    int neg = 0;
    if (*s == '-') { neg = 1; s++; }
    else if (*s == '+') s++;

    if ((base == 0 || base == 16) && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        s += 2;
        base = 16;
    }
    if (base == 0) base = (s[0] == '0') ? 8 : 10;

    unsigned long acc = 0;
    int any = 0;
    while (*s) {
        int val;
        if (isdigit((unsigned char)*s)) val = *s - '0';
        else if (isalpha((unsigned char)*s)) val = toupper((unsigned char)*s) - 'A' + 10;
        else break;
        if (val >= base) break;
        acc = acc * base + val;
        any = 1;
        s++;
    }
    if (endptr) *endptr = (char *)(any ? s : nptr);
    return neg ? -(long)acc : (long)acc;
}

unsigned long strtoul(const char *nptr, char **endptr, int base) {
    return (unsigned long)strtol(nptr, endptr, base);
}

int atoi(const char *nptr) {
    return (int)strtol(nptr, 0, 10);
}

long atol(const char *nptr) {
    return strtol(nptr, 0, 10);
}

double atof(const char *nptr) {
    const char *s = nptr;
    while (isspace((unsigned char)*s)) s++;
    double sign = 1.0;
    if (*s == '-') { sign = -1.0; s++; }
    else if (*s == '+') s++;

    double val = 0.0;
    while (isdigit((unsigned char)*s)) {
        val = val * 10.0 + (*s - '0');
        s++;
    }
    if (*s == '.') {
        s++;
        double frac = 0.1;
        while (isdigit((unsigned char)*s)) {
            val += (*s - '0') * frac;
            frac *= 0.1;
            s++;
        }
    }
    return sign * val;
}

double strtod(const char *nptr, char **endptr) {
    if (endptr) *endptr = (char *)nptr;
    return atof(nptr);
}

/* Formatted Output */
typedef char *va_list;
#define va_start(ap, last) (ap = (char *)&(last) + ((sizeof(last) + 3) & ~3))
#define va_arg(ap, type) (*(type *)((ap += ((sizeof(type) + 3) & ~3)) - ((sizeof(type) + 3) & ~3)))
#define va_end(ap)

static void print_num(int fd, unsigned long num, int base, int sign) {
    char buf[32];
    int i = 0;
    if (sign && (long)num < 0) {
        write(fd, "-", 1);
        num = -num;
    }
    if (num == 0) {
        write(fd, "0", 1);
        return;
    }
    static const char digits[] = "0123456789abcdef";
    while (num > 0) {
        buf[i++] = digits[num % (unsigned long)base];
        num /= (unsigned long)base;
    }
    while (i > 0) {
        write(fd, &buf[--i], 1);
    }
}

int vfprintf(FILE *stream, const char *fmt, va_list ap) {
    int fd = stream ? stream->fd : STDOUT_FILENO;
    int count = 0;
    while (*fmt) {
        if (*fmt == '%') {
            fmt++;
            if (*fmt == 'd' || *fmt == 'i') {
                int val = va_arg(ap, int);
                print_num(fd, (unsigned long)val, 10, 1);
            } else if (*fmt == 'u') {
                unsigned int val = va_arg(ap, unsigned int);
                print_num(fd, (unsigned long)val, 10, 0);
            } else if (*fmt == 'x' || *fmt == 'X') {
                unsigned int val = va_arg(ap, unsigned int);
                print_num(fd, (unsigned long)val, 16, 0);
            } else if (*fmt == 'p') {
                unsigned int val = va_arg(ap, unsigned int);
                write(fd, "0x", 2);
                print_num(fd, (unsigned long)val, 16, 0);
            } else if (*fmt == 's') {
                const char *s = va_arg(ap, const char *);
                if (!s) s = "(null)";
                write(fd, s, strlen(s));
            } else if (*fmt == 'c') {
                char c = (char)va_arg(ap, int);
                write(fd, &c, 1);
            } else if (*fmt == '%') {
                write(fd, "%", 1);
            }
        } else {
            write(fd, fmt, 1);
        }
        fmt++;
        count++;
    }
    return count;
}

int fprintf(FILE *stream, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vfprintf(stream, fmt, ap);
    va_end(ap);
    return ret;
}

int printf(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vfprintf(stdout, fmt, ap);
    va_end(ap);
    return ret;
}

int sprintf(char *str, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    char *orig = str;
    while (*fmt) {
        if (*fmt == '%') {
            fmt++;
            if (*fmt == 'd' || *fmt == 'i') {
                long val = va_arg(ap, int);
                if (val < 0) { *str++ = '-'; val = -val; }
                char buf[32]; int i = 0;
                if (val == 0) *str++ = '0';
                else {
                    while (val > 0) { buf[i++] = '0' + (val % 10); val /= 10; }
                    while (i > 0) *str++ = buf[--i];
                }
            } else if (*fmt == 'u') {
                unsigned long val = va_arg(ap, unsigned int);
                char buf[32]; int i = 0;
                if (val == 0) *str++ = '0';
                else {
                    while (val > 0) { buf[i++] = '0' + (val % 10); val /= 10; }
                    while (i > 0) *str++ = buf[--i];
                }
            } else if (*fmt == 's') {
                const char *s = va_arg(ap, const char *);
                if (!s) s = "(null)";
                while (*s) *str++ = *s++;
            } else if (*fmt == 'c') {
                *str++ = (char)va_arg(ap, int);
            } else if (*fmt == '%') {
                *str++ = '%';
            }
        } else {
            *str++ = *fmt;
        }
        fmt++;
    }
    *str = 0;
    va_end(ap);
    return str - orig;
}

int snprintf(char *str, size_t size, const char *fmt, ...) {
    (void)size;
    va_list ap;
    va_start(ap, fmt);
    int ret = sprintf(str, fmt, ap);
    va_end(ap);
    return ret;
}

/* Formatted Input (scanf, sscanf, fscanf) */
static int src_get(int is_str, const char **str_ptr, FILE *stream) {
    if (is_str) {
        return **str_ptr ? (unsigned char)*(*str_ptr)++ : -1;
    }
    return fgetc(stream);
}

static void src_unget(int is_str, const char **str_ptr, FILE *stream, int c) {
    if (c == -1) return;
    if (is_str) {
        (*str_ptr)--;
    } else {
        ungetc(c, stream);
    }
}

static int vscan_core(int is_str, const char **str_ptr, FILE *stream, const char *fmt, va_list ap) {
    int matched = 0;
    while (*fmt) {
        if (isspace((unsigned char)*fmt)) {
            while (isspace((unsigned char)*fmt)) fmt++;
            int c;
            while ((c = src_get(is_str, str_ptr, stream)) != -1 && isspace((unsigned char)c));
            if (c != -1) src_unget(is_str, str_ptr, stream, c);
            continue;
        }

        if (*fmt != '%') {
            int c = src_get(is_str, str_ptr, stream);
            if (c != (unsigned char)*fmt) {
                if (c != -1) src_unget(is_str, str_ptr, stream, c);
                return matched;
            }
            fmt++;
            continue;
        }

        fmt++; /* skip '%' */
        if (*fmt == '%') {
            int c = src_get(is_str, str_ptr, stream);
            if (c != '%') {
                if (c != -1) src_unget(is_str, str_ptr, stream, c);
                return matched;
            }
            fmt++;
            continue;
        }

        int suppress = 0;
        if (*fmt == '*') {
            suppress = 1;
            fmt++;
        }

        int width = 0;
        while (isdigit((unsigned char)*fmt)) {
            width = width * 10 + (*fmt - '0');
            fmt++;
        }
        if (width <= 0) width = 0x7FFFFFFF;

        int len_mod = 0;
        if (*fmt == 'l') {
            len_mod = 2;
            fmt++;
            if (*fmt == 'l') { len_mod = 3; fmt++; }
        } else if (*fmt == 'h') {
            len_mod = 1;
            fmt++;
        }

        char spec = *fmt++;

        /* Scanset: %[...] */
        if (spec == '[') {
            int invert = 0;
            if (*fmt == '^') {
                invert = 1;
                fmt++;
            }
            char table[256] = {0};
            if (*fmt == ']') {
                table[(unsigned char)']'] = 1;
                fmt++;
            }
            while (*fmt && *fmt != ']') {
                if (fmt[1] == '-' && fmt[2] && fmt[2] != ']') {
                    unsigned char start = (unsigned char)*fmt;
                    unsigned char end = (unsigned char)fmt[2];
                    for (int ch = start; ch <= end; ch++) table[ch] = 1;
                    fmt += 3;
                } else {
                    table[(unsigned char)*fmt++] = 1;
                }
            }
            if (*fmt == ']') fmt++;

            char *out_str = suppress ? 0 : va_arg(ap, char *);
            int count = 0;
            int c;
            while (count < width && (c = src_get(is_str, str_ptr, stream)) != -1) {
                int in_set = table[(unsigned char)c];
                if (invert) in_set = !in_set;
                if (!in_set) {
                    src_unget(is_str, str_ptr, stream, c);
                    break;
                }
                if (out_str) out_str[count] = (char)c;
                count++;
            }
            if (count == 0) {
                if (c == -1 && matched == 0) return -1;
                return matched;
            }
            if (out_str) out_str[count] = '\0';
            if (!suppress) matched++;
            continue;
        }

        /* %c */
        if (spec == 'c') {
            char *out_c = suppress ? 0 : va_arg(ap, char *);
            int count = (width == 0x7FFFFFFF) ? 1 : width;
            int read_chars = 0;
            for (int i = 0; i < count; i++) {
                int c = src_get(is_str, str_ptr, stream);
                if (c == -1) break;
                if (out_c) out_c[i] = (char)c;
                read_chars++;
            }
            if (read_chars == 0) {
                if (matched == 0) return -1;
                return matched;
            }
            if (!suppress) matched++;
            continue;
        }

        /* Skip leading whitespace for all other specifiers */
        int c;
        while ((c = src_get(is_str, str_ptr, stream)) != -1 && isspace((unsigned char)c));
        if (c == -1) return matched ? matched : -1;
        src_unget(is_str, str_ptr, stream, c);

        /* %s */
        if (spec == 's') {
            char *out_s = suppress ? 0 : va_arg(ap, char *);
            int count = 0;
            while (count < width && (c = src_get(is_str, str_ptr, stream)) != -1 && !isspace((unsigned char)c)) {
                if (out_s) out_s[count] = (char)c;
                count++;
            }
            if (c != -1 && isspace((unsigned char)c)) src_unget(is_str, str_ptr, stream, c);
            if (count == 0) return matched;
            if (out_s) out_s[count] = '\0';
            if (!suppress) matched++;
            continue;
        }

        /* %d, %i, %u, %x, %o, %p */
        if (spec == 'd' || spec == 'i' || spec == 'u' || spec == 'x' || spec == 'X' || spec == 'o' || spec == 'p') {
            int base = 10;
            if (spec == 'x' || spec == 'X' || spec == 'p') base = 16;
            else if (spec == 'o') base = 8;
            else if (spec == 'i') base = 0;

            char num_buf[64];
            int ni = 0;
            c = src_get(is_str, str_ptr, stream);
            if (c == '+' || c == '-') {
                num_buf[ni++] = c;
                c = src_get(is_str, str_ptr, stream);
            }
            if (c == '0' && (base == 0 || base == 16)) {
                int c2 = src_get(is_str, str_ptr, stream);
                if (c2 == 'x' || c2 == 'X') {
                    base = 16;
                } else {
                    if (c2 != -1) src_unget(is_str, str_ptr, stream, c2);
                    if (base == 0) base = 8;
                }
            }
            if (base == 0) base = 10;

            while (ni < 60 && c != -1) {
                int valid = 0;
                if (isdigit((unsigned char)c)) valid = 1;
                else if (base == 16 && ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) valid = 1;
                if (!valid) {
                    src_unget(is_str, str_ptr, stream, c);
                    break;
                }
                num_buf[ni++] = c;
                c = src_get(is_str, str_ptr, stream);
            }
            num_buf[ni] = '\0';
            if (ni == 0) return matched;

            char *endp = 0;
            long val = strtol(num_buf, &endp, base);

            if (!suppress) {
                if (len_mod == 1) {
                    short *p = va_arg(ap, short *);
                    *p = (short)val;
                } else if (len_mod == 2 || len_mod == 3) {
                    long *p = va_arg(ap, long *);
                    *p = val;
                } else {
                    int *p = va_arg(ap, int *);
                    *p = (int)val;
                }
                matched++;
            }
            continue;
        }

        /* %f, %lf, %g */
        if (spec == 'f' || spec == 'g' || spec == 'e') {
            char fbuf[64];
            int fi = 0;
            while (fi < 60 && (c = src_get(is_str, str_ptr, stream)) != -1) {
                if (isdigit((unsigned char)c) || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E') {
                    fbuf[fi++] = c;
                } else {
                    src_unget(is_str, str_ptr, stream, c);
                    break;
                }
            }
            fbuf[fi] = '\0';
            if (fi == 0) return matched;
            if (!suppress) {
                if (len_mod == 2) {
                    double *p = va_arg(ap, double *);
                    *p = atof(fbuf);
                } else {
                    float *p = va_arg(ap, float *);
                    *p = (float)atof(fbuf);
                }
                matched++;
            }
            continue;
        }
    }
    return matched;
}

int vfscanf(FILE *stream, const char *fmt, va_list ap) {
    return vscan_core(0, 0, stream ? stream : stdin, fmt, ap);
}

int vscanf(const char *fmt, va_list ap) {
    return vfscanf(stdin, fmt, ap);
}

int vsscanf(const char *str, const char *fmt, va_list ap) {
    const char *p = str;
    return vscan_core(1, &p, 0, fmt, ap);
}

int fscanf(FILE *stream, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vfscanf(stream, fmt, ap);
    va_end(ap);
    return ret;
}

int scanf(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vscanf(fmt, ap);
    va_end(ap);
    return ret;
}

int sscanf(const char *str, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vsscanf(str, fmt, ap);
    va_end(ap);
    return ret;
}

/* Utilities */
static char *_strtok_ctx = 0;
char *strtok_r(char *str, const char *delim, char **saveptr) {
    char *s = str ? str : *saveptr;
    if (!s) return 0;
    while (*s && strchr(delim, *s)) s++;
    if (!*s) { *saveptr = 0; return 0; }
    char *token = s;
    while (*s && !strchr(delim, *s)) s++;
    if (*s) { *s++ = 0; *saveptr = s; }
    else { *saveptr = 0; }
    return token;
}

char *strtok(char *str, const char *delim) {
    return strtok_r(str, delim, &_strtok_ctx);
}

static void qsort_swap(char *a, char *b, size_t size) {
    while (size--) {
        char t = *a; *a++ = *b; *b++ = t;
    }
}

void qsort(void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *)) {
    if (nmemb <= 1 || size == 0) return;
    char *arr = (char *)base;
    for (size_t i = 0; i < nmemb - 1; i++) {
        for (size_t j = 0; j < nmemb - 1 - i; j++) {
            if (compar(arr + j * size, arr + (j + 1) * size) > 0) {
                qsort_swap(arr + j * size, arr + (j + 1) * size, size);
            }
        }
    }
}

void *bsearch(const void *key, const void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *)) {
    size_t l = 0, r = nmemb;
    while (l < r) {
        size_t m = l + (r - l) / 2;
        int cmp = compar(key, (const char *)base + m * size);
        if (cmp == 0) return (void *)((const char *)base + m * size);
        if (cmp < 0) r = m;
        else l = m + 1;
    }
    return 0;
}

static unsigned long _next_rand = 1;
int rand(void) {
    _next_rand = _next_rand * 1103515245 + 12345;
    return (unsigned int)(_next_rand / 65536) % 32768;
}
void srand(unsigned int seed) {
    _next_rand = seed;
}

char *strerror(int errnum) {
    (void)errnum;
    return "Unknown error";
}

void perror(const char *s) {
    if (s && *s) {
        write(STDERR_FILENO, s, strlen(s));
        write(STDERR_FILENO, ": ", 2);
    }
    write(STDERR_FILENO, "Error\n", 6);
}
EOF

./i386-tcc -c libc.c -o libc.o
./i386-tcc -ar rcs libc.a libc.o

mkdir -p "$SCRIPT_DIR/runtime"
cp crt1.o crti.o crtn.o libc.a libtcc1.a "$SCRIPT_DIR/runtime/"
ls -la "$SCRIPT_DIR/runtime"

echo "TCC runtime built successfully."
