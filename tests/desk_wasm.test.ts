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

test("compiled BusyBox shares binary files, forks shells and connects real pipes", { timeout: 120000 }, async t => {
    const worker_file = resolve(".cache/desk-test-worker.cjs")
    mkdirSync(resolve(".cache"), { recursive: true })
    await build({ stdin: { contents: `import {parentPort} from 'node:worker_threads'; import {run_worker} from './src/web/client/wasm_worker.ts'; parentPort.on('message', data => run_worker(data, value => parentPort.postMessage(value)));`, resolveDir: process.cwd() }, outfile: worker_file, platform: "node", format: "cjs", bundle: true, logLevel: "silent" })
    const factory: worker_factory = (url: string) => {
        const node = new Worker(url)
        const adapter: ReturnType<worker_factory> = { postMessage: value => node.postMessage(value), terminate: () => node.terminate(), onmessage: null, onerror: null }
        node.on("message", data => adapter.onmessage?.({ data } as MessageEvent))
        node.on("error", error => adapter.onerror?.(error))
        return adapter
    }
    const files = new Map<string, Uint8Array>([["/home/user/input", new Uint8Array([0,255,1,128,10])]])
    const dirs = new Set(["/", "/home", "/home/user", "/tmp", "/bin", "/dev", "/proc"])
    let home_writable = true
    const fs: fs_api = {
        async stat(path) { return dirs.has(path) ? { kind: "dir", size: 0, writable: path !== "/bin" && (path !== "/home/user" || home_writable) } : files.has(path) || path.startsWith("/bin/") ? { kind: "file", size: files.get(path)?.length ?? 0, writable: !path.startsWith("/bin/") } : null },
        async list(path) { return [...dirs, ...files.keys()].filter(p => p !== path && p.startsWith(path.replace(/\/$/, "") + "/") && !p.slice(path.replace(/\/$/, "").length + 1).includes("/")).map(p => ({ name: p.split("/").pop()!, kind: dirs.has(p) ? "dir" : "file" })) },
        async read(path) { return new TextDecoder().decode(await fs.read_bytes!(path)) },
        async write(path, text) { await fs.write_bytes!(path, new TextEncoder().encode(text)) },
        async read_bytes(path) { const bytes = files.get(path); if (!bytes) throw new Error("ENOENT"); return bytes.slice() },
        async write_bytes(path, bytes) { if (!dirs.has(path.slice(0, path.lastIndexOf("/")) || "/")) throw new Error("ENOENT"); files.set(path, bytes.slice()); if (path === "/tmp/unlock-home") home_writable = true },
        async mkdir(path) { if (dirs.has(path)) throw new Error("EEXIST"); dirs.add(path) },
        async remove(path) { if (!files.delete(path) && !dirs.delete(path)) throw new Error("ENOENT") },
        async rename(from, to) { files.set(to, await fs.read_bytes!(from)); files.delete(from) },
    }
    const wasm = readFileSync(resolve("src/desk/busybox/artifacts/busybox.wasm"))
    register_wasm({ id: "busybox-test", version: "1", worker: worker_file, wasm: "data:application/wasm;base64," + wasm.toString("base64"), sha256: createHash("sha256").update(wasm).digest("hex"), commands: JSON.parse(readFileSync(resolve("src/desk/busybox/artifacts/commands.json"), "utf8")) }, factory)
    async function register_program(name: string, commands: string[] = [name]) {
        const worker_path = resolve(`.cache/desk-test-${name}-worker.cjs`)
        await build({ stdin: { contents: `import {parentPort} from 'node:worker_threads'; import {run_worker} from './src/web/client/wasm_worker_${name}.ts'; parentPort.on('message', data => run_worker(data, value => parentPort.postMessage(value)));`, resolveDir: process.cwd() }, outfile: worker_path, platform: "node", format: "cjs", bundle: true, logLevel: "silent" })
        const wasm_bytes = readFileSync(resolve(`src/desk/programs/artifacts/${name}.wasm`))
        register_wasm({ id: name, version: "1.0.0", worker: worker_path, wasm: "data:application/wasm;base64," + wasm_bytes.toString("base64"), sha256: createHash("sha256").update(wasm_bytes).digest("hex"), commands }, factory)
    }
    for (const prog of ["jq", "caesar", "morse", "optipng", "cwebp", "dwebp", "potrace", "flac", "bchunk", "mkbitmap", "metaflac", "bin2iso", "tree", "pwgen", "lame", "urlencode", "htmlencode", "rot13", "atob", "btoa", "sha384sum"]) {
        await register_program(prog)
    }
    await register_program("json_flatten", ["json-flatten"])
    await register_program("csv_json", ["csv2json", "json2csv", "tsv2json", "json2tsv"])
    await register_program("json2yaml", ["json2yaml"])
    await register_program("ini_env_json", ["ini2json", "env2json", "json2env"])
    await register_program("casing_tools", ["title-case", "titlecase", "camel-case", "camelcase", "snake-case", "snakecase", "kebab-case", "kebabcase", "slugify"])
    await register_program("text_stats", ["count-chars", "charfreq"])
    await register_program("text_gen", ["lorem", "str-repeat"])
    await register_program("banner", ["banner", "banner-js"])
    await register_program("word_games", ["pig-latin", "anagram", "palindrome"])
    await register_program("numbase", ["numbase", "dec2bin", "dec2hex", "dec2oct", "hex2dec"])
    await register_program("random_bytes", ["random-bytes"])
    await register_program("math_suite", ["fib", "fibonacci", "gcd", "lcm", "stats", "matrix"])
    await register_program("uuid_token", ["uuidgen", "uuidgen-js", "nanoid"])
    await register_program("color_tools", ["hex2rgb", "rgb2hex", "color-mix"])
    await register_program("date_units", ["date-diff", "bytes-human", "temp", "unit"])
    await register_program("qr", ["qr"])
    await register_program("net_tools", ["url-parse", "http-status", "mime-type"])
    await register_program("file_analysis", ["entropy", "detect-encoding", "file-info"])
    await register_program("string_helpers", ["escape-string", "unescape-string", "count-tokens"])
    await register_program("markup_tools", ["md2html", "html2text"])
    await register_program("tools_catalog", ["tools"])
    await register_program("encoding_suite", ["iconv", "recode"])
    kernel.hooks = { programs: async () => registered_programs, fs: () => fs }
    t.after(reset_kernel)
    const run = async (script: string) => {
        let stdout = "", stderr = ""
        const proc = start_process(["sh", "-c", script], { root: true, cwd: "/home/user", env: { PATH: "/bin", HOME: "/home/user" }, stdout: make_sink(text => { stdout += text }), stderr: make_sink(text => { stderr += text }) })
        const timer = setTimeout(() => kill(proc.pid), 30000)
        const code = await proc.done
        clearTimeout(timer)
        return { stdout, stderr, code }
    }
    await t.test("uses compiled shell expansion, functions, redirects and utilities", async () => {
        const result = await run("v=world; f() { echo hello-$v; }; f > /tmp/greeting; cat /tmp/greeting; touch /tmp/new; rm /tmp/new")
        assert.deepEqual(result, { stdout: "hello-world\n", stderr: "", code: 0 })
        assert.equal(files.has("/tmp/new"), false)
    })
    await t.test("compiled BusyBox applets encode base32, convert line endings, dump hex and compute hashes", async () => {
        const result = await run("printf 'hello\\r\\n' > /tmp/crlf; dos2unix /tmp/crlf; cat /tmp/crlf; printf 'hello' | base32; printf 'hi' | xxd -p; printf 'test' | sha512sum | cut -c1-16")
        assert.equal(result.code, 0)
        assert.equal(result.stderr, "")
        assert.equal(result.stdout, "hello\nNBSWY3DP\n6869\nee26b0dd4af7e749\n")
    })
    await t.test("an existing shell redirects after its home mount becomes writable", async () => {
        home_writable = false
        try {
            const result = await run("ls /home/user >/dev/null; touch /tmp/unlock-home; touch /home/user/hi; echo hi > /home/user/hi; echo again >> /home/user/hi; cat /home/user/hi")
            assert.deepEqual(result, { stdout: "hi\nagain\n", stderr: "", code: 0 })
        } finally { home_writable = true }
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
    await t.test("native jq wasm filters JSON input in kernel shell", async () => {
        const result = await run("echo '{\"name\":\"jazu\",\"count\":42}' > /tmp/sample.json; jq -r .name /tmp/sample.json")
        assert.equal(result.code, 0)
        assert.equal(result.stderr, "")
        assert.equal(result.stdout, "jazu\n")
    })
    await t.test("native caesar and morse wasms process ciphers in kernel shell", async () => {
        const c_res = await run("printf 'hello\\n' | caesar 13")
        const m_res = await run("printf 'SOS' | morse -s")
        assert.equal(c_res.code, 0)
        assert.equal(c_res.stdout, "uryyb\n")
        assert.equal(m_res.code, 0)
        assert.equal(m_res.stdout, " ...\n ---\n ...\n")
    })
    await t.test("native media wasms optipng, cwebp, and flac report upstream versions", async () => {
        const result = await run("optipng -v 2>&1 | head -n 1; cwebp -version; flac --version")
        assert.equal(result.code, 0)
        assert.match(result.stdout, /OptiPNG version 0\.7\.8/)
        assert.match(result.stdout, /1\.4\.0/)
        assert.match(result.stdout, /flac 1\.4\.3/)
    })
    await t.test("native potrace and bchunk wasms run help in kernel shell", async () => {
        const result = await run("potrace --version | head -n 1; bchunk 2>&1 | head -n 1")
        assert.equal(result.code, 0)
        assert.match(result.stdout, /potrace 1\.16/)
        assert.match(result.stdout, /binchunker for Unix, version 1\.2\.2/)
    })
    await t.test("native mkbitmap, metaflac, tree, pwgen, and lame wasms execute in kernel shell", async () => {
        const result = await run("mkbitmap -v | head -n 1; metaflac --version; tree --version | head -n 1; pwgen -s 12 1; lame --version 2>&1 | head -n 1; bin2iso 2>&1 | head -n 1")
        assert.equal(result.code, 0)
        assert.match(result.stdout, /mkbitmap 1\.16/)
        assert.match(result.stdout, /metaflac 1\.4\.3/)
        assert.match(result.stdout, /tree v2\.1\.3/)
        assert.match(result.stdout, /[a-zA-Z0-9]{12}/)
        assert.match(result.stdout, /LAME 32bits version 3\.100/)
        assert.match(result.stdout, /Error: Bad syntax/)
    })
    await t.test("native group 1 encoding wasms urlencode, htmlencode, rot13, atob, and btoa encode and decode", async () => {
        const u_res = await run("urlencode 'hello world'; urlencode -d 'hello%20world'")
        assert.equal(u_res.code, 0)
        assert.equal(u_res.stdout, "hello%20world\nhello world\n")

        const h_res = await run("htmlencode '<hello & world>'; htmlencode -d '&lt;hello &amp; world&gt;'")
        assert.equal(h_res.code, 0)
        assert.equal(h_res.stdout, "&lt;hello &amp; world&gt;\n<hello & world>\n")

        const r_res = await run("rot13 'hello'")
        assert.equal(r_res.code, 0)
        assert.equal(r_res.stdout, "uryyb\n")

        const b_res = await run("printf 'hello' | btoa; printf 'aGVsbG8=' | atob")
        assert.equal(b_res.code, 0)
        assert.equal(b_res.stdout, "aGVsbG8=\nhello")
    })
    await t.test("native sha384sum computes exact SHA-384 message digest in kernel shell", async () => {
        const res = await run("printf 'test' | sha384sum")
        assert.equal(res.code, 0)
        assert.equal(res.stdout, "768412320f7b0aa5812fce428dc4706b3cae50e02a64caa16a782249bfe8efc4b7ef1ccb126255d196047dfedf17a0a9  -\n")
    })
    await t.test("native group 3 data format conversion wasms convert json, csv, tsv, yaml, ini, and env", async () => {
        const flat_res = await run("printf '{\"a\":{\"b\":42}}\\n' | json-flatten")
        assert.equal(flat_res.code, 0)
        assert.match(flat_res.stdout, /"a\.b":\s*42/)

        const csv_res = await run("printf 'name,age\\nAlice,30\\n' | csv2json | json2csv")
        assert.equal(csv_res.code, 0)
        assert.equal(csv_res.stdout, "name,age\nAlice,30\n")

        const yaml_res = await run("printf '{\"site\":\"jazu\",\"active\":true}\\n' | json2yaml")
        assert.equal(yaml_res.code, 0)
        assert.match(yaml_res.stdout, /site: jazu/)
        assert.match(yaml_res.stdout, /active: true/)

        const env_res = await run("printf 'FOO=bar\\n' | env2json | json2env")
        assert.equal(env_res.code, 0)
        assert.equal(env_res.stdout, "FOO=\"bar\"\n")

        const ini_res = await run("printf '[server]\\nhost=localhost\\n' | ini2json")
        assert.equal(ini_res.code, 0)
        assert.match(ini_res.stdout, /"server":/)
        assert.match(ini_res.stdout, /"host":\s*"localhost"/)
    })
    await t.test("native group 4 text manipulation wasms handle casing, stats, generators, banner, and word games", async () => {
        const case_res = await run("printf 'hello world foo_bar' | camel-case")
        assert.equal(case_res.code, 0)
        assert.equal(case_res.stdout.trim(), "helloWorldFooBar")

        const snake_res = await run("printf 'Hello World' | snake-case")
        assert.equal(snake_res.code, 0)
        assert.equal(snake_res.stdout.trim(), "hello_world")

        const slug_res = await run("printf 'Hello, World! 123' | slugify")
        assert.equal(slug_res.code, 0)
        assert.equal(slug_res.stdout.trim(), "hello-world-123")

        const stats_res = await run("printf 'hello world' | count-chars")
        assert.equal(stats_res.code, 0)
        assert.match(stats_res.stdout, /'l'\t3\t27\.27%/)

        const repeat_res = await run("str-repeat abc 3")
        assert.equal(repeat_res.code, 0)
        assert.equal(repeat_res.stdout, "abcabcabc\n")

        const banner_res = await run("banner hi")
        assert.equal(banner_res.code, 0)
        assert.match(banner_res.stdout, /#/)

        const pig_res = await run("printf 'hello world' | pig-latin")
        assert.equal(pig_res.code, 0)
        assert.equal(pig_res.stdout.trim(), "ellohay orldway")

        const palin_res = await run("palindrome 'racecar'")
        assert.equal(palin_res.code, 0)
        assert.equal(palin_res.stdout, "true\n")
    })
    await t.test("native group 5 math and number computation wasms handle base conversions, random bytes, fib, gcd, lcm, stats, and matrix", async () => {
        const bin_res = await run("dec2bin 42")
        assert.equal(bin_res.code, 0)
        assert.equal(bin_res.stdout.trim(), "101010")

        const hex_res = await run("dec2hex 255")
        assert.equal(hex_res.code, 0)
        assert.equal(hex_res.stdout.trim(), "ff")

        const oct_res = await run("dec2oct 64")
        assert.equal(oct_res.code, 0)
        assert.equal(oct_res.stdout.trim(), "100")

        const dec_res = await run("hex2dec ff")
        assert.equal(dec_res.code, 0)
        assert.equal(dec_res.stdout.trim(), "255")

        const numbase_res = await run("numbase -f 16 -t 2 2a")
        assert.equal(numbase_res.code, 0)
        assert.equal(numbase_res.stdout.trim(), "101010")

        const rand_bytes_res = await run("random-bytes 8")
        assert.equal(rand_bytes_res.code, 0)
        assert.match(rand_bytes_res.stdout.trim(), /^[0-9a-f]{16}$/)

        const fib_res = await run("fib -s 10")
        assert.equal(fib_res.code, 0)
        assert.equal(fib_res.stdout.trim(), "55")

        const gcd_res = await run("gcd 48 18")
        assert.equal(gcd_res.code, 0)
        assert.equal(gcd_res.stdout.trim(), "6")

        const lcm_res = await run("lcm 12 18")
        assert.equal(lcm_res.code, 0)
        assert.equal(lcm_res.stdout.trim(), "36")

        const stats_res = await run("printf '10\\n20\\n30\\n' | stats")
        assert.equal(stats_res.code, 0)
        assert.match(stats_res.stdout, /Mean:\s*20/)
        assert.match(stats_res.stdout, /Median:\s*20/)

        const mat_res = await run("printf '1 2\\n3 4\\n' | matrix transpose")
        assert.equal(mat_res.code, 0)
        assert.equal(mat_res.stdout, "1 3\n2 4\n")

        const det_res = await run("printf '1 2\\n3 4\\n' | matrix det")
        assert.equal(det_res.code, 0)
        assert.equal(det_res.stdout.trim(), "-2")
    })
    await t.test("native group 6 uuid and nanoid wasms generate compliant tokens in kernel shell", async () => {
        const uuid_res = await run("uuidgen")
        assert.equal(uuid_res.code, 0)
        assert.match(uuid_res.stdout.trim(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

        const uuid_js_res = await run("uuidgen-js -u")
        assert.equal(uuid_js_res.code, 0)
        assert.match(uuid_js_res.stdout.trim(), /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)

        const nanoid_res = await run("nanoid 21")
        assert.equal(nanoid_res.code, 0)
        assert.match(nanoid_res.stdout.trim(), /^[A-Za-z0-9_-]{21}$/)
    })
    await t.test("native group 7 color tools wasm converts hex, rgb, and mixes colors in kernel shell", async () => {
        const rgb_res = await run("hex2rgb '#ff8800'")
        assert.equal(rgb_res.code, 0)
        assert.equal(rgb_res.stdout.trim(), "rgb(255, 136, 0)")

        const hex_res = await run("rgb2hex '255 136 0'")
        assert.equal(hex_res.code, 0)
        assert.equal(hex_res.stdout.trim(), "#ff8800")

        const mix_res = await run("color-mix '#ff0000' '#0000ff' 0.5")
        assert.equal(mix_res.code, 0)
        assert.equal(mix_res.stdout.trim(), "#800080")
    })
    await t.test("native group 8 date and unit conversion wasms compute date differences, format bytes, and convert units", async () => {
        const diff_res = await run("date-diff 100000 186400")
        assert.equal(diff_res.code, 0)
        assert.match(diff_res.stdout, /86400 seconds/)
        assert.match(diff_res.stdout, /1 days/)

        const bytes_res = await run("bytes-human 1048576")
        assert.equal(bytes_res.code, 0)
        assert.equal(bytes_res.stdout.trim(), "1.00 MiB")

        const temp_res = await run("temp 100 C")
        assert.equal(temp_res.code, 0)
        assert.match(temp_res.stdout, /212\.00 °F/)

        const unit_res = await run("unit 1000 m km")
        assert.equal(unit_res.code, 0)
        assert.equal(unit_res.stdout.trim(), "1 km")
    })
    await t.test("native group 9 web, network, and file analysis wasms parse urls, generate qr, lookup http status and mime, and analyze files", async () => {
        const url_res = await run("url-parse 'https://user:pass@example.com:8080/path/test?foo=bar&baz=1#section'")
        assert.equal(url_res.code, 0)
        assert.match(url_res.stdout, /Protocol:\s*https/)
        assert.match(url_res.stdout, /Host:\s*example\.com/)
        assert.match(url_res.stdout, /Port:\s*8080/)
        assert.match(url_res.stdout, /Path:\s*\/path\/test/)
        assert.match(url_res.stdout, /foo = bar/)

        const qr_res = await run("qr -a 'https://jazu.app'")
        assert.equal(qr_res.code, 0)
        assert.match(qr_res.stdout, /##/)

        const status_res = await run("http-status 404")
        assert.equal(status_res.code, 0)
        assert.match(status_res.stdout, /404 Not Found/)

        const mime_res = await run("mime-type wasm")
        assert.equal(mime_res.code, 0)
        assert.equal(mime_res.stdout.trim(), "application/wasm")

        const entropy_res = await run("printf 'AAAAABBBCC' | entropy")
        assert.equal(entropy_res.code, 0)
        assert.match(entropy_res.stdout, /Entropy:\s*[0-9\.]+ bits\/byte/)

        const enc_res = await run("printf 'Hello World' | detect-encoding")
        assert.equal(enc_res.code, 0)
        assert.match(enc_res.stdout, /US-ASCII/)
    })
    await t.test("native group 10 code helpers, markup, and tools wasms escape strings, parse markdown, strip html, and search catalog", async () => {
        const esc_res = await run("printf 'hello\\t\"world\"\\n' | escape-string")
        assert.equal(esc_res.code, 0)
        assert.match(esc_res.stdout, /hello\\t\\"world\\"/)

        const tokens_res = await run("printf 'hello world test string' | count-tokens")
        assert.equal(tokens_res.code, 0)
        assert.match(tokens_res.stdout, /Estimated Tokens:\s*[0-9]+/)

        const md_res = await run("printf '# Title\\n\\n**bold**\\n' | md2html")
        assert.equal(md_res.code, 0)
        assert.match(md_res.stdout, /<h1>Title<\/h1>/)
        assert.match(md_res.stdout, /<strong>bold<\/strong>/)

        const html_res = await run("printf '<h1>Title</h1><p>Hello &amp; world</p>' | html2text")
        assert.equal(html_res.code, 0)
        assert.match(html_res.stdout, /Title\nHello & world/)

        const tools_res = await run("tools search json")
        assert.equal(tools_res.code, 0)
        assert.match(tools_res.stdout, /json-flatten/)
    })
    await t.test("native group 11 text encoding wasms convert character sets with iconv and recode", async () => {
        const iconv_res = await run("printf 'hello world' | iconv -f utf-8 -t ascii")
        assert.equal(iconv_res.code, 0)
        assert.equal(iconv_res.stdout, "hello world")

        const recode_res = await run("printf 'hello world' | recode utf8..latin1")
        assert.equal(recode_res.code, 0)
        assert.equal(recode_res.stdout, "hello world")

        const list_res = await run("iconv -l")
        assert.equal(list_res.code, 0)
        assert.match(list_res.stdout, /UTF-8/)
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
