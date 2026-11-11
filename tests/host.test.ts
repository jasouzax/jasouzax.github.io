import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Frame_Reader, encode_frame, max_from_chrome } from "../extension/host/frame.ts"
import { parse_request, Protocol_Error } from "../extension/host/protocol.ts"
import { extension_id, native_manifest } from "../extension/host/install.ts"

type Reply = Record<string, unknown> & { type: string }

test("native messaging frames survive being split across chunks and refuse oversized lengths", () => {
    const reader = new Frame_Reader()
    const first = encode_frame({ type: "a", n: 1 })
    const frame = Buffer.concat([first, encode_frame({ type: "b", text: "日本語" })])
    assert.deepEqual(reader.push(frame.subarray(0, 3)), [])
    assert.deepEqual(reader.push(frame.subarray(3, first.length)), [{ type: "a", n: 1 }])
    assert.deepEqual(reader.push(frame.subarray(first.length)), [{ type: "b", text: "日本語" }])
    const huge = Buffer.alloc(4)
    huge.writeUInt32LE(max_from_chrome + 1)
    assert.throws(() => new Frame_Reader().push(huge), /exceeds the limit/)
    assert.throws(() => encode_frame({ data: "x".repeat(1024 * 1024) }), /1 MiB/)
})

test("host requests are validated strictly", () => {
    assert.deepEqual(parse_request({ type: "open", id: 1, cols: 80, rows: 24 }), { type: "open", id: 1, cols: 80, rows: 24 })
    assert.equal(parse_request({ type: "input", id: 2, data: Buffer.from("ls\n").toString("base64") }).type, "input")
    for (const bad of [null, [], "open", { type: "exec", id: 1 }, { type: "open", id: 0, cols: 80, rows: 24 }, { type: "open", id: 1.5, cols: 80, rows: 24 },
        { type: "open", id: 1, cols: 0, rows: 24 }, { type: "open", id: 1, cols: 80, rows: 501 }, { type: "input", id: 1, data: "not base64!" }, { type: "input", id: 1 }, { type: "close" }]) {
        assert.throws(() => parse_request(bad), Protocol_Error, JSON.stringify(bad))
    }
})

test("extension id and native manifest are derived from the manifest key and allow only that extension", () => {
    const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"))
    const id = extension_id(manifest.key)
    assert.match(id, /^[a-p]{32}$/)
    assert.equal(id, [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32)].map(char => String.fromCharCode(97 + parseInt(char, 16))).join(""))
    const native = native_manifest("/opt/jazu/extension/host/jazu-host", id)
    assert.deepEqual(native.allowed_origins, [`chrome-extension://${id}/`])
    assert.equal(native.type, "stdio")
    assert.equal(native.name, "jazu.desk.host")
})

function start_host(backend: "python" | "script"): { child: ChildProcess, replies: Reply[], send: (message: unknown) => void, wait_for: (test: (reply: Reply) => boolean) => Promise<Reply>, stop: () => void } {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", new URL("../extension/host/host.ts", import.meta.url).pathname], { env: { ...process.env, JAZU_HOST_SHELL: "/bin/sh", JAZU_HOST_PTY: backend }, stdio: ["pipe", "pipe", "inherit"] })
    const reader = new Frame_Reader()
    const replies: Reply[] = []
    const watchers: (() => void)[] = []
    child.stdout!.on("data", (chunk: Buffer) => {
        replies.push(...reader.push(chunk) as Reply[])
        for (const watcher of [...watchers]) watcher()
    })
    const wait_for = (found: (reply: Reply) => boolean): Promise<Reply> => new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error(`timed out; got ${JSON.stringify(replies).slice(0, 500)}`)), 8000)
        const check = (): void => {
            const reply = replies.find(found)
            if (!reply) return
            clearTimeout(timer)
            watchers.splice(watchers.indexOf(check), 1)
            done(reply)
        }
        watchers.push(check)
        check()
    })
    return { child, replies, send: message => child.stdin!.write(encode_frame(message)), wait_for, stop: () => child.kill("SIGKILL") }
}

const printed = (replies: Reply[]): string => replies.filter(reply => reply.type === "output").map(reply => Buffer.from(reply.data as string, "base64").toString("utf8")).join("")

for (const backend of ["python", "script"] as const) {
    test(`host runs a real shell on a pty (${backend} backend): tty, input, exit code`, async () => {
        const host = start_host(backend)
        try {
            const ready = await host.wait_for(reply => reply.type === "host_ready")
            assert.equal(ready.pty, backend)
            host.send({ type: "open", id: 7, cols: 100, rows: 30 })
            await host.wait_for(reply => reply.type === "opened" && reply.id === 7)
            host.send({ type: "input", id: 7, data: Buffer.from("test -t 0 && echo tty-$((20+22))\n").toString("base64") })
            await host.wait_for(() => printed(host.replies).includes("tty-42"))
            if (backend === "python") {
                host.send({ type: "resize", id: 7, cols: 120, rows: 40 })
                host.send({ type: "input", id: 7, data: Buffer.from("stty size\n").toString("base64") })
                await host.wait_for(() => printed(host.replies).includes("40 120"))
            }
            host.send({ type: "input", id: 7, data: Buffer.from("exit 3\n").toString("base64") })
            const exited = await host.wait_for(reply => reply.type === "exit" && reply.id === 7)
            assert.equal(exited.code, 3)
        } finally {
            host.stop()
        }
    })
}

test("host reports bad requests without dying, and hangs up shells when the page goes away", async () => {
    const host = start_host("python")
    try {
        await host.wait_for(reply => reply.type === "host_ready")
        host.send({ type: "exec", id: 1, command: "id" })
        const refused = await host.wait_for(reply => reply.type === "error" && reply.id === 1)
        assert.match(String(refused.message), /unknown request type/)
        host.send({ type: "open", id: 2, cols: 80, rows: 24 })
        host.send({ type: "open", id: 2, cols: 80, rows: 24 })
        await host.wait_for(reply => reply.type === "error" && /already exists/.test(String(reply.message)))
        host.child.stdin!.end()
        const code = await new Promise<number | null>(done => host.child.on("close", done))
        assert.equal(code, 0)
    } finally {
        host.stop()
    }
})
