import { test } from "node:test"
import assert from "node:assert/strict"
import { clean_text, fallback_text, max_snapshot_chars, public_structure, take_snapshot } from "../terminal/fastfetch.ts"

test("the public structure never contains a module that identifies the account or network", () => {
    const modules = public_structure.split(":")
    for (const forbidden of ["Title", "LocalIp", "PublicIp", "Locale", "Wifi", "DNS", "Users", "Host_Name"]) assert.ok(!modules.includes(forbidden), forbidden)
    assert.ok(modules.includes("OS") && modules.includes("CPU") && modules.includes("Memory"))
})

test("clean_text removes escape sequences, carriage returns and trailing blanks, and caps the length", () => {
    assert.equal(clean_text("\u001b[1mOS\u001b[0m: Debian   \r\n\u001b]0;title\u0007\n\n\n\nCPU: x\n"), "OS: Debian\n\nCPU: x")
    assert.equal(clean_text("a".repeat(max_snapshot_chars + 50)).length, max_snapshot_chars)
})

test("take_snapshot asks fastfetch for the public structure and stamps the time", async () => {
    let seen: { file: string, args: string[] } | null = null
    const snapshot = await take_snapshot("", async (file, args) => { seen = { file, args }; return "OS: Raspberry Pi OS\n" }, () => 1234)
    assert.deepEqual(snapshot, { text: "OS: Raspberry Pi OS", taken_at: 1234 })
    assert.equal(seen!.file, "fastfetch")
    assert.equal(seen!.args[seen!.args.indexOf("--structure") + 1], public_structure)
    assert.ok(seen!.args.includes("--pipe"))
})

test("a configured structure replaces the default", async () => {
    let structure = ""
    await take_snapshot("OS:Kernel", async (_file, args) => { structure = args[args.indexOf("--structure") + 1]; return "x" })
    assert.equal(structure, "OS:Kernel")
})

test("without fastfetch the snapshot falls back to Node's os module", async () => {
    const snapshot = await take_snapshot("", async () => { throw new Error("ENOENT") })
    const stable = (value: string) => value.split("\n").filter(line => /^(OS|Kernel|CPU):/.test(line))
    // Memory and uptime can change between snapshots, even within the same test.
    assert.deepEqual(stable(snapshot.text), stable(fallback_text()))
    assert.match(snapshot.text, /^OS: .+\nKernel: .+\nUptime: .+\nCPU: .+\nMemory: .+$/)
    // A fastfetch that prints nothing is treated the same way
    const blank = await take_snapshot("", async () => "  \n")
    assert.deepEqual(stable(blank.text), stable(fallback_text()))
    assert.match(blank.text, /^OS: .+\nKernel: .+\nUptime: .+\nCPU: .+\nMemory: .+$/)
})
