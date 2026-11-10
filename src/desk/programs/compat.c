/* Browser platform bridges shared by the pinned upstream applications. */
#include <emscripten.h>
#include <sys/sysinfo.h>
#include <sys/select.h>
#include <poll.h>
#include <utmpx.h>
#include <wordexp.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <errno.h>
#include <sched.h>

int sched_get_priority_max(int policy) { if (policy == SCHED_OTHER) return 0; errno = EINVAL; return -1; }
int sched_get_priority_min(int policy) { return sched_get_priority_max(policy); }
int sched_setscheduler(pid_t pid, int policy, const struct sched_param *parameters) { (void)pid; (void)policy; (void)parameters; errno = ENOSYS; return -1; }

EM_JS(void, desk_system_values, (double *values), {
    const info = Module.jazu.call('system');
    HEAPF64[(values >> 3)] = info.uptime;
    HEAPF64[(values >> 3) + 1] = info.total / 1024;
    HEAPF64[(values >> 3) + 2] = info.used / 1024;
    HEAPF64[(values >> 3) + 3] = info.cores;
    HEAPF64[(values >> 3) + 4] = info.processes;
});
int sysinfo(struct sysinfo *info) {
    double values[5]; desk_system_values(values); memset(info, 0, sizeof(*info));
    info->uptime = (long)values[0]; info->totalram = (unsigned long)values[1];
    info->freeram = info->totalram > values[2] ? info->totalram - (unsigned long)values[2] : 0;
    info->procs = (unsigned short)values[4]; info->mem_unit = 1024; return 0;
}
int get_nprocs(void) { double values[5]; desk_system_values(values); return (int)values[3]; }
int get_nprocs_conf(void) { return get_nprocs(); }

static int utmp_read;
void setutxent(void) { utmp_read = 0; }
void endutxent(void) { utmp_read = 1; }
struct utmpx *getutxent(void) {
    static struct utmpx entry;
    if (utmp_read++) return NULL;
    memset(&entry, 0, sizeof(entry)); entry.ut_type = USER_PROCESS; entry.ut_pid = getpid();
    strncpy(entry.ut_user, getenv("USER") ? getenv("USER") : "user", sizeof(entry.ut_user) - 1);
    strncpy(entry.ut_line, "browser/tty", sizeof(entry.ut_line) - 1); return &entry;
}

/* Fastfetch uses wordexp only for paths. Never execute command substitutions. */
int wordexp(const char *source, wordexp_t *result, int flags) {
    (void)flags;
    if (strstr(source, "$(") || strchr(source, '`')) return WRDE_CMDSUB;
    size_t capacity = strlen(source) + 4096, length = 0;
    char *out = malloc(capacity);
    if (!out) return WRDE_NOSPACE;
    if (*source == '~' && (source[1] == '/' || !source[1])) {
        const char *home = getenv("HOME"); if (!home) home = "/home/user";
        length = strlen(home); if (length >= capacity) { free(out); return WRDE_NOSPACE; }
        memcpy(out, home, length); source++;
    }
    while (*source) {
        if (*source == '$') {
            char name[128]; size_t n = 0; source++; int brace = *source == '{'; if (brace) source++;
            while ((isalnum((unsigned char)*source) || *source == '_') && n < sizeof(name)-1) name[n++] = *source++;
            name[n] = 0; if (brace && *source == '}') source++;
            const char *value = getenv(name); if (!value) value = "";
            size_t size = strlen(value);
            if (length + size + 1 > capacity) { capacity = length + size + 4096; char *next = realloc(out, capacity); if (!next) { free(out); return WRDE_NOSPACE; } out = next; }
            memcpy(out + length, value, size); length += size;
        } else {
            if (length + 2 > capacity) { capacity *= 2; char *next = realloc(out, capacity); if (!next) { free(out); return WRDE_NOSPACE; } out = next; }
            out[length++] = *source++;
        }
    }
    out[length] = 0; result->we_wordc = 1; result->we_offs = 0;
    result->we_wordv = calloc(2, sizeof(char*));
    if (!result->we_wordv) { free(out); return WRDE_NOSPACE; }
    result->we_wordv[0] = out; return 0;
}
void wordfree(wordexp_t *result) { if (result->we_wordv) { for (size_t i=0;i<result->we_wordc;i++) free(result->we_wordv[i]); free(result->we_wordv); } memset(result, 0, sizeof(*result)); }

EM_JS(int, desk_poll, (struct pollfd *fds, int count, int timeout), {
    const entries = [];
    for (let i=0;i<count;i++) {
        const ptr = fds + i * 8, fd = HEAP32[ptr >> 2], stream = fd < 0 ? null : FS.getStream(fd);
        entries.push({ handle: stream ? stream.jazu_handle : -1, events: HEAP16[(ptr + 4) >> 1] });
    }
    const ready = Module.jazu.call('poll', { entries, timeout }); let total = 0;
    for (let i=0;i<count;i++) { HEAP16[(fds + i * 8 + 6) >> 1] = ready[i]; if (ready[i]) total++; }
    return total;
});
int poll(struct pollfd *fds, nfds_t count, int timeout) { return desk_poll(fds, count, timeout); }
int select(int count, fd_set *reads, fd_set *writes, fd_set *excepts, struct timeval *timeout) {
    if (count < 0 || count > FD_SETSIZE) { errno = EINVAL; return -1; }
    struct pollfd fds[FD_SETSIZE]; int n = 0;
    for (int fd=0;fd<count;fd++) { short events = (reads && FD_ISSET(fd, reads) ? POLLIN : 0) | (writes && FD_ISSET(fd,writes) ? POLLOUT : 0); if (events) fds[n++] = (struct pollfd){fd, events, 0}; }
    int result = poll(fds, n, timeout ? timeout->tv_sec * 1000 + timeout->tv_usec / 1000 : -1);
    if (reads) FD_ZERO(reads); if (writes) FD_ZERO(writes); if (excepts) FD_ZERO(excepts);
    for (int i=0;i<n;i++) { if (reads && (fds[i].revents & POLLIN)) FD_SET(fds[i].fd, reads); if (writes && (fds[i].revents & POLLOUT)) FD_SET(fds[i].fd, writes); }
    return result;
}

#include <spawn.h>
extern int desk_spawn(char **argv, char **envp);

int posix_spawn(pid_t *pid, const char *path,
                const posix_spawn_file_actions_t *file_actions,
                const posix_spawnattr_t *attrp,
                char *const argv[], char *const envp[]) {
    (void)file_actions; (void)attrp;
    extern char **environ;
    char *default_argv[] = {(char *)path, NULL};
    char **use_argv = argv ? (char **)argv : default_argv;
    char **use_envp = envp ? (char **)envp : environ;
    int res = desk_spawn(use_argv, use_envp);
    if (res < 0) return -res;
    if (pid) *pid = res;
    return 0;
}

int posix_spawnp(pid_t *pid, const char *file,
                 const posix_spawn_file_actions_t *file_actions,
                 const posix_spawnattr_t *attrp,
                 char *const argv[], char *const envp[]) {
    return posix_spawn(pid, file, file_actions, attrp, argv, envp);
}

