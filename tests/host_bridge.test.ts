import { test } from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { build } from "esbuild"
import { Frame_Reader, encode_frame } from "../extension/host/frame.ts"

// Runs the real content.js, background.js and desk_host.ts against the real host process, with only the browser faked.

const root = new URL("..", import.meta.url).pathname
const stubs = { "desk_view.ts": "export const terminal_hooks = { uri: 'pid:' }; (globalThis as any).terminal_hooks_probe = terminal_hooks", "desk.ts": "export const text = (key: string) => key" }

async function bundle_page_client(): Promise<string> {
    const result = await build({
        entryPoints: [`${root}src/web/client/desk_host.ts`], bundle: true, write: false, format: "iife", globalName: "bridge",
        plugins: [{ name: "stubs", setup(api) { api.onResolve({ filter: /\/desk(_view)?\.ts$/ }, args => ({ path: args.path.split("/").pop()!, namespace: "stub" })); api.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: stubs[args.path as keyof typeof stubs], loader: "ts" })) } }],
    })
    return result.outputFiles[0].text
}

type Harness = { context: Record<string, any>, stop: () => void }

function make_browser(origin: string, bridge_code: string): Harness {
    const listeners: ((event: unknown) => void)[] = []
    const window: Record<string, any> = {
        addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.push(listener),
        postMessage: (data: unknown, target: string) => { assert.equal(target, origin); queueMicrotask(() => listeners.forEach(listener => listener({ source: window, origin, data }))) },
        setTimeout, location: { origin },
    }
    const children: ReturnType<typeof spawn>[] = []
    const sw_listeners: ((port: unknown) => void)[] = []
    const make_port = (name: string, sender: unknown) => {
        const side = () => ({ onMessage: { handlers: [] as ((m: unknown) => void)[], addListener(h: (m: unknown) => void) { this.handlers.push(h) } }, onDisconnect: { handlers: [] as (() => void)[], addListener(h: () => void) { this.handlers.push(h) } } })
        const page = side(), worker = side()
        const page_port = { name, onMessage: page.onMessage, onDisconnect: page.onDisconnect, postMessage: (m: unknown) => queueMicrotask(() => worker.onMessage.handlers.forEach(h => h(m))), disconnect: () => worker.onDisconnect.handlers.forEach(h => h()) }
        const worker_port = { name, sender, onMessage: worker.onMessage, onDisconnect: worker.onDisconnect, postMessage: (m: unknown) => queueMicrotask(() => page.onMessage.handlers.forEach(h => h(m))), disconnect: () => page.onDisconnect.handlers.forEach(h => h()) }
        return { page_port, worker_port }
    }
    const chrome = {
        runtime: {
            lastError: undefined as undefined | { message: string },
            getURL: (path: string) => `chrome-extension://test/${path}`,
            getManifest: () => ({ version: "0.1.0" }),
            onConnect: { addListener: (listener: (port: unknown) => void) => sw_listeners.push(listener) },
            connect: (info: { name: string }) => { const { page_port, worker_port } = make_port(info.name, { origin, frameId: 0, tab: { id: 1 } }); sw_listeners.forEach(listener => listener(worker_port)); return page_port },
            connectNative: (_name: string) => {
                const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", `${root}extension/host/host.ts`], { env: { ...process.env, JAZU_HOST_SHELL: "/bin/sh" }, stdio: ["pipe", "pipe", "inherit"] })
                children.push(child)
                const reader = new Frame_Reader()
                const handlers: ((m: unknown) => void)[] = []
                const gone: (() => void)[] = []
                child.stdout!.on("data", chunk => reader.push(chunk).forEach(message => handlers.forEach(h => h(message))))
                child.on("close", () => gone.forEach(h => h()))
                return { onMessage: { addListener: (h: (m: unknown) => void) => handlers.push(h) }, onDisconnect: { addListener: (h: () => void) => gone.push(h) }, postMessage: (m: unknown) => child.stdin!.write(encode_frame(m)), disconnect: () => child.stdin!.end() }
            },
        },
    }
    const fetch = async () => ({ json: async () => JSON.parse(readFileSync(`${root}extension/allowed_origins.json`, "utf8")) })
    const context = vm.createContext({ window, location: window.location, document: { querySelector: () => ({}) }, chrome, fetch, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, btoa, atob, Uint8Array, Number, String, Error, Promise, queueMicrotask })
    vm.runInContext(readFileSync(`${root}extension/background.js`, "utf8"), context)
    vm.runInContext(readFileSync(`${root}extension/content.js`, "utf8"), context)
    vm.runInContext(bridge_code, context)
    return { context, stop: () => children.forEach(child => child.kill("SIGKILL")) }
}

test("page -> content script -> service worker -> real host: a shell opens, echoes, and exits with its code", async () => {
    const browser = make_browser("http://localhost:8080", await bundle_page_client())
    try {
        const info = await vm.runInContext("bridge.connect_host()", browser.context)
        assert.equal(info.user.length > 0, true)
        assert.equal(browser.context.terminal_hooks_probe.uri, "host:")
        let printed = ""
        const exited = new Promise<number>(done => {
            browser.context.on_output = (chunk: string) => { printed += chunk }
            browser.context.on_exit = (code: number) => done(code)
        })
        const session = vm.runInContext("bridge.open_session(90, 20, on_output, on_exit)", browser.context)
        session.write("echo bridge-$((6*7)) ünï\n")
        for (let waited = 0; !printed.includes("bridge-42 ünï") && waited < 8000; waited += 50) await new Promise(done => setTimeout(done, 50))
        assert.match(printed, /bridge-42 ünï/)
        session.write("exit 5\n")
        assert.equal(await exited, 5)
    } finally {
        browser.stop()
    }
})

test("a localhost page on a port that is not in allowed_origins.json is refused with a clear reason", async () => {
    const browser = make_browser("http://localhost:9999", await bundle_page_client())
    try {
        await assert.rejects(vm.runInContext("bridge.connect_host()", browser.context), /localhost:9999 is not in allowed_origins\.json/)
        assert.equal(browser.context.terminal_hooks_probe.uri, "pid:")
    } finally {
        browser.stop()
    }
})

test("without any extension the page gives up quickly and keeps the WASM terminal", async () => {
    try {
        // a window with no content script behind it: nothing ever answers the page's hello
        const lonely = vm.createContext({ window: { addEventListener: () => undefined, postMessage: () => undefined, setTimeout, location: { origin: "http://localhost:8080" } }, location: { origin: "http://localhost:8080" }, document: { querySelector: () => ({}) }, setTimeout, clearTimeout, TextEncoder, TextDecoder, btoa, atob, Uint8Array, Number, String, Error, Promise })
        vm.runInContext(await bundle_page_client(), lonely)
        const started = Date.now()
        await assert.rejects(vm.runInContext("bridge.connect_host()", lonely), /host_missing/)
        assert.ok(Date.now() - started < 4000)
    } finally {
        // nothing was started
    }
})
