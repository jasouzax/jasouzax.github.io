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

#define STDIN_FILENO 0
#define STDOUT_FILENO 1
#define STDERR_FILENO 2

typedef struct FILE FILE;
struct FILE {
    int fd;
};

static FILE _stdin_file = { STDIN_FILENO };
static FILE _stdout_file = { STDOUT_FILENO };
static FILE _stderr_file = { STDERR_FILENO };

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

int fflush(FILE *stream) {
    (void)stream;
    return 0;
}

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
static char heap_arena[256 * 1024];
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

int putchar(int c) {
    char ch = (char)c;
    write(STDOUT_FILENO, &ch, 1);
    return c;
}

int getchar(void) {
    unsigned char c;
    if (read(STDIN_FILENO, &c, 1) == 1) return c;
    return -1;
}

int fputc(int c, FILE *stream) {
    char ch = (char)c;
    write(stream ? stream->fd : STDOUT_FILENO, &ch, 1);
    return c;
}

int fgetc(FILE *stream) {
    unsigned char c;
    if (read(stream ? stream->fd : STDIN_FILENO, &c, 1) == 1) return c;
    return -1;
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
    int fd = stream ? stream->fd : STDIN_FILENO;
    int i = 0;
    while (i < size - 1) {
        char c;
        if (read(fd, &c, 1) != 1) { if (i == 0) return 0; break; }
        s[i++] = c;
        if (c == '\n') break;
    }
    s[i] = 0;
    return s;
}

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
    while (num > 0) {
        int rem = num % base;
        buf[i++] = (rem < 10) ? ('0' + rem) : ('a' + rem - 10);
        num /= base;
    }
    while (i > 0) {
        write(fd, &buf[--i], 1);
    }
}

typedef char *va_list;
#define va_start(ap, last) (ap = (char *)&(last) + ((sizeof(last) + 3) & ~3))
#define va_arg(ap, type) (*(type *)((ap += ((sizeof(type) + 3) & ~3)) - ((sizeof(type) + 3) & ~3)))
#define va_end(ap)

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

int atoi(const char *nptr) {
    int res = 0, sign = 1;
    while (*nptr == ' ' || (*nptr >= 9 && *nptr <= 13)) nptr++;
    if (*nptr == '-') { sign = -1; nptr++; }
    else if (*nptr == '+') nptr++;
    while (*nptr >= '0' && *nptr <= '9') {
        res = res * 10 + (*nptr - '0');
        nptr++;
    }
    return sign * res;
}

long atol(const char *nptr) {
    return (long)atoi(nptr);
}

int isdigit(int c) { return c >= '0' && c <= '9'; }
int isalpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
int isalnum(int c) { return isdigit(c) || isalpha(c); }
int isspace(int c) { return c == ' ' || (c >= 9 && c <= 13); }
int isupper(int c) { return c >= 'A' && c <= 'Z'; }
int islower(int c) { return c >= 'a' && c <= 'z'; }
int toupper(int c) { return islower(c) ? c - 'a' + 'A' : c; }
int tolower(int c) { return isupper(c) ? c - 'A' + 'a' : c; }
int abs(int j) { return j < 0 ? -j : j; }
long labs(long j) { return j < 0 ? -j : j; }

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
