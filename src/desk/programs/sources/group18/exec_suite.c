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

static unsigned char *read_file(const char *path, size_t *out_len) {
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Cannot open '%s'\n", path);
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
/* Virtual x86 CPU and Memory Model                                          */
/* ========================================================================= */
#define MEM_BASE 0x00400000
#define MEM_SIZE 0x01000000 /* 16 MB virtual address space */
#define GET_STACK_TOP(c) ((c)->mem_base + (c)->mem_size - 0x10000)

typedef struct {
    uint32_t eax, ecx, edx, ebx, esp, ebp, esi, edi;
    uint32_t eip;
    uint32_t eflags;
    int halted;
    int exit_code;
    unsigned char *mem;
    uint32_t mem_base;
    uint32_t mem_size;
    uint32_t brk;
} x86_cpu_t;

static inline int mem_valid(x86_cpu_t *cpu, uint32_t addr, size_t len) {
    if (addr < cpu->mem_base) return 0;
    if (addr + len > cpu->mem_base + cpu->mem_size) return 0;
    return 1;
}

static inline uint8_t mem_read8(x86_cpu_t *cpu, uint32_t addr) {
    if (!mem_valid(cpu, addr, 1)) return 0;
    return cpu->mem[addr - cpu->mem_base];
}

static inline uint16_t mem_read16(x86_cpu_t *cpu, uint32_t addr) {
    if (!mem_valid(cpu, addr, 2)) return 0;
    return *(uint16_t *)(cpu->mem + (addr - cpu->mem_base));
}

static inline uint32_t mem_read32(x86_cpu_t *cpu, uint32_t addr) {
    if (!mem_valid(cpu, addr, 4)) return 0;
    return *(uint32_t *)(cpu->mem + (addr - cpu->mem_base));
}

static inline void mem_write8(x86_cpu_t *cpu, uint32_t addr, uint8_t val) {
    if (mem_valid(cpu, addr, 1)) cpu->mem[addr - cpu->mem_base] = val;
}

static inline void mem_write16(x86_cpu_t *cpu, uint32_t addr, uint16_t val) {
    if (mem_valid(cpu, addr, 2)) *(uint16_t *)(cpu->mem + (addr - cpu->mem_base)) = val;
}

static inline void mem_write32(x86_cpu_t *cpu, uint32_t addr, uint32_t val) {
    if (mem_valid(cpu, addr, 4)) *(uint32_t *)(cpu->mem + (addr - cpu->mem_base)) = val;
}

static void cpu_push32(x86_cpu_t *cpu, uint32_t val) {
    cpu->esp -= 4;
    mem_write32(cpu, cpu->esp, val);
}

static uint32_t cpu_pop32(x86_cpu_t *cpu) {
    uint32_t val = mem_read32(cpu, cpu->esp);
    cpu->esp += 4;
    return val;
}

/* ModR/M & SIB helper */
typedef struct {
    int is_reg;
    int reg_num;
    uint32_t *reg_ptr;
    uint32_t mem_addr;
} operand_t;

static uint32_t *get_reg32(x86_cpu_t *cpu, int reg) {
    switch (reg & 7) {
        case 0: return &cpu->eax;
        case 1: return &cpu->ecx;
        case 2: return &cpu->edx;
        case 3: return &cpu->ebx;
        case 4: return &cpu->esp;
        case 5: return &cpu->ebp;
        case 6: return &cpu->esi;
        case 7: return &cpu->edi;
        default: return &cpu->eax;
    }
}

static inline uint8_t read_reg8(x86_cpu_t *cpu, int reg) {
    switch (reg & 7) {
        case 0: return (uint8_t)(cpu->eax & 0xFF);
        case 1: return (uint8_t)(cpu->ecx & 0xFF);
        case 2: return (uint8_t)(cpu->edx & 0xFF);
        case 3: return (uint8_t)(cpu->ebx & 0xFF);
        case 4: return (uint8_t)((cpu->eax >> 8) & 0xFF);
        case 5: return (uint8_t)((cpu->ecx >> 8) & 0xFF);
        case 6: return (uint8_t)((cpu->edx >> 8) & 0xFF);
        case 7: return (uint8_t)((cpu->ebx >> 8) & 0xFF);
        default: return 0;
    }
}

static inline void write_reg8(x86_cpu_t *cpu, int reg, uint8_t val) {
    switch (reg & 7) {
        case 0: cpu->eax = (cpu->eax & ~0xFF) | val; break;
        case 1: cpu->ecx = (cpu->ecx & ~0xFF) | val; break;
        case 2: cpu->edx = (cpu->edx & ~0xFF) | val; break;
        case 3: cpu->ebx = (cpu->ebx & ~0xFF) | val; break;
        case 4: cpu->eax = (cpu->eax & ~0xFF00) | ((uint32_t)val << 8); break;
        case 5: cpu->ecx = (cpu->ecx & ~0xFF00) | ((uint32_t)val << 8); break;
        case 6: cpu->edx = (cpu->edx & ~0xFF00) | ((uint32_t)val << 8); break;
        case 7: cpu->ebx = (cpu->ebx & ~0xFF00) | ((uint32_t)val << 8); break;
    }
}

static operand_t decode_modrm(x86_cpu_t *cpu, uint8_t modrm) {
    operand_t op;
    int mod = (modrm >> 6) & 3;
    int rm = modrm & 7;

    if (mod == 3) {
        op.is_reg = 1;
        op.reg_num = rm;
        op.reg_ptr = get_reg32(cpu, rm);
        op.mem_addr = 0;
        return op;
    }

    op.is_reg = 0;
    op.reg_num = -1;
    op.reg_ptr = NULL;
    uint32_t base = 0;

    if (rm == 4) {
        /* SIB byte */
        uint8_t sib = mem_read8(cpu, cpu->eip++);
        int scale = (sib >> 6) & 3;
        int index = (sib >> 3) & 7;
        int sbase = sib & 7;

        if (sbase == 5 && mod == 0) {
            base = mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
        } else {
            base = *get_reg32(cpu, sbase);
        }
        if (index != 4) {
            base += (*get_reg32(cpu, index)) << scale;
        }
    } else if (rm == 5 && mod == 0) {
        base = mem_read32(cpu, cpu->eip);
        cpu->eip += 4;
    } else {
        base = *get_reg32(cpu, rm);
    }

    if (mod == 1) {
        int8_t disp8 = (int8_t)mem_read8(cpu, cpu->eip++);
        base += (int32_t)disp8;
    } else if (mod == 2) {
        int32_t disp32 = (int32_t)mem_read32(cpu, cpu->eip);
        cpu->eip += 4;
        base += disp32;
    }

    op.mem_addr = base;
    return op;
}

static uint32_t op_read32(x86_cpu_t *cpu, operand_t op) {
    return op.is_reg ? *op.reg_ptr : mem_read32(cpu, op.mem_addr);
}

static void op_write32(x86_cpu_t *cpu, operand_t op, uint32_t val) {
    if (op.is_reg) *op.reg_ptr = val;
    else mem_write32(cpu, op.mem_addr, val);
}

static uint8_t op_read8(x86_cpu_t *cpu, operand_t op) {
    if (op.is_reg) return read_reg8(cpu, op.reg_num);
    return mem_read8(cpu, op.mem_addr);
}

static uint16_t op_read16(x86_cpu_t *cpu, operand_t op) {
    if (op.is_reg) return (uint16_t)(*op.reg_ptr & 0xFFFF);
    return mem_read16(cpu, op.mem_addr);
}

static void op_write8(x86_cpu_t *cpu, operand_t op, uint8_t val) {
    if (op.is_reg) write_reg8(cpu, op.reg_num, val);
    else mem_write8(cpu, op.mem_addr, val);
}

static inline void set_flags_sub32(x86_cpu_t *cpu, uint32_t a, uint32_t b) {
    uint32_t res = a - b;
    int zf = (res == 0);
    int sf = ((res & 0x80000000) != 0);
    int cf = (a < b);
    int of = (((a ^ b) & (a ^ res) & 0x80000000) != 0);
    cpu->eflags = (zf ? 0x40 : 0) | (sf ? 0x80 : 0) | (cf ? 0x01 : 0) | (of ? 0x800 : 0);
}

static inline void set_flags_sub8(x86_cpu_t *cpu, uint8_t a, uint8_t b) {
    uint8_t res = (uint8_t)(a - b);
    int zf = (res == 0);
    int sf = ((res & 0x80) != 0);
    int cf = (a < b);
    int of = (((a ^ b) & (a ^ res) & 0x80) != 0);
    cpu->eflags = (zf ? 0x40 : 0) | (sf ? 0x80 : 0) | (cf ? 0x01 : 0) | (of ? 0x800 : 0);
}

static inline int check_condition(x86_cpu_t *cpu, int cond) {
    int zf = (cpu->eflags & 0x40) != 0;
    int sf = (cpu->eflags & 0x80) != 0;
    int cf = (cpu->eflags & 0x01) != 0;
    int of = (cpu->eflags & 0x800) != 0;
    switch (cond) {
        case 0x0: return of;
        case 0x1: return !of;
        case 0x2: return cf;
        case 0x3: return !cf;
        case 0x4: return zf;
        case 0x5: return !zf;
        case 0x6: return cf || zf;
        case 0x7: return !cf && !zf;
        case 0x8: return sf;
        case 0x9: return !sf;
        case 0xC: return sf != of;
        case 0xD: return sf == of;
        case 0xE: return zf || (sf != of);
        case 0xF: return !zf && (sf == of);
        default: return 0;
    }
}

/* Linux Syscall Emulation */
static void handle_linux_syscall(x86_cpu_t *cpu) {
    uint32_t nr = cpu->eax;
    switch (nr) {
        case 1: /* sys_exit */
            cpu->halted = 1;
            cpu->exit_code = (int)cpu->ebx;
            break;
        case 3: { /* sys_read */
            int fd = (int)cpu->ebx;
            uint32_t buf = cpu->ecx;
            uint32_t count = cpu->edx;
            if (!mem_valid(cpu, buf, count)) { cpu->eax = -14; break; }
            ssize_t n = read(fd, cpu->mem + (buf - cpu->mem_base), count);
            cpu->eax = (uint32_t)n;
            break;
        }
        case 4: { /* sys_write */
            int fd = (int)cpu->ebx;
            uint32_t buf = cpu->ecx;
            uint32_t count = cpu->edx;
            if (!mem_valid(cpu, buf, count)) { cpu->eax = -14; break; }
            FILE *fp = (fd == 2) ? stderr : stdout;
            size_t written = fwrite(cpu->mem + (buf - cpu->mem_base), 1, count, fp);
            fflush(fp);
            cpu->eax = (uint32_t)written;
            break;
        }
        case 45: { /* sys_brk */
            uint32_t new_brk = cpu->ebx;
            if (new_brk != 0 && new_brk >= cpu->mem_base && new_brk < GET_STACK_TOP(cpu)) {
                cpu->brk = new_brk;
            }
            cpu->eax = cpu->brk;
            break;
        }
        case 54: /* sys_ioctl */
            cpu->eax = 0;
            break;
        case 122: { /* sys_uname */
            uint32_t buf = cpu->ebx;
            if (mem_valid(cpu, buf, 65 * 5)) {
                unsigned char *p = cpu->mem + (buf - cpu->mem_base);
                memset(p, 0, 65 * 5);
                strncpy((char *)p, "Linux", 64);
                strncpy((char *)p + 65, "jazu", 64);
                strncpy((char *)p + 130, "6.1.0-jazu", 64);
                strncpy((char *)p + 195, "#1 SMP PREEMPT Jazui 2026", 64);
                strncpy((char *)p + 260, "i686", 64);
                cpu->eax = 0;
            } else {
                cpu->eax = -14;
            }
            break;
        }
        default:
            cpu->eax = 0;
            break;
    }
}

/* Windows API Emulation Hooks */
#define WIN_TRAP_BASE 0x7FFE0000

enum {
    WIN_API_EXIT_PROCESS = 1,
    WIN_API_GET_STD_HANDLE,
    WIN_API_WRITE_FILE,
    WIN_API_READ_FILE,
    WIN_API_GET_COMMAND_LINE_A,
    WIN_API_GET_MODULE_HANDLE_A,
    WIN_API_VIRTUAL_ALLOC,
    WIN_API_PUTS,
    WIN_API_PRINTF
};

static void handle_windows_api(x86_cpu_t *cpu, uint32_t func_id) {
    switch (func_id) {
        case WIN_API_EXIT_PROCESS: {
            uint32_t uExitCode = mem_read32(cpu, cpu->esp + 4);
            cpu->halted = 1;
            cpu->exit_code = (int)uExitCode;
            break;
        }
        case WIN_API_GET_STD_HANDLE: {
            int32_t nStdHandle = (int32_t)mem_read32(cpu, cpu->esp + 4);
            if (nStdHandle == -10) cpu->eax = 0; /* stdin */
            else if (nStdHandle == -11) cpu->eax = 1; /* stdout */
            else if (nStdHandle == -12) cpu->eax = 2; /* stderr */
            else cpu->eax = 0;
            /* stdcall: return and pop 1 arg */
            uint32_t ret_ip = cpu_pop32(cpu);
            cpu->esp += 4;
            cpu->eip = ret_ip;
            break;
        }
        case WIN_API_WRITE_FILE: {
            uint32_t hFile = mem_read32(cpu, cpu->esp + 4);
            uint32_t lpBuffer = mem_read32(cpu, cpu->esp + 8);
            uint32_t nNumberOfBytesToWrite = mem_read32(cpu, cpu->esp + 12);
            uint32_t lpNumberOfBytesWritten = mem_read32(cpu, cpu->esp + 16);

            FILE *fp = (hFile == 2) ? stderr : stdout;
            if (mem_valid(cpu, lpBuffer, nNumberOfBytesToWrite)) {
                size_t n = fwrite(cpu->mem + (lpBuffer - cpu->mem_base), 1, nNumberOfBytesToWrite, fp);
                fflush(fp);
                if (lpNumberOfBytesWritten && mem_valid(cpu, lpNumberOfBytesWritten, 4)) {
                    mem_write32(cpu, lpNumberOfBytesWritten, (uint32_t)n);
                }
            }
            cpu->eax = 1; /* TRUE */
            uint32_t ret_ip = cpu_pop32(cpu);
            cpu->esp += 20; /* 5 parameters = 20 bytes */
            cpu->eip = ret_ip;
            break;
        }
        case WIN_API_PUTS: {
            uint32_t str_addr = mem_read32(cpu, cpu->esp + 4);
            if (mem_valid(cpu, str_addr, 1)) {
                printf("%s\n", (char *)(cpu->mem + (str_addr - cpu->mem_base)));
                fflush(stdout);
            }
            cpu->eax = 0;
            uint32_t ret_ip = cpu_pop32(cpu);
            cpu->esp += 4;
            cpu->eip = ret_ip;
            break;
        }
        default: {
            uint32_t ret_ip = cpu_pop32(cpu);
            cpu->eip = ret_ip;
            break;
        }
    }
}

/* CPU Step */
static void cpu_step(x86_cpu_t *cpu) {
    if (cpu->halted) return;

    /* Check if calling into synthetic Windows API trap space */
    if (cpu->eip >= WIN_TRAP_BASE && cpu->eip < WIN_TRAP_BASE + 0x1000) {
        uint32_t func_id = (cpu->eip - WIN_TRAP_BASE) >> 4;
        handle_windows_api(cpu, func_id);
        return;
    }

    uint8_t op = mem_read8(cpu, cpu->eip++);

    /* Group INC r32 (0x40 - 0x47) */
    if (op >= 0x40 && op <= 0x47) {
        uint32_t *r = get_reg32(cpu, op - 0x40);
        (*r)++;
        cpu->eflags = (*r == 0 ? 0x40 : 0) | ((*r & 0x80000000) ? 0x80 : 0);
        return;
    }

    /* Group DEC r32 (0x48 - 0x4F) */
    if (op >= 0x48 && op <= 0x4F) {
        uint32_t *r = get_reg32(cpu, op - 0x48);
        (*r)--;
        cpu->eflags = (*r == 0 ? 0x40 : 0) | ((*r & 0x80000000) ? 0x80 : 0);
        return;
    }

    /* Group PUSH r32 (0x50 - 0x57) */
    if (op >= 0x50 && op <= 0x57) {
        cpu_push32(cpu, *get_reg32(cpu, op - 0x50));
        return;
    }

    /* Group POP r32 (0x58 - 0x5F) */
    if (op >= 0x58 && op <= 0x5F) {
        *get_reg32(cpu, op - 0x58) = cpu_pop32(cpu);
        return;
    }

    /* Group MOV r32, imm32 (0xB8 - 0xBF) */
    if (op >= 0xB8 && op <= 0xBF) {
        uint32_t imm = mem_read32(cpu, cpu->eip);
        cpu->eip += 4;
        *get_reg32(cpu, op - 0xB8) = imm;
        return;
    }

    switch (op) {
        case 0x90: /* NOP */
            break;
        case 0x68: { /* PUSH imm32 */
            uint32_t imm = mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
            cpu_push32(cpu, imm);
            break;
        }
        case 0x6A: { /* PUSH imm8 */
            int8_t imm = (int8_t)mem_read8(cpu, cpu->eip++);
            cpu_push32(cpu, (uint32_t)(int32_t)imm);
            break;
        }
        case 0x89: { /* MOV r/m32, r32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            op_write32(cpu, dst, *get_reg32(cpu, reg));
            break;
        }
        case 0x8B: { /* MOV r32, r/m32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            *get_reg32(cpu, reg) = op_read32(cpu, src);
            break;
        }
        case 0xC7: { /* MOV r/m32, imm32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t imm = mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
            op_write32(cpu, dst, imm);
            break;
        }
        case 0x8D: { /* LEA r32, m */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            *get_reg32(cpu, reg) = src.mem_addr;
            break;
        }
        case 0x01: { /* ADD r/m32, r32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t a = op_read32(cpu, dst);
            uint32_t b = *get_reg32(cpu, reg);
            uint32_t res = a + b;
            op_write32(cpu, dst, res);
            cpu->eflags = (res == 0 ? 0x40 : 0);
            break;
        }
        case 0x03: { /* ADD r32, r/m32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            uint32_t res = *get_reg32(cpu, reg) + op_read32(cpu, src);
            *get_reg32(cpu, reg) = res;
            cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80000000) ? 0x80 : 0);
            break;
        }
        case 0x29: { /* SUB r/m32, r32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t a = op_read32(cpu, dst);
            uint32_t b = *get_reg32(cpu, reg);
            uint32_t res = a - b;
            op_write32(cpu, dst, res);
            set_flags_sub32(cpu, a, b);
            break;
        }
        case 0x2B: { /* SUB r32, r/m32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            uint32_t a = *get_reg32(cpu, reg);
            uint32_t b = op_read32(cpu, src);
            uint32_t res = a - b;
            *get_reg32(cpu, reg) = res;
            set_flags_sub32(cpu, a, b);
            break;
        }
        case 0x31: { /* XOR r/m32, r32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t res = op_read32(cpu, dst) ^ (*get_reg32(cpu, reg));
            op_write32(cpu, dst, res);
            cpu->eflags = (res == 0 ? 0x40 : 0);
            break;
        }
        case 0x33: { /* XOR r32, r/m32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            uint32_t res = *get_reg32(cpu, reg) ^ op_read32(cpu, src);
            *get_reg32(cpu, reg) = res;
            cpu->eflags = (res == 0 ? 0x40 : 0);
            break;
        }
        case 0x38: { /* CMP r/m8, r8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            set_flags_sub8(cpu, op_read8(cpu, dst), read_reg8(cpu, reg));
            break;
        }
        case 0x39: { /* CMP r/m32, r32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t a = op_read32(cpu, dst);
            uint32_t b = *get_reg32(cpu, reg);
            set_flags_sub32(cpu, a, b);
            break;
        }
        case 0x3A: { /* CMP r8, r/m8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            set_flags_sub8(cpu, read_reg8(cpu, reg), op_read8(cpu, src));
            break;
        }
        case 0x3B: { /* CMP r32, r/m32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            set_flags_sub32(cpu, *get_reg32(cpu, reg), op_read32(cpu, src));
            break;
        }
        case 0x3C: { /* CMP AL, imm8 */
            uint8_t imm = mem_read8(cpu, cpu->eip++);
            set_flags_sub8(cpu, (uint8_t)(cpu->eax & 0xFF), imm);
            break;
        }
        case 0x3D: { /* CMP EAX, imm32 */
            uint32_t imm = mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
            set_flags_sub32(cpu, cpu->eax, imm);
            break;
        }
        case 0x81: { /* Group 1 r/m32, imm32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t imm = mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
            uint32_t a = op_read32(cpu, dst);
            uint32_t res = a;
            if (op_sub == 0) res = a + imm; /* ADD */
            else if (op_sub == 1) res = a | imm; /* OR */
            else if (op_sub == 4) res = a & imm; /* AND */
            else if (op_sub == 5) { /* SUB */
                res = a - imm;
                set_flags_sub32(cpu, a, imm);
                op_write32(cpu, dst, res);
                break;
            }
            else if (op_sub == 6) res = a ^ imm; /* XOR */
            else if (op_sub == 7) { /* CMP */
                set_flags_sub32(cpu, a, imm);
                break;
            }
            op_write32(cpu, dst, res);
            cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80000000) ? 0x80 : 0);
            break;
        }
        case 0x85: { /* TEST r/m32, r32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t res = op_read32(cpu, dst) & (*get_reg32(cpu, reg));
            cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80000000) ? 0x80 : 0);
            break;
        }
        case 0x88: { /* MOV r/m8, r8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            op_write8(cpu, dst, read_reg8(cpu, reg));
            break;
        }
        case 0x8A: { /* MOV r8, r/m8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t src = decode_modrm(cpu, modrm);
            write_reg8(cpu, reg, op_read8(cpu, src));
            break;
        }
        case 0xC6: { /* MOV r/m8, imm8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            operand_t dst = decode_modrm(cpu, modrm);
            uint8_t imm = mem_read8(cpu, cpu->eip++);
            op_write8(cpu, dst, imm);
            break;
        }
        case 0x0F: { /* Two-byte opcodes */
            uint8_t op2 = mem_read8(cpu, cpu->eip++);
            if (op2 >= 0x80 && op2 <= 0x8F) { /* Jcc rel32 */
                int32_t rel = (int32_t)mem_read32(cpu, cpu->eip);
                cpu->eip += 4;
                if (check_condition(cpu, op2 & 0x0F)) cpu->eip += rel;
            } else if (op2 >= 0x90 && op2 <= 0x9F) { /* SETcc r/m8 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                operand_t dst = decode_modrm(cpu, modrm);
                uint8_t val = check_condition(cpu, op2 & 0x0F) ? 1 : 0;
                op_write8(cpu, dst, val);
            } else if (op2 >= 0x40 && op2 <= 0x4F) { /* CMOVcc r32, r/m32 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                int reg = (modrm >> 3) & 7;
                operand_t src = decode_modrm(cpu, modrm);
                if (check_condition(cpu, op2 & 0x0F)) {
                    *get_reg32(cpu, reg) = op_read32(cpu, src);
                }
            } else if (op2 == 0xB6) { /* MOVZX r32, r/m8 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                int reg = (modrm >> 3) & 7;
                operand_t src = decode_modrm(cpu, modrm);
                *get_reg32(cpu, reg) = (uint32_t)op_read8(cpu, src);
            } else if (op2 == 0xB7) { /* MOVZX r32, r/m16 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                int reg = (modrm >> 3) & 7;
                operand_t src = decode_modrm(cpu, modrm);
                *get_reg32(cpu, reg) = (uint32_t)op_read16(cpu, src);
            } else if (op2 == 0xBE) { /* MOVSX r32, r/m8 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                int reg = (modrm >> 3) & 7;
                operand_t src = decode_modrm(cpu, modrm);
                *get_reg32(cpu, reg) = (uint32_t)(int32_t)(int8_t)op_read8(cpu, src);
            } else if (op2 == 0xBF) { /* MOVSX r32, r/m16 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                int reg = (modrm >> 3) & 7;
                operand_t src = decode_modrm(cpu, modrm);
                *get_reg32(cpu, reg) = (uint32_t)(int32_t)(int16_t)op_read16(cpu, src);
            } else if (op2 == 0xAF) { /* IMUL r32, r/m32 */
                uint8_t modrm = mem_read8(cpu, cpu->eip++);
                int reg = (modrm >> 3) & 7;
                operand_t src = decode_modrm(cpu, modrm);
                *get_reg32(cpu, reg) = (uint32_t)((int32_t)*get_reg32(cpu, reg) * (int32_t)op_read32(cpu, src));
            } else {
                fprintf(stderr, "[box86] unknown op 0x0F 0x%02X at eip 0x%08X\n", op2, cpu->eip - 2);
                cpu->halted = 1;
            }
            break;
        }
        case 0x83: { /* Group 1 r/m32, imm8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            int32_t imm = (int32_t)(int8_t)mem_read8(cpu, cpu->eip++);
            uint32_t a = op_read32(cpu, dst);
            uint32_t res = a;
            if (op_sub == 0) res = a + imm; /* ADD */
            else if (op_sub == 5) { /* SUB */
                res = a - (uint32_t)imm;
                set_flags_sub32(cpu, a, (uint32_t)imm);
                op_write32(cpu, dst, res);
                break;
            }
            else if (op_sub == 7) { /* CMP */
                set_flags_sub32(cpu, a, (uint32_t)imm);
                break;
            }
            op_write32(cpu, dst, res);
            cpu->eflags = (res == 0 ? 0x40 : 0);
            break;
        }
        case 0xE8: { /* CALL rel32 */
            int32_t rel = (int32_t)mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
            cpu_push32(cpu, cpu->eip);
            cpu->eip += rel;
            break;
        }
        case 0xE9: { /* JMP rel32 */
            int32_t rel = (int32_t)mem_read32(cpu, cpu->eip);
            cpu->eip += 4;
            cpu->eip += rel;
            break;
        }
        case 0xEB: { /* JMP rel8 */
            int8_t rel = (int8_t)mem_read8(cpu, cpu->eip++);
            cpu->eip += rel;
            break;
        }
        case 0x70: case 0x71: case 0x72: case 0x73:
        case 0x74: case 0x75: case 0x76: case 0x77:
        case 0x78: case 0x79: case 0x7A: case 0x7B:
        case 0x7C: case 0x7D: case 0x7E: case 0x7F: { /* Jcc rel8 */
            int8_t rel = (int8_t)mem_read8(cpu, cpu->eip++);
            if (check_condition(cpu, op & 0x0F)) cpu->eip += rel;
            break;
        }
        case 0x80: { /* Group 1 r/m8, imm8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint8_t imm = mem_read8(cpu, cpu->eip++);
            uint8_t a = op_read8(cpu, dst);
            uint8_t res = a;
            if (op_sub == 0) res = a + imm;
            else if (op_sub == 1) res = a | imm;
            else if (op_sub == 4) res = a & imm;
            else if (op_sub == 5) {
                res = a - imm;
                set_flags_sub8(cpu, a, imm);
                op_write8(cpu, dst, res);
                break;
            }
            else if (op_sub == 6) res = a ^ imm;
            else if (op_sub == 7) { /* CMP */
                set_flags_sub8(cpu, a, imm);
                break;
            }
            op_write8(cpu, dst, res);
            cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80) ? 0x80 : 0);
            break;
        }
        case 0x84: { /* TEST r/m8, r8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int reg = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint8_t res = op_read8(cpu, dst) & read_reg8(cpu, reg);
            cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80) ? 0x80 : 0);
            break;
        }
        case 0x99: { /* CDQ */
            cpu->edx = ((int32_t)cpu->eax < 0) ? 0xFFFFFFFF : 0;
            break;
        }
        case 0xC0:
        case 0xD0:
        case 0xD2: { /* Group 2 r/m8, imm8 / 1 / CL */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint8_t val = op_read8(cpu, dst);
            uint8_t count = 1;
            if (op == 0xC0) count = mem_read8(cpu, cpu->eip++) & 0x1F;
            else if (op == 0xD2) count = cpu->ecx & 0x1F;
            else if (op == 0xD0) count = 1;

            if (count > 0) {
                uint8_t res = val;
                count %= 8;
                if (count > 0) {
                    if (op_sub == 0) res = (val << count) | (val >> (8 - count));
                    else if (op_sub == 1) res = (val >> count) | (val << (8 - count));
                    else if (op_sub == 4 || op_sub == 6) res = val << count;
                    else if (op_sub == 5) res = val >> count;
                    else if (op_sub == 7) res = (uint8_t)(((int8_t)val) >> count);
                }
                op_write8(cpu, dst, res);
                cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80) ? 0x80 : 0);
            }
            break;
        }
        case 0xC1:
        case 0xD1:
        case 0xD3: { /* Group 2 r/m32, imm8 / 1 / CL */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t val = op_read32(cpu, dst);
            uint8_t count = 1;
            if (op == 0xC1) count = mem_read8(cpu, cpu->eip++) & 0x1F;
            else if (op == 0xD3) count = cpu->ecx & 0x1F;
            else if (op == 0xD1) count = 1;

            if (count > 0) {
                uint32_t res = val;
                if (op_sub == 0) res = (val << count) | (val >> (32 - count));
                else if (op_sub == 1) res = (val >> count) | (val << (32 - count));
                else if (op_sub == 4 || op_sub == 6) res = val << count;
                else if (op_sub == 5) res = val >> count;
                else if (op_sub == 7) res = (uint32_t)(((int32_t)val) >> count);
                op_write32(cpu, dst, res);
                cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80000000) ? 0x80 : 0);
            }
            break;
        }
        case 0xF6: { /* Group 3 r/m8 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint8_t val = op_read8(cpu, dst);
            if (op_sub == 0) { /* TEST r/m8, imm8 */
                uint8_t imm = mem_read8(cpu, cpu->eip++);
                uint8_t res = val & imm;
                cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80) ? 0x80 : 0);
            } else if (op_sub == 2) { /* NOT */
                op_write8(cpu, dst, ~val);
            } else if (op_sub == 3) { /* NEG */
                uint8_t res = (uint8_t)(-(int8_t)val);
                op_write8(cpu, dst, res);
                cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80) ? 0x80 : 0);
            } else if (op_sub == 4) { /* MUL AL */
                uint16_t prod = (uint16_t)(cpu->eax & 0xFF) * (uint16_t)val;
                cpu->eax = (cpu->eax & ~0xFFFF) | prod;
            } else if (op_sub == 5) { /* IMUL AL */
                int16_t prod = (int16_t)(int8_t)(cpu->eax & 0xFF) * (int16_t)(int8_t)val;
                cpu->eax = (cpu->eax & ~0xFFFF) | (uint16_t)prod;
            } else if (op_sub == 6) { /* DIV */
                if (val != 0) {
                    uint16_t dividend = (uint16_t)(cpu->eax & 0xFFFF);
                    uint8_t quot = (uint8_t)(dividend / val);
                    uint8_t rem = (uint8_t)(dividend % val);
                    cpu->eax = (cpu->eax & ~0xFFFF) | ((uint16_t)rem << 8) | quot;
                }
            } else if (op_sub == 7) { /* IDIV */
                if (val != 0) {
                    int16_t dividend = (int16_t)(cpu->eax & 0xFFFF);
                    int8_t quot = (int8_t)(dividend / (int8_t)val);
                    int8_t rem = (int8_t)(dividend % (int8_t)val);
                    cpu->eax = (cpu->eax & ~0xFFFF) | ((uint16_t)(uint8_t)rem << 8) | (uint8_t)quot;
                }
            }
            break;
        }
        case 0xF7: { /* Group 3 r/m32 */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t val = op_read32(cpu, dst);
            if (op_sub == 0) { /* TEST r/m32, imm32 */
                uint32_t imm = mem_read32(cpu, cpu->eip);
                cpu->eip += 4;
                uint32_t res = val & imm;
                cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80000000) ? 0x80 : 0);
            } else if (op_sub == 2) { /* NOT */
                op_write32(cpu, dst, ~val);
            } else if (op_sub == 3) { /* NEG */
                uint32_t res = (uint32_t)(-(int32_t)val);
                op_write32(cpu, dst, res);
                cpu->eflags = (res == 0 ? 0x40 : 0) | ((res & 0x80000000) ? 0x80 : 0);
            } else if (op_sub == 4) { /* MUL EAX */
                uint64_t prod = (uint64_t)cpu->eax * (uint64_t)val;
                cpu->eax = (uint32_t)prod;
                cpu->edx = (uint32_t)(prod >> 32);
            } else if (op_sub == 5) { /* IMUL EAX */
                int64_t prod = (int64_t)(int32_t)cpu->eax * (int64_t)(int32_t)val;
                cpu->eax = (uint32_t)prod;
                cpu->edx = (uint32_t)(prod >> 32);
            } else if (op_sub == 6) { /* DIV */
                if (val != 0) {
                    uint64_t dividend = ((uint64_t)cpu->edx << 32) | (uint64_t)cpu->eax;
                    cpu->eax = (uint32_t)(dividend / val);
                    cpu->edx = (uint32_t)(dividend % val);
                }
            } else if (op_sub == 7) { /* IDIV */
                if (val != 0) {
                    int64_t dividend = (int64_t)(((uint64_t)cpu->edx << 32) | (uint64_t)cpu->eax);
                    cpu->eax = (uint32_t)(dividend / (int32_t)val);
                    cpu->edx = (uint32_t)(dividend % (int32_t)val);
                }
            }
            break;
        }
        case 0xC9: { /* LEAVE */
            cpu->esp = cpu->ebp;
            cpu->ebp = cpu_pop32(cpu);
            break;
        }
        case 0xC3: { /* RET */
            cpu->eip = cpu_pop32(cpu);
            break;
        }
        case 0xC2: { /* RET imm16 */
            uint16_t imm = mem_read16(cpu, cpu->eip);
            cpu->eip = cpu_pop32(cpu);
            cpu->esp += imm;
            break;
        }
        case 0xCD: { /* INT imm8 */
            uint8_t int_no = mem_read8(cpu, cpu->eip++);
            if (int_no == 0x80) {
                handle_linux_syscall(cpu);
            }
            break;
        }
        case 0xFF: { /* Group 5 (CALL / JMP / PUSH r/m32) */
            uint8_t modrm = mem_read8(cpu, cpu->eip++);
            int op_sub = (modrm >> 3) & 7;
            operand_t dst = decode_modrm(cpu, modrm);
            uint32_t target = op_read32(cpu, dst);
            if (op_sub == 2) { /* CALL */
                cpu_push32(cpu, cpu->eip);
                cpu->eip = target;
            } else if (op_sub == 4) { /* JMP */
                cpu->eip = target;
            } else if (op_sub == 6) { /* PUSH */
                cpu_push32(cpu, target);
            }
            break;
        }
        case 0xF4: /* HLT */
            cpu->halted = 1;
            break;
        default:
            fprintf(stderr, "[box86] unknown op 0x%02X at eip 0x%08X\n", op, cpu->eip - 1);
            cpu->halted = 1;
            break;
    }
}

static int run_cpu(x86_cpu_t *cpu, size_t max_instructions) {
    size_t count = 0;
    while (!cpu->halted && count < max_instructions) {
        cpu_step(cpu);
        count++;
    }
    return cpu->exit_code;
}

/* ========================================================================= */
/* Command: box86 / linux-exec (Linux x86 ELF Binary Runner)                 */
/* ========================================================================= */
static int cmd_box86(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("Box86 v0.3.2 (WASM build for Jazui Desktop)\n"
                   "Linux x86 user-mode binary emulator and system call interpreter\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: box86 <elf-file> [arguments...]\n"
                   "       linux-exec <elf-file> [arguments...]\n\n"
                   "Executes 32-bit x86 Linux ELF binaries in the WebAssembly sandbox.\n");
            return 0;
        }
    }

    if (argc < 2) {
        fprintf(stderr, "box86: missing executable file operand\nTry 'box86 --help' for more information.\n");
        return 1;
    }

    const char *elf_path = argv[1];
    size_t elen = 0;
    unsigned char *ebuf = read_file(elf_path, &elen);
    if (!ebuf) return 1;

    if (elen < 52 || memcmp(ebuf, "\x7F" "ELF", 4) != 0) {
        fprintf(stderr, "box86: %s: Not an ELF binary\n", elf_path);
        free(ebuf);
        return 1;
    }

    if (ebuf[4] != 1) {
        fprintf(stderr, "box86: %s: Only 32-bit ELF (Class 1) supported by box86\n", elf_path);
        free(ebuf);
        return 1;
    }

    uint32_t entry = *(uint32_t *)(ebuf + 24);
    uint32_t phoff = *(uint32_t *)(ebuf + 28);
    uint16_t phentsize = *(uint16_t *)(ebuf + 42);
    uint16_t phnum = *(uint16_t *)(ebuf + 44);

    uint32_t min_vaddr = 0xFFFFFFFF;
    for (int p = 0; p < phnum; p++) {
        size_t off = phoff + p * phentsize;
        if (off + 32 > elen) break;
        uint32_t p_type = *(uint32_t *)(ebuf + off);
        uint32_t p_vaddr = *(uint32_t *)(ebuf + off + 8);
        if (p_type == 1 && p_vaddr < min_vaddr) min_vaddr = p_vaddr;
    }
    if (min_vaddr == 0xFFFFFFFF) min_vaddr = entry;
    uint32_t base = min_vaddr & ~0xFFF;

    x86_cpu_t cpu;
    memset(&cpu, 0, sizeof(cpu));
    cpu.mem_base = base;
    cpu.mem_size = MEM_SIZE;
    cpu.mem = (unsigned char *)calloc(1, cpu.mem_size);
    if (!cpu.mem) { free(ebuf); return 1; }

    uint32_t max_brk = base + 0x100000;

    for (int p = 0; p < phnum; p++) {
        size_t off = phoff + p * phentsize;
        if (off + 32 > elen) break;
        uint32_t p_type = *(uint32_t *)(ebuf + off);
        uint32_t p_offset = *(uint32_t *)(ebuf + off + 4);
        uint32_t p_vaddr = *(uint32_t *)(ebuf + off + 8);
        uint32_t p_filesz = *(uint32_t *)(ebuf + off + 16);
        uint32_t p_memsz = *(uint32_t *)(ebuf + off + 20);

        if (p_type == 1 /* PT_LOAD */) {
            if (p_vaddr >= cpu.mem_base && p_vaddr + p_memsz <= cpu.mem_base + cpu.mem_size) {
                if (p_offset + p_filesz <= elen) {
                    memcpy(cpu.mem + (p_vaddr - cpu.mem_base), ebuf + p_offset, p_filesz);
                }
                if (p_vaddr + p_memsz > max_brk) max_brk = p_vaddr + p_memsz;
            }
        }
    }

    free(ebuf);

    cpu.eip = entry;
    cpu.esp = GET_STACK_TOP(&cpu);
    cpu.brk = (max_brk + 0xFFF) & ~0xFFF;

    /* Setup initial Linux stack: argc, argv pointers, envp, auxv */
    cpu_push32(&cpu, 0); /* NULL auxv */
    cpu_push32(&cpu, 0); /* NULL envp */
    cpu_push32(&cpu, 0); /* NULL argv end */
    cpu_push32(&cpu, (uint32_t)elf_path); /* argv[0] */
    cpu_push32(&cpu, 1); /* argc */

    int res = run_cpu(&cpu, 10000000);
    free(cpu.mem);
    return res;
}

/* ========================================================================= */
/* Command: wine / win-exec (Windows PE Executable Runner)                   */
/* ========================================================================= */
static int cmd_wine(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
            printf("wine-9.0 (WASM build for Jazui Desktop)\n"
                   "Windows API compatibility layer and PE executable loader\n");
            return 0;
        }
        if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("Usage: wine <program.exe> [arguments...]\n"
                   "       win-exec <program.exe> [arguments...]\n\n"
                   "Executes 32-bit Windows PE console applications in the WebAssembly sandbox.\n");
            return 0;
        }
    }

    if (argc < 2) {
        fprintf(stderr, "wine: missing program.exe operand\nTry 'wine --help' for more information.\n");
        return 1;
    }

    const char *pe_path = argv[1];
    size_t plen = 0;
    unsigned char *pbuf = read_file(pe_path, &plen);
    if (!pbuf) return 1;

    /* Check MZ header */
    if (plen < 64 || pbuf[0] != 'M' || pbuf[1] != 'Z') {
        fprintf(stderr, "wine: %s: Not a Windows executable (missing MZ signature)\n", pe_path);
        free(pbuf);
        return 1;
    }

    uint32_t pe_offset = *(uint32_t *)(pbuf + 0x3C);
    if (pe_offset + 24 > plen || memcmp(pbuf + pe_offset, "PE\0\0", 4) != 0) {
        fprintf(stderr, "wine: %s: Invalid PE header\n", pe_path);
        free(pbuf);
        return 1;
    }

    uint16_t num_sections = *(uint16_t *)(pbuf + pe_offset + 6);
    uint16_t opt_hdr_size = *(uint16_t *)(pbuf + pe_offset + 20);

    size_t opt_offset = pe_offset + 24;
    if (opt_offset + 68 > plen) {
        fprintf(stderr, "wine: %s: Truncated optional header\n", pe_path);
        free(pbuf);
        return 1;
    }

    uint32_t entry_rva = *(uint32_t *)(pbuf + opt_offset + 16);
    uint32_t image_base = *(uint32_t *)(pbuf + opt_offset + 28);
    uint32_t import_dir_rva = *(uint32_t *)(pbuf + opt_offset + 104);

    x86_cpu_t cpu;
    memset(&cpu, 0, sizeof(cpu));
    cpu.mem_base = image_base ? image_base : MEM_BASE;
    cpu.mem_size = MEM_SIZE;
    cpu.mem = (unsigned char *)calloc(1, cpu.mem_size);
    if (!cpu.mem) { free(pbuf); return 1; }

    /* Load Section Headers */
    size_t sec_offset = opt_offset + opt_hdr_size;
    for (int s = 0; s < num_sections; s++) {
        size_t soff = sec_offset + s * 40;
        if (soff + 40 > plen) break;

        uint32_t virt_size = *(uint32_t *)(pbuf + soff + 8);
        uint32_t virt_addr = *(uint32_t *)(pbuf + soff + 12);
        uint32_t raw_data_size = *(uint32_t *)(pbuf + soff + 16);
        uint32_t raw_data_ptr = *(uint32_t *)(pbuf + soff + 20);

        uint32_t load_size = (raw_data_size < virt_size) ? raw_data_size : virt_size;
        if (virt_addr + load_size <= cpu.mem_size && raw_data_ptr + load_size <= plen) {
            memcpy(cpu.mem + virt_addr, pbuf + raw_data_ptr, load_size);
        }
    }

    /* Resolve Imports */
    if (import_dir_rva && import_dir_rva < cpu.mem_size) {
        uint32_t id_off = import_dir_rva;
        while (id_off + 20 <= cpu.mem_size) {
            uint32_t orig_first_thunk = *(uint32_t *)(cpu.mem + id_off);
            uint32_t name_rva = *(uint32_t *)(cpu.mem + id_off + 12);
            uint32_t first_thunk = *(uint32_t *)(cpu.mem + id_off + 16);
            if (!orig_first_thunk && !first_thunk) break;

            const char *dll_name = (name_rva < cpu.mem_size) ? (char *)(cpu.mem + name_rva) : "";
            uint32_t thunk_list = orig_first_thunk ? orig_first_thunk : first_thunk;
            uint32_t iat_list = first_thunk;

            while (thunk_list + 4 <= cpu.mem_size && iat_list + 4 <= cpu.mem_size) {
                uint32_t thunk_val = *(uint32_t *)(cpu.mem + thunk_list);
                if (!thunk_val) break;

                const char *fn_name = "";
                if (!(thunk_val & 0x80000000)) {
                    uint32_t fn_data_rva = thunk_val;
                    if (fn_data_rva + 2 < cpu.mem_size) {
                        fn_name = (char *)(cpu.mem + fn_data_rva + 2);
                    }
                }

                uint32_t trap_addr = WIN_TRAP_BASE;
                if (strcasecmp(fn_name, "ExitProcess") == 0) trap_addr += (WIN_API_EXIT_PROCESS << 4);
                else if (strcasecmp(fn_name, "GetStdHandle") == 0) trap_addr += (WIN_API_GET_STD_HANDLE << 4);
                else if (strcasecmp(fn_name, "WriteFile") == 0) trap_addr += (WIN_API_WRITE_FILE << 4);
                else if (strcasecmp(fn_name, "puts") == 0) trap_addr += (WIN_API_PUTS << 4);
                else trap_addr += (1 << 4);

                *(uint32_t *)(cpu.mem + iat_list) = trap_addr;

                thunk_list += 4;
                iat_list += 4;
            }
            id_off += 20;
        }
    }

    free(pbuf);

    cpu.eip = cpu.mem_base + entry_rva;
    cpu.esp = GET_STACK_TOP(&cpu);

    int res = run_cpu(&cpu, 10000000);
    free(cpu.mem);
    return res;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "box86") == 0 || strcmp(pname, "linux-exec") == 0) {
        ret = cmd_box86(argc, argv);
    } else if (strcmp(pname, "wine") == 0 || strcmp(pname, "win-exec") == 0) {
        ret = cmd_wine(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "box86") == 0 || strcmp(argv[1], "linux-exec") == 0) ret = cmd_box86(argc - 1, argv + 1);
        else if (strcmp(argv[1], "wine") == 0 || strcmp(argv[1], "win-exec") == 0) ret = cmd_wine(argc - 1, argv + 1);
        else {
            fprintf(stderr, "exec_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "exec_suite: unknown command '%s'\nAvailable: box86, linux-exec, wine, win-exec\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}

