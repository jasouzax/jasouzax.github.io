import { test } from "node:test"
import assert from "node:assert/strict"
import { kernel, reset_kernel, start_process } from "../../../desk/kernel/process.ts"
import type { fs_api, proc_api } from "../../../desk/kernel/types.ts"

test("children retain their parent's filesystem after compute selection changes, including UID changes", async () => {
    reset_kernel()
    const filesystem = (name: string, uid = 1000): fs_api => ({
        for_user: next_uid => filesystem(name, next_uid),
        async read() { return `${name}:${uid}` }, async write() {}, async mkdir() {}, async remove() {}, async rename() {}, async list() { return [] }, async stat() { return null },
    })
    let selected = filesystem("first"), release!: () => void, ready!: () => void
    const paused = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { ready = resolve })
    const seen: string[] = []
    kernel.hooks = { fs: () => selected, programs: async () => ({
        parent: async (api: proc_api) => { ready(); await paused; return api.spawn(["child"], { uid: 0 }).done },
        child: async (api: proc_api) => { seen.push(await api.fs.read("/identity")); return 0 },
    }) }
    try {
        const parent = start_process(["parent"], { root: true })
        await started; selected = filesystem("second"); release()
        assert.equal(await parent.done, 0)
        assert.deepEqual(seen, ["first:0"])
        await start_process(["child"], { root: true }).done
        assert.deepEqual(seen, ["first:0", "second:1000"])
    } finally { reset_kernel() }
})
