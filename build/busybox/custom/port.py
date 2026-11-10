"""Apply the explicit BusyBox 1.36.1 browser process port. No shell parsing in JS."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
(root / 'libbb/desk_host.c').write_text((Path(__file__).parent / 'host.c').read_text())
build = root / 'libbb/Kbuild.src'
build.write_text(build.read_text() + '\nlib-y += desk_host.o\n')
p = root / 'shell/ash.c'
s = p.read_text()
s = '''#include <emscripten.h>
EM_JS(int, desk_poll_interrupt, (void), {
    return Atomics.exchange(Module.jazu.control, 2, 0);
});
''' + s

def replace(old, new):
    global s
    if s.count(old) != 1:
        raise SystemExit('BusyBox source mismatch: ' + old[:100])
    s = s.replace(old, new)

# Process groups and foreground routing belong to the browser kernel. Keep
# ash's jobs/wait bookkeeping without invoking native controlling-TTY ioctls.
replace('setjobctl(int on)\n{', 'setjobctl(int on)\n{\n on = 0;')
replace('\tsetstackmark(&smark);\n\n\tif (nflag)',
    '\tif (desk_poll_interrupt()) signal_handler(SIGINT);\n\tsetstackmark(&smark);\n\n\tif (nflag)')

# Worker waits are already atomic at the kernel boundary. Unix sigsuspend has
# no browser equivalent and the native signal-mask dance is unnecessary here.
start = s.index('static int\nwaitproc(')
end = s.index('static int\nwaitone(', start)
s = s[:start] + '''static int
waitproc(int block, int *status)
{
    int result;
    do result = waitpid(-1, status, block ? 0 : WNOHANG);
    while (result < 0 && errno == EINTR);
    return result == 0 ? -1 : result;
}

''' + s[end:]

# A child starts at an explicit C continuation, with an exact copy of its
# parent's linear memory and descriptors. This preserves variables, functions,
# parsed syntax trees and expansion state without re-parsing command text.
at = s.index('static void FAST_FUNC\nevalbackcmd(')
s = s[:at] + '''
EM_JS(int, desk_fork_host, (int jp, int n, int mode, int input, int output,
    int closefd, int redir, int flags, int argv, int path, int idx), {
    return Module.jazu.fork({jp,n,mode,input,output,closefd,redir,flags,argv,path,idx});
});
static int desk_fork(struct job *jp, union node *n, int mode, int input,
    int output, int closefd, union node *redir, int flags,
    char **argv, const char *path, int idx)
{
    int pid;
    flush_stdout_stderr();
    pid = desk_fork_host((int)jp, (int)n, mode, input, output, closefd,
        (int)redir, flags, (int)argv, (int)path, idx);
    if (pid < 0) ash_msg_and_raise_error("browser process creation failed");
    forkparent(jp, n, mode, pid);
    return pid;
}
''' + s[at:]
replace('if (forkshell(jp, (ctl == CTLBACKQ) ? n : NULL, FORK_NOJOB) == 0)',
    'if (desk_fork(jp, n, FORK_NOJOB, 0, pip[ic], pip[ip], NULL, EV_EXIT, NULL, NULL, 0) == 0)')
replace('if (forkshell(jp, n, backgnd) == 0)',
    'if (desk_fork(jp, n->nredir.n, backgnd, -1, -1, -1, n->nredir.redirect, flags | EV_EXIT, NULL, NULL, 0) == 0)')
replace('if (forkshell(jp, lp->n, n->npipe.pipe_backgnd) == 0)',
    'if (desk_fork(jp, lp->n, n->npipe.pipe_backgnd, prevfd, pip[1], pip[1] >= 0 ? pip[0] : -1, NULL, flags, NULL, NULL, 0) == 0)')
replace('if (forkshell(jp, cmd, FORK_FG) != 0)',
    'if (desk_fork(jp, cmd, FORK_FG, -1, -1, -1, NULL, flags, argv, path, cmdentry.u.index) != 0)')
# The kernel pipe is a spooled byte queue; heredocs do not need a writer process.
replace('if (len <= PIPE_BUF) {', 'if (1) {')
s += '''
EMSCRIPTEN_KEEPALIVE void jazu_interrupt(void) { signal_handler(SIGINT); }
/* Called only in a newly instantiated child, after restoring parent memory. */
EMSCRIPTEN_KEEPALIVE void jazu_child(int jp, int n, int mode, int input,
    int output, int closefd, int redir, int flags, int argv, int path, int idx)
{
    struct jmploc handler;
    exception_handler = &handler;
    if (setjmp(handler.loc)) exitshell();
    forkchild((struct job *)jp, (union node *)n, mode);
    FORCE_INT_ON;
    if (closefd >= 0) close(closefd);
    if (input >= 0 && input != 0) { dup2_or_raise(input, 0); close(input); }
    if (output >= 0 && output != 1) { dup2_or_raise(output, 1); close(output); }
    if (redir) redirect((union node *)redir, 0);
    if (argv) shellexec(((char **)argv)[0], (char **)argv, (char *)path, idx);
    evaltreenr((union node *)n, flags | EV_EXIT);
}
'''
p.write_text(s)

# BusyBox utilities use this helper for xargs/find -exec. Route their combined
# spawn/exec operation to the same kernel rather than Emscripten's vfork stub.
spawn_file = root / 'libbb/vfork_daemon_rexec.c'
source = spawn_file.read_text()
a = source.index('pid_t FAST_FUNC spawn(char **argv)')
b = source.index('pid_t FAST_FUNC xspawn(', a)
source = source[:a] + '''extern pid_t jazu_spawn(char **argv);
pid_t FAST_FUNC spawn(char **argv) { return jazu_spawn(argv); }

''' + source[b:]
a = source.index('int FAST_FUNC spawn_and_wait(char **argv)')
b = source.index('\n}', a) + 2
source = source[:a] + '''int FAST_FUNC spawn_and_wait(char **argv)
{
    int pid = spawn(argv);
    return pid < 0 ? -1 : wait4pid(pid);
}''' + source[b:]
spawn_file.write_text(source)
