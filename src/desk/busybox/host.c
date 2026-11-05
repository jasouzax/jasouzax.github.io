/* Browser kernel calls. All blocking takes place in a Worker, never the UI. */
#include <emscripten.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <errno.h>
#include <unistd.h>
#include <time.h>

EM_JS(int, desk_getpid, (void), { return Module.jazu.pid; });
EM_JS(int, desk_getppid, (void), { return Module.jazu.ppid; });
pid_t getpid(void) { return desk_getpid(); }
pid_t getppid(void) { return desk_getppid(); }
EM_JS(int, desk_wait, (int pid, int status, int flags), {
    const result = Module.jazu.call('wait', {pid, flags});
    if (status) HEAP32[status >> 2] = result.status;
    return result.pid;
});
pid_t waitpid(pid_t pid, int *status, int flags) {
    int result = desk_wait(pid, (int)status, flags);
    if (result < 0) errno = ECHILD;
    return result;
}
EM_JS(int, desk_kill, (int pid, int sig), {
    return Module.jazu.call('kill', {pid, sig});
});
int kill(pid_t pid, int sig) {
    int result = desk_kill(pid, sig);
    if (result < 0) errno = ESRCH;
    return result;
}
EM_JS(int, desk_raise, (int sig), {
    if (sig === 2) { Module._jazu_interrupt(); return 0; }
    return Module.jazu.call('kill', {pid: Module.jazu.pid, sig});
});
int raise(int sig) { return desk_raise(sig); }
EM_JS(int, desk_exec, (const char *file, char *const *argv, char *const *envp), {
    const strings = ptr => {
        const out = [];
        for (; HEAPU32[ptr >> 2]; ptr += 4) out.push(UTF8ToString(HEAPU32[ptr >> 2]));
        return out;
    };
    return Module.jazu.call('exec', {file: UTF8ToString(file), argv: strings(argv), env: strings(envp)});
});
int execve(const char *file, char *const argv[], char *const envp[]) {
    int error = desk_exec(file, argv, envp);
    errno = error;
    return -1;
}
EM_JS(int, desk_spawn, (char **argv, char **envp), {
    const strings = ptr => {
        const out = [];
        for (; HEAPU32[ptr >> 2]; ptr += 4) out.push(UTF8ToString(HEAPU32[ptr >> 2]));
        return out;
    };
    return Module.jazu.call('spawn', {argv: strings(argv), env: strings(envp)});
});
pid_t jazu_spawn(char **argv) {
    extern char **environ;
    int result = desk_spawn(argv, environ);
    if (result < 0) { errno = -result; return -1; }
    return result;
}
EM_JS(int, desk_sleep, (double ms), { return Module.jazu.call('sleep', {ms}); });
int nanosleep(const struct timespec *requested, struct timespec *remaining) {
    if (remaining) remaining->tv_sec = remaining->tv_nsec = 0;
    if (requested->tv_sec < 0 || requested->tv_nsec < 0 || requested->tv_nsec >= 1000000000) { errno = EINVAL; return -1; }
    return desk_sleep(requested->tv_sec * 1000.0 + requested->tv_nsec / 1000000.0);
}
unsigned int sleep(unsigned int seconds) { desk_sleep(seconds * 1000.0); return 0; }
int usleep(useconds_t microseconds) { return desk_sleep(microseconds / 1000.0); }
