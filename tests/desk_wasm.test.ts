import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { Worker } from "node:worker_threads"
import { build } from "esbuild"
import { register_wasm, registered_programs } from "../src/web/client/wasm_host.ts"
import type { worker_factory } from "../src/web/client/wasm_host.ts"
import { kernel, reset_kernel, start_process, make_sink, kill } from "../src/web/client/kernel.ts"
import type { fs_api } from "../src/web/client/proc_types.ts"

test("compiled BusyBox shares binary files, forks shells and connects real pipes", { timeout: 60000 }, async t => {
    const worker_file = resolve(".cache/desk-test-worker.cjs")
    mkdirSync(resolve(".cache"), { recursive: true })
    await build({ stdin: { contents: `import {parentPort} from 'node:worker_threads'; import {run_worker} from './src/web/client/wasm_worker.ts'; parentPort.on('message', data => run_worker(data, value => parentPort.postMessage(value)));`, resolveDir: process.cwd() }, outfile: worker_file, platform: "node", format: "cjs", bundle: true, logLevel: "silent" })
    const factory: worker_factory = () => {
        const node = new Worker(worker_file)
        const adapter: ReturnType<worker_factory> = { postMessage: value => node.postMessage(value), terminate: () => node.terminate(), onmessage: null, onerror: null }
        node.on("message", data => adapter.onmessage?.({ data } as MessageEvent))
        node.on("error", error => adapter.onerror?.(error))
        return adapter
    }
    const files = new Map<string, Uint8Array>([["/home/user/input", new Uint8Array([0,255,1,128,10])]])
    const dirs = new Set(["/", "/home", "/home/user", "/tmp", "/bin", "/dev", "/proc"])
    const fs: fs_api = {
        async stat(path) { return dirs.has(path) ? { kind: "dir", size: 0, writable: path !== "/bin" } : files.has(path) || path.startsWith("/bin/") ? { kind: "file", size: files.get(path)?.length ?? 0, writable: !path.startsWith("/bin/") } : null },
        async list(path) { return [...dirs, ...files.keys()].filter(p => p !== path && p.startsWith(path.replace(/\/$/, "") + "/") && !p.slice(path.replace(/\/$/, "").length + 1).includes("/")).map(p => ({ name: p.split("/").pop()!, kind: dirs.has(p) ? "dir" : "file" })) },
        async read(path) { return new TextDecoder().decode(await fs.read_bytes!(path)) },
        async write(path, text) { await fs.write_bytes!(path, new TextEncoder().encode(text)) },
        async read_bytes(path) { const bytes = files.get(path); if (!bytes) throw new Error("ENOENT"); return bytes.slice() },
        async write_bytes(path, bytes) { if (!dirs.has(path.slice(0, path.lastIndexOf("/")) || "/")) throw new Error("ENOENT"); files.set(path, bytes.slice()) },
        async mkdir(path) { if (dirs.has(path)) throw new Error("EEXIST"); dirs.add(path) },
        async remove(path) { if (!files.delete(path) && !dirs.delete(path)) throw new Error("ENOENT") },
        async rename(from, to) { files.set(to, await fs.read_bytes!(from)); files.delete(from) },
    }
    const wasm = readFileSync(resolve("src/desk/busybox/artifacts/busybox.wasm"))
    register_wasm({ id: "busybox-test", version: "1", worker: worker_file, wasm: "data:application/wasm;base64," + wasm.toString("base64"), sha256: createHash("sha256").update(wasm).digest("hex"), commands: JSON.parse(readFileSync(resolve("src/desk/busybox/artifacts/commands.json"), "utf8")) }, factory)
    kernel.hooks = { programs: async () => registered_programs, fs: () => fs }
    t.after(reset_kernel)
    const run = async (script: string) => {
        let stdout = "", stderr = ""
        const proc = start_process(["sh", "-c", script], { root: true, cwd: "/home/user", env: { PATH: "/bin", HOME: "/home/user" }, stdout: make_sink(text => { stdout += text }), stderr: make_sink(text => { stderr += text }) })
        const timer = setTimeout(() => kill(proc.pid), 10000)
        const code = await proc.done
        clearTimeout(timer)
        return { stdout, stderr, code }
    }
    await t.test("uses compiled shell expansion, functions, redirects and utilities", async () => {
        const result = await run("v=world; f() { echo hello-$v; }; f > /tmp/greeting; cat /tmp/greeting; touch /tmp/new; rm /tmp/new")
        assert.deepEqual(result, { stdout: "hello-world\n", stderr: "", code: 0 })
        assert.equal(files.has("/tmp/new"), false)
    })
    await t.test("copies binary files without text conversion", async () => {
        const result = await run("cp /home/user/input /tmp/copy")
        assert.equal(result.stderr, "")
        assert.equal(result.code, 0)
        assert.deepEqual(files.get("/tmp/copy"), files.get("/home/user/input"))
    })
    await t.test("cd, relative paths and ls use the shared filesystem", async () => {
        const result = await run("mkdir /tmp/nested; cd /tmp/nested; touch relative; pwd; ls; rm relative; cd /; rmdir /tmp/nested")
        assert.deepEqual(result, { stdout: "/tmp/nested\nrelative\n", stderr: "", code: 0 })
        assert.equal(dirs.has("/tmp/nested"), false)
    })
    await t.test("forked pipelines preserve local variables and shell functions", async () => {
        const result = await run("v=alpha; f() { printf '%s\\n' beta $v; }; f | sort | tr a-z A-Z")
        assert.deepEqual(result, { stdout: "ALPHA\nBETA\n", stderr: "", code: 0 })
    })
    await t.test("subshell and command substitution preserve compiled shell state", async () => {
        const result = await run("v=outer; (v=inner; echo $v); echo $v; echo $(printf substitute)")
        assert.deepEqual(result, { stdout: "inner\nouter\nsubstitute\n", stderr: "", code: 0 })
    })
    await t.test("nested sh and background wait create kernel children", async () => {
        const result = await run("sh -c 'echo child:$PPID:$$'; sh -c 'exit 7' & wait $!; echo status:$?")
        assert.match(result.stdout, /child:\d+:\d+\nstatus:7\n/)
        assert.equal(result.stderr, "")
        assert.equal(result.code, 0)
    })
    await t.test("ps reads the kernel process table and kill ends a child", async () => {
        const result = await run("sh -c 'while :; do :; done' & child=$!; ps; kill $child; wait $child; echo killed:$?")
        assert.equal(result.code, 0)
        assert.match(result.stdout, /ps/)
        assert.match(result.stdout, /killed:143/)
    })
    await t.test("binary archives survive pipes, redirects and extraction", async () => {
        const result = await run("gzip -c /home/user/input | gunzip > /tmp/roundtrip; cmp /home/user/input /tmp/roundtrip")
        assert.deepEqual(result, { stdout: "", stderr: "", code: 0 })
        assert.deepEqual(files.get("/tmp/roundtrip"), files.get("/home/user/input"))
    })
    await t.test("external scripts, xargs and find -exec launch kernel processes", async () => {
        const result = await run("echo 'echo script-ok' > /tmp/script; sh /tmp/script; printf 'one two' | xargs echo; find /home/user -name input -exec echo found {} \\;")
        assert.deepEqual(result, { stdout: "script-ok\none two\nfound /home/user/input\n", stderr: "", code: 0 })
    })
    await t.test("sleep yields to the kernel clock", async () => {
        const before = performance.now()
        const result = await run("sleep 1 && echo awake")
        assert.deepEqual(result, { stdout: "awake\n", stderr: "", code: 0 })
        assert.ok(performance.now() - before >= 900)
    })
    await t.test("concurrent appenders share kernel file offsets without losing bytes", async () => {
        const result = await run("touch /tmp/append; (for i in 1 2 3 4 5; do printf A >> /tmp/append; done) & (for i in 1 2 3 4 5; do printf B >> /tmp/append; done) & wait; wc -c < /tmp/append")
        assert.equal(result.code, 0)
        assert.equal(result.stdout.trim(), "10")
        assert.equal(result.stderr, "")
    })
    await t.test("the kernel terminates a Worker running a compiled infinite loop", async () => {
        let ready!: () => void
        const started = new Promise<void>(resolve => { ready = resolve })
        const proc = start_process(["sh", "-c", "echo RUNNING; while :; do :; done"], { root: true, cwd: "/home/user", env: { PATH: "/bin" }, stdout: make_sink(text => { if (text.includes("RUNNING")) ready() }) })
        await started
        assert.equal(kill(proc.pid), true)
        assert.equal(await proc.done, 143)
        assert.equal(proc.running, false)
    })
})
