/* Browser kernel calls. All blocking takes place in a Worker, never the UI. */
#include <emscripten.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <errno.h>
#include <unistd.h>
#include <time.h>
#include <sys/utsname.h>
#include <pwd.h>
#include <grp.h>
#include <stdlib.h>
#include <string.h>

/* libc NSS is unavailable in a browser. Resolve the same editable /etc records
 * through the kernel, without hard-coding account names in a WASM image. */
EM_JS(int, desk_account, (int id, const char *name, int group, int index, char *out, int capacity), {
    const line = Module.jazu.call('account', { id, name: name ? UTF8ToString(name) : null, group: !!group, index });
    if (!line || lengthBytesUTF8(line) + 1 > capacity) return 0;
    stringToUTF8(line, out, capacity); return 1;
});
static char passwd_buffer[16384], group_buffer[16384];
static struct passwd passwd_entry;
static struct group group_entry;
static char *group_members[128];
static int passwd_index, group_index;
static int split_fields(char *buffer, char **fields, int count) {
    fields[0] = buffer;
    for (int i=1;i<count;i++) { char *colon = strchr(fields[i-1], ':'); if (!colon) return 0; *colon=0; fields[i]=colon+1; }
    return 1;
}
static struct passwd *lookup_passwd(int id, const char *name, int index) {
    char *fields[7];
    if (!desk_account(id,name,0,index,passwd_buffer,sizeof(passwd_buffer)) || !split_fields(passwd_buffer,fields,7)) return NULL;
    passwd_entry = (struct passwd){.pw_name=fields[0],.pw_passwd=fields[1],.pw_uid=strtoul(fields[2],NULL,10),.pw_gid=strtoul(fields[3],NULL,10),.pw_gecos=fields[4],.pw_dir=fields[5],.pw_shell=fields[6]};
    return &passwd_entry;
}
struct passwd *__wrap_getpwuid(uid_t id) { return lookup_passwd(id,NULL,-1); }
struct passwd *__wrap_getpwnam(const char *name) { return lookup_passwd(-1,name,-1); }
void setpwent(void) { passwd_index=0; }
void endpwent(void) { passwd_index=0; }
struct passwd *__wrap_getpwent(void) { return lookup_passwd(-1,NULL,passwd_index++); }
static struct group *lookup_group(int id, const char *name, int index) {
    char *fields[4];
    if (!desk_account(id,name,1,index,group_buffer,sizeof(group_buffer)) || !split_fields(group_buffer,fields,4)) return NULL;
    int count=0; char *member=fields[3];
    while (*member && count<127) { group_members[count++]=member; char *comma=strchr(member,','); if(!comma) break; *comma=0; member=comma+1; }
    group_members[count]=NULL;
    group_entry=(struct group){.gr_name=fields[0],.gr_passwd=fields[1],.gr_gid=strtoul(fields[2],NULL,10),.gr_mem=group_members}; return &group_entry;
}
struct group *getgrgid(gid_t id) { return lookup_group(id,NULL,-1); }
struct group *getgrnam(const char *name) { return lookup_group(-1,name,-1); }
void setgrent(void) { group_index=0; }
void endgrent(void) { group_index=0; }
struct group *getgrent(void) { return lookup_group(-1,NULL,group_index++); }

EM_JS(int, desk_identity, (int group), {
    const identity = Module.jazu.call('identity');
    return group ? identity.gid : identity.uid;
});
uid_t getuid(void) { return desk_identity(0); }
uid_t geteuid(void) { return desk_identity(0); }
gid_t getgid(void) { return desk_identity(1); }
gid_t getegid(void) { return desk_identity(1); }
int getgroups(int size, gid_t list[]) {
    if (size == 0) return 1;
    if (size < 1) { errno = EINVAL; return -1; }
    list[0] = getgid(); return 1;
}

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
EM_JS(int, desk_hostname, (char *name, int length), {
    const hostname = 'jasouza';
    if (length <= hostname.length) return -1;
    stringToUTF8(hostname, name, length);
    return 0;
});
int gethostname(char *name, size_t length) {
    int result = desk_hostname(name, length);
    if (result < 0) errno = ENAMETOOLONG;
    return result;
}
/* Preserve Emscripten's system identity while setting the kernel host name. */
extern int __syscall_uname(struct utsname *name);
int uname(struct utsname *name) {
    int result = __syscall_uname(name);
    if (result < 0) { errno = -result; return -1; }
    return gethostname(name->nodename, sizeof(name->nodename));
}
