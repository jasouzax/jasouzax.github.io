import { test } from "node:test"
import assert from "node:assert/strict"
import { account_username, account_directory } from "../../../desk/fs/account.ts"
import { memory_directory } from "../../../desk/fs/memory.ts"

test("account usernames are shell safe, deterministic and separated across email domains", async () => {
    const name = await account_username("Jason+work@Example.com")
    assert.match(name, /^[a-z0-9_-]+$/)
    assert.equal(name, await account_username("jason+work@example.com"))
    assert.notEqual(await account_username("jason@a.com"), await account_username("jason@b.com"))
    assert.notEqual(await account_username("root@example.com"), "root")
})

test("account changes revoke retained children, listings and open writers even for root callers", async () => {
    const raw = memory_directory("home"), nested = await raw.getDirectoryHandle("nested", { create: true })
    const handle = await nested.getFileHandle("draft.txt", { create: true })
    const initial = await handle.createWritable!(); await initial.write("keep"); await initial.close()
    let allowed = true
    const home = account_directory(raw, async () => allowed)
    const child = await home.getDirectoryHandle("nested"), file = await child.getFileHandle("draft.txt"), writer = await file.createWritable!()
    await writer.write("uncommitted")
    await raw.getDirectoryHandle("second", { create: true })
    const iterator = home.values()[Symbol.asyncIterator](); await iterator.next()
    allowed = false
    await assert.rejects(iterator.next(), { name: "NotAllowedError" })
    for (const operation of [home.getFileHandle("new.txt", { create: true }), child.removeEntry("draft.txt"), file.getFile(), writer.write("stolen"), writer.close(), home.getDirectoryHandle("nested")]) await assert.rejects(operation, { name: "NotAllowedError" })
    assert.equal(await home.queryPermission!({ mode: "read" }), "denied")
    assert.equal(await (await handle.getFile()).text(), "keep")
})

test("account wrappers preserve read-only folder permission", async () => {
    const raw = memory_directory("home")
    raw.queryPermission = async () => "denied"
    assert.equal(await account_directory(raw, async () => true).queryPermission!({ mode: "readwrite" }), "denied")
})
