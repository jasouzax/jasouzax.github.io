#!/usr/bin/env python3
"""Runs one shell on a real pseudo-terminal and relays it over plain pipes.

Usage: pty_shim.py COLS ROWS SHELL
  fd 0  bytes typed by the user            -> the pty
  fd 1  bytes the shell prints             <- the pty
  fd 3  control lines, currently "R rows cols\n" to resize the pty

Why this exists: Node has no pty in its standard library and a native module would need a compiler on the target machine.
Nothing here blocks on a slow side: both directions use bounded buffers, so Ctrl+C always reaches the shell even when output is flooding.
Exit status is the shell's, or 128+signal when it was killed.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

BUFFER_LIMIT = 256 * 1024


def set_size(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def exit_code(status):
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def main():
    cols, rows, shell = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    pid, master = pty.fork()
    if pid == 0:
        set_size(0, rows, cols)
        os.close(3)
        os.execvp(shell, [shell, "-i"])
    set_size(master, rows, cols)

    def hang_up(signum, frame):
        try:
            os.killpg(pid, signal.SIGHUP)
        except OSError:
            pass
        os._exit(129)

    signal.signal(signal.SIGHUP, hang_up)
    signal.signal(signal.SIGTERM, hang_up)

    for fd in (0, 1, 3, master):
        os.set_blocking(fd, False)

    to_master = b""
    to_host = b""
    control = b""
    reading = [0, 3]
    master_open = True
    while True:
        readable = list(reading)
        if master_open and len(to_host) < BUFFER_LIMIT:
            readable.append(master)
        writable = []
        if to_master and master_open:
            writable.append(master)
        if to_host:
            writable.append(1)
        if not readable and not to_host:
            break
        ready_read, ready_write, _ = select.select(readable, writable, [])
        for fd in ready_read:
            try:
                data = os.read(fd, 65536)
            except OSError as error:
                if error.errno in (errno.EAGAIN, errno.EINTR):
                    continue
                data = b""
            if fd == master:
                if data:
                    to_host += data
                else:
                    master_open = False
            elif fd == 0:
                if data:
                    to_master += data
                else:
                    # the host closed our stdin: nobody can type any more
                    reading.remove(0)
                    hang_up(0, None)
            else:
                if not data:
                    reading.remove(3)
                    continue
                control += data
                while b"\n" in control:
                    line, control = control.split(b"\n", 1)
                    parts = line.split()
                    if len(parts) == 3 and parts[0] == b"R" and parts[1].isdigit() and parts[2].isdigit():
                        set_size(master, int(parts[1]), int(parts[2]))
        for fd in ready_write:
            try:
                if fd == master:
                    written = os.write(master, to_master)
                    to_master = to_master[written:]
                else:
                    written = os.write(1, to_host)
                    to_host = to_host[written:]
            except OSError as error:
                if error.errno in (errno.EAGAIN, errno.EINTR):
                    continue
                if fd == 1:
                    hang_up(0, None)
                master_open = False
        if not master_open and not to_host:
            break
    _, status = os.waitpid(pid, 0)
    sys.exit(exit_code(status))


main()
