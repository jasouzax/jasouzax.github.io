import type { proc_api, program } from "./proc_types.ts"
import { inherit_descriptors } from "./wasm_host.ts"

type user = { name: string, uid: number, gid: number, home: string, shell: string }
async function users(p: proc_api): Promise<user[]> {
    const text = await p.fs.read("/etc/passwd")
    return text.split("\n").filter(Boolean).map(line => {
        const [name, , uid, gid, , home, shell] = line.split(":")
        return { name, uid: Number(uid), gid: Number(gid), home, shell: shell || "/bin/sh" }
    })
}

async function su(p: proc_api): Promise<number> {
    let name = "root", login = false, command: string | null = null
    for (let index = 1; index < p.argv.length; index++) {
        const arg = p.argv[index]
        if (arg === "-" || arg === "-l" || arg === "--login") login = true
        else if (arg === "-c" || arg === "--command") { command = p.argv[++index] ?? "" }
        else if (arg === "-h" || arg === "--help") { p.stdout.write("Usage: su [-l] [USER] [-c COMMAND]\nSwitch browser-local user; these accounts have no passwords.\n"); return 0 }
        else if (arg.startsWith("-")) { p.stderr.write(`su: unsupported option ${arg}\n`); return 1 }
        else name = arg
    }
    const found = (await users(p)).find(user => user.name === name)
    if (!found) { p.stderr.write(`su: unknown user ${name}\n`); return 1 }
    if (!(await p.fs.stat(found.shell))) { p.stderr.write(`su: ${found.shell}: no such file\n`); return 1 }
    const env = { ...(login ? { PATH: "/bin", TERM: p.env.TERM || "xterm-256color" } : p.env), HOME: found.home, USER: found.name, LOGNAME: found.name, SHELL: found.shell,
        PS1: `\\[\\033[1;${found.uid === 0 ? 31 : 32}m\\]${found.name}@jasouza\\[\\033[0m\\]:\\[\\033[1;34m\\]$PWD\\[\\033[0m\\]${found.uid === 0 ? "#" : "$"} ` }
    const descriptors = p.wasm?.descriptors ? inherit_descriptors(p.wasm.descriptors) : undefined
    const child = p.spawn([found.shell.split("/").pop()!, ...(command === null ? ["-i", "+m"] : ["-c", command])], {
        uid: found.uid, gid: found.gid, env, cwd: login ? found.home : p.cwd,
        ...(descriptors ? { wasm: { descriptors } } : {}),
    })
    return child.done
}

async function useradd(p: proc_api): Promise<number> {
    if (p.uid !== 0) { p.stderr.write("useradd: permission denied\n"); return 1 }
    const name = p.argv.at(-1) ?? ""
    if (!/^[a-z_][a-z0-9_-]*$/.test(name)) { p.stderr.write("useradd: invalid user name\n"); return 1 }
    const existing = await users(p)
    if (existing.some(user => user.name === name)) { p.stderr.write("useradd: user exists\n"); return 1 }
    const uid = Math.max(999, ...existing.map(user => user.uid)) + 1
    await p.fs.write("/etc/passwd", `${name}::${uid}:${uid}:Browser user:/home/${name}:/bin/sh\n`, true)
    await p.fs.write("/etc/group", `${name}:x:${uid}:\n`, true)
    if (p.argv.includes("-m") || p.argv.includes("--create-home")) {
        await p.fs.mkdir(`/home/${name}`); await p.fs.chown?.(`/home/${name}`, uid, uid)
    }
    return 0
}

async function userdel(p: proc_api): Promise<number> {
    if (p.uid !== 0) { p.stderr.write("userdel: permission denied\n"); return 1 }
    const name = p.argv.at(-1) ?? "", found = (await users(p)).find(user => user.name === name)
    if (!found || found.uid === 0 || found.uid === 1000) { p.stderr.write("userdel: cannot remove this user\n"); return 1 }
    for (const file of ["passwd", "group"]) await p.fs.write(`/etc/${file}`, (await p.fs.read(`/etc/${file}`)).split("\n").filter(line => !line.startsWith(`${name}:`)).join("\n"))
    if (p.argv.includes("-r") && await p.fs.stat(found.home)) await p.fs.remove(found.home, true)
    return 0
}

export const user_programs: Record<string, program> = { su, useradd, adduser: useradd, userdel, deluser: userdel,
    users: async p => { p.stdout.write(`${(await users(p)).find(user => user.uid === p.uid)?.name ?? p.uid}\n`); return 0 },
}
